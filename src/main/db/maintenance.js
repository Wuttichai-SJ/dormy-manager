import { toCents } from '../money.js'
import { deleteOrphanImages, insertImage } from './images.js'
import { FieldError } from '../fieldError.js'

export const MAINTENANCE_STATUSES = ['pending', 'scheduled', 'done', 'cancelled']

export const MAINTENANCE_STATUS_LABELS = {
  pending: 'รอดำเนินการ',
  scheduled: 'นัดช่างแล้ว',
  done: 'ซ่อมเสร็จแล้ว',
  cancelled: 'ยกเลิก'
}

export const OPEN_STATUSES = ['pending', 'scheduled']

// จำกัดจำนวนรูปต่องาน
export const MAX_IMAGES_PER_REQUEST = 6

export function createMaintenanceRequest(
  db,
  { roomId, reportedDate, description, appointmentDate, images } = {}
) {
  const room = requireRoom(db, roomId)

  const reported = reportedDate ?? todayIso()
  if (!isDate(reported)) throw new FieldError({ reportedDate: 'กรุณาระบุวันที่แจ้ง' })

  const detail = String(description ?? '').trim()
  if (!detail) throw new FieldError({ description: 'กรุณาระบุอาการ/สิ่งที่ต้องซ่อม' })

  const appointment = normalizeAppointment(appointmentDate, reported)

  // มีวันนัด = นัดแล้ว · ไม่มี = รอดำเนินการ
  const status = appointment ? 'scheduled' : 'pending'

  const now = new Date().toISOString()
  const run = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO maintenance_requests
           (room_id, reported_date, appointment_date, status, description, created_at, updated_at)
         VALUES (@roomId, @reported, @appointment, @status, @detail, @now, @now)`
      )
      .run({ roomId: room.room_id, reported, appointment, status, detail, now })

    const maintenanceId = result.lastInsertRowid
    attachImages(db, maintenanceId, images, now)
    return maintenanceId
  })

  return getMaintenanceRequest(db, run())
}

export function updateMaintenanceRequest(
  db,
  maintenanceId,
  { reportedDate, description, appointmentDate } = {}
) {
  const current = requireRequest(db, maintenanceId)
  if (current.status === 'done') {
    throw new Error('งานที่ปิดไปแล้วแก้ไขไม่ได้ — ถ้าต้องซ่อมอีกให้เปิดงานใหม่')
  }

  const reported = reportedDate ?? current.reported_date
  if (!isDate(reported)) throw new FieldError({ reportedDate: 'กรุณาระบุวันที่แจ้ง' })

  const detail = String(description ?? current.description ?? '').trim()
  if (!detail) throw new FieldError({ description: 'กรุณาระบุอาการ/สิ่งที่ต้องซ่อม' })

  // appointmentDate = null คือยกเลิกนัด
  const appointment = normalizeAppointment(
    appointmentDate === undefined ? current.appointment_date : appointmentDate,
    reported
  )

  const status = current.status === 'cancelled' ? 'cancelled' : appointment ? 'scheduled' : 'pending'

  db.prepare(
    `UPDATE maintenance_requests
        SET reported_date = @reported, appointment_date = @appointment, status = @status,
            description = @detail, updated_at = @now
      WHERE maintenance_id = @maintenanceId`
  ).run({ maintenanceId, reported, appointment, status, detail, now: new Date().toISOString() })

  return getMaintenanceRequest(db, maintenanceId)
}

// ค่าซ่อมยังเป็นแค่บันทึก ไม่เข้าบิล
export function completeMaintenance(
  db,
  maintenanceId,
  { repairedDate, repairCost, repairDetails } = {}
) {
  const current = requireRequest(db, maintenanceId)
  if (current.status === 'cancelled') throw new Error('งานที่ยกเลิกไปแล้วปิดงานไม่ได้')

  const repaired = repairedDate ?? todayIso()
  if (!isDate(repaired)) throw new FieldError({ repairedDate: 'กรุณาระบุวันที่ซ่อมเสร็จ' })
  if (repaired < current.reported_date) {
    throw new FieldError({
      repairedDate: `วันที่ซ่อมเสร็จต้องไม่ก่อนวันที่แจ้ง (${current.reported_date})`
    })
  }

  // ว่าง = ยังไม่รู้ค่าซ่อม (ไม่ใช่ 0)
  const costCents =
    repairCost === undefined || repairCost === null || String(repairCost).trim() === ''
      ? null
      : costToCents(repairCost)
  if (costCents !== null && costCents < 0) throw new FieldError({ repairCost: 'ค่าซ่อมติดลบไม่ได้' })

  db.prepare(
    `UPDATE maintenance_requests
        SET status = 'done', repaired_date = @repaired, repair_cost_cents = @costCents,
            repair_details = @details, updated_at = @now
      WHERE maintenance_id = @maintenanceId`
  ).run({
    maintenanceId,
    repaired,
    costCents,
    details: String(repairDetails ?? '').trim() || null,
    now: new Date().toISOString()
  })

  return getMaintenanceRequest(db, maintenanceId)
}

// ยกเลิกไม่ลบแถว — เก็บไว้เป็นประวัติ
export function cancelMaintenance(db, maintenanceId, { reason } = {}) {
  const current = requireRequest(db, maintenanceId)
  if (current.status === 'done') throw new Error('งานที่ปิดไปแล้วยกเลิกไม่ได้')

  const note = String(reason ?? '').trim()
  db.prepare(
    `UPDATE maintenance_requests
        SET status = 'cancelled',
            repair_details = @details,
            updated_at = @now
      WHERE maintenance_id = @maintenanceId`
  ).run({
    maintenanceId,
    details: note ? `ยกเลิก: ${note}` : 'ยกเลิก',
    now: new Date().toISOString()
  })

  return getMaintenanceRequest(db, maintenanceId)
}

// เปิดงานใหม่ต้องล้างผลการซ่อมรอบก่อน
export function reopenMaintenance(db, maintenanceId) {
  const current = requireRequest(db, maintenanceId)
  if (current.status === 'pending' || current.status === 'scheduled') {
    throw new Error('งานนี้ยังไม่ได้ปิด')
  }

  db.prepare(
    `UPDATE maintenance_requests
        SET status = CASE WHEN appointment_date IS NULL THEN 'pending' ELSE 'scheduled' END,
            repaired_date = NULL, repair_cost_cents = NULL, repair_details = NULL,
            updated_at = @now
      WHERE maintenance_id = @maintenanceId`
  ).run({ maintenanceId, now: new Date().toISOString() })

  return getMaintenanceRequest(db, maintenanceId)
}

export function deleteMaintenanceRequest(db, maintenanceId) {
  requireRequest(db, maintenanceId)

  const run = db.transaction(() => {
    db.prepare('DELETE FROM maintenance_request_images WHERE maintenance_id = ?').run(maintenanceId)
    db.prepare('DELETE FROM maintenance_requests WHERE maintenance_id = ?').run(maintenanceId)
    deleteOrphanImages(db)
  })
  run()

  return { ok: true }
}

export function addMaintenanceImage(db, maintenanceId, { mimeType, bytes } = {}) {
  requireRequest(db, maintenanceId)

  const count = db
    .prepare('SELECT COUNT(*) AS n FROM maintenance_request_images WHERE maintenance_id = ?')
    .get(maintenanceId).n
  if (count >= MAX_IMAGES_PER_REQUEST) {
    throw new Error(`แนบรูปได้สูงสุด ${MAX_IMAGES_PER_REQUEST} รูปต่อหนึ่งงาน`)
  }

  const now = new Date().toISOString()
  const run = db.transaction(() => {
    const image = insertImage(db, { mimeType, bytes })
    db.prepare(
      `INSERT INTO maintenance_request_images (maintenance_id, image_id, display_order, created_at)
       VALUES (@maintenanceId, @imageId, @order, @now)`
    ).run({ maintenanceId, imageId: image.imageId, order: count, now })
    return image.imageId
  })

  return { imageId: run(), request: getMaintenanceRequest(db, maintenanceId) }
}

export function removeMaintenanceImage(db, maintenanceId, imageId) {
  requireRequest(db, maintenanceId)

  const run = db.transaction(() => {
    db.prepare(
      'DELETE FROM maintenance_request_images WHERE maintenance_id = ? AND image_id = ?'
    ).run(maintenanceId, imageId)
    deleteOrphanImages(db)
  })
  run()

  return getMaintenanceRequest(db, maintenanceId)
}

export function getMaintenanceRequest(db, maintenanceId) {
  const row = db
    .prepare(
      `SELECT m.*, r.room_number, f.apartment_id,
              (SELECT tn.first_name || ' ' || tn.last_name
                 FROM contracts c
                 JOIN contract_tenants ct ON ct.contract_id = c.contract_id
                 JOIN tenants tn ON tn.tenant_id = ct.tenant_id
                WHERE c.room_id = m.room_id AND c.status = 'active'
                ORDER BY ct.is_primary DESC, tn.tenant_id
                LIMIT 1) AS tenant_name
         FROM maintenance_requests m
         JOIN rooms r  ON r.room_id = m.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE m.maintenance_id = ?`
    )
    .get(maintenanceId)
  if (!row) return null

  const images = db
    .prepare(
      `SELECT image_id FROM maintenance_request_images
        WHERE maintenance_id = ? ORDER BY display_order, image_id`
    )
    .all(maintenanceId)
    .map((r) => r.image_id)

  return toPublicRequest(row, images)
}

export function listMaintenanceRequests(db, apartmentId, { status, search, dateFrom, dateTo } = {}) {
  if (!apartmentId) throw new Error('ไม่พบหอพัก')

  const where = ['f.apartment_id = @apartmentId']
  const params = { apartmentId }

  if (status === 'open') {
    where.push(`m.status IN ('${OPEN_STATUSES.join("','")}')`)
  } else if (status) {
    if (!MAINTENANCE_STATUSES.includes(status)) throw new Error(`สถานะไม่ถูกต้อง: ${status}`)
    where.push('m.status = @status')
    params.status = status
  }

  if (dateFrom) {
    where.push('m.reported_date >= @dateFrom')
    params.dateFrom = dateFrom
  }
  if (dateTo) {
    where.push('m.reported_date <= @dateTo')
    params.dateTo = dateTo
  }

  const keyword = String(search ?? '').trim()
  if (keyword) {
    params.search = `%${keyword}%`
    where.push('(r.room_number LIKE @search OR m.description LIKE @search)')
  }

  const rows = db
    .prepare(
      `SELECT m.*, r.room_number, f.apartment_id,
              (SELECT tn.first_name || ' ' || tn.last_name
                 FROM contracts c
                 JOIN contract_tenants ct ON ct.contract_id = c.contract_id
                 JOIN tenants tn ON tn.tenant_id = ct.tenant_id
                WHERE c.room_id = m.room_id AND c.status = 'active'
                ORDER BY ct.is_primary DESC, tn.tenant_id
                LIMIT 1) AS tenant_name,
              (SELECT COUNT(*) FROM maintenance_request_images mi
                WHERE mi.maintenance_id = m.maintenance_id) AS image_count
         FROM maintenance_requests m
         JOIN rooms r  ON r.room_id = m.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.reported_date DESC, m.maintenance_id DESC`
    )
    .all(params)

  const requests = rows.map((row) => ({
    ...toPublicRequest(row, []),
    imageCount: row.image_count
  }))

  // การ์ดสรุปนับทั้งหอเสมอ ไม่ใช่ตามตัวกรอง
  const totals = db
    .prepare(
      `SELECT m.status, COUNT(*) AS n
         FROM maintenance_requests m
         JOIN rooms r  ON r.room_id = m.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE f.apartment_id = ?
        GROUP BY m.status`
    )
    .all(apartmentId)

  const countByStatus = Object.fromEntries(MAINTENANCE_STATUSES.map((s) => [s, 0]))
  for (const row of totals) countByStatus[row.status] = row.n

  return {
    requests,
    count: requests.length,
    countByStatus,
    openCount: OPEN_STATUSES.reduce((sum, s) => sum + countByStatus[s], 0),
    repairCostTotalCents: db
      .prepare(
        `SELECT COALESCE(SUM(m.repair_cost_cents), 0) AS total
           FROM maintenance_requests m
           JOIN rooms r  ON r.room_id = m.room_id
           JOIN floors f ON f.floor_id = r.floor_id
          WHERE f.apartment_id = ? AND m.status = 'done'`
      )
      .get(apartmentId).total
  }
}

function toPublicRequest(row, images) {
  return {
    maintenanceId: row.maintenance_id,
    roomId: row.room_id,
    roomNumber: row.room_number,
    apartmentId: row.apartment_id,
    tenantName: row.tenant_name ?? null,
    reportedDate: row.reported_date,
    appointmentDate: row.appointment_date,
    status: row.status,
    statusLabel: MAINTENANCE_STATUS_LABELS[row.status] ?? row.status,
    isOpen: OPEN_STATUSES.includes(row.status),
    description: row.description,
    repairedDate: row.repaired_date,
    // null = ยังไม่กรอก · 0 = ไม่เสียเงิน
    repairCostCents: row.repair_cost_cents,
    repairDetails: row.repair_details,
    imageIds: images,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function costToCents(value) {
  try {
    return toCents(value, 'ค่าซ่อม')
  } catch (err) {
    throw new FieldError({ repairCost: err.message })
  }
}

function requireRoom(db, roomId) {
  const row = db.prepare('SELECT room_id FROM rooms WHERE room_id = ?').get(roomId)
  if (!row) throw new Error('ไม่พบห้องที่ต้องการแจ้งซ่อม')
  return row
}

function requireRequest(db, maintenanceId) {
  const row = db
    .prepare('SELECT * FROM maintenance_requests WHERE maintenance_id = ?')
    .get(maintenanceId)
  if (!row) throw new Error('ไม่พบงานแจ้งซ่อม')
  return row
}

function normalizeAppointment(value, reportedDate) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  if (!isDate(value)) throw new FieldError({ appointmentDate: 'กรุณาระบุวันนัดช่างให้ถูกต้อง' })
  if (value < reportedDate) {
    throw new FieldError({ appointmentDate: `วันนัดช่างต้องไม่ก่อนวันที่แจ้ง (${reportedDate})` })
  }
  return value
}

function attachImages(db, maintenanceId, images, now) {
  const list = Array.isArray(images) ? images : []
  if (list.length > MAX_IMAGES_PER_REQUEST) {
    throw new Error(`แนบรูปได้สูงสุด ${MAX_IMAGES_PER_REQUEST} รูปต่อหนึ่งงาน`)
  }

  const link = db.prepare(
    `INSERT INTO maintenance_request_images (maintenance_id, image_id, display_order, created_at)
     VALUES (@maintenanceId, @imageId, @order, @now)`
  )
  list.forEach((image, index) => {
    const saved = insertImage(db, image)
    link.run({ maintenanceId, imageId: saved.imageId, order: index, now })
  })
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
