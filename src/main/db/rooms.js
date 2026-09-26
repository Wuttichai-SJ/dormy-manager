// ผังห้อง: floors + rooms + room_utility_settings (สร้างห้องต้องเขียนคู่กันเสมอ)
import { errorList } from '../fieldError.js'
import { getUtilityDefaults } from './utilityDefaults.js'
import { deleteOrphanImages } from './images.js'
import { toCents } from '../money.js'

// เพดานกันพิมพ์ผิด
export const MAX_FLOORS = 30
export const MAX_ROOMS_PER_FLOOR = 50

// ประเภทห้องเริ่มต้น (room_type_id บังคับ NOT NULL)
export const DEFAULT_ROOM_TYPE = 'ทั่วไป'

// ต้องตรงกับ 001_init.sql
export const ROOM_STATUSES = ['vacant', 'occupied', 'maintenance']

export const ROOM_STATUS_LABELS = {
  vacant: 'ว่าง',
  occupied: 'ไม่ว่าง',
  maintenance: 'ปิดปรับปรุง'
}

export const MAX_ROOM_NUMBER_PREFIX = 3
export const MAX_BUILDING_NAME = 30

// เลขห้อง = เลขนำหน้า + ลำดับ 2 หลัก (101, 102 · ตั้ง '22' → 2201)
export function buildRoomNumber(prefix, index) {
  return `${prefix}${String(index + 1).padStart(2, '0')}`
}

// ใช้ที่เดียว ไม่งั้นเลขห้องชนกัน
export function effectivePrefix(prefix, ordinal) {
  const trimmed = String(prefix ?? '').trim()
  return trimmed || String(ordinal)
}

export function normalizeRoomNumberPrefix(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.length > MAX_ROOM_NUMBER_PREFIX) {
    throw new Error(`เลขนำหน้าห้องต้องยาวไม่เกิน ${MAX_ROOM_NUMBER_PREFIX} ตัวอักษร`)
  }
  if (!/^[0-9A-Za-z]+$/.test(text)) {
    throw new Error('เลขนำหน้าห้องใช้ได้เฉพาะตัวเลขหรือตัวอักษรภาษาอังกฤษ ห้ามเว้นวรรค')
  }
  return text
}

export function normalizeBuildingName(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.length > MAX_BUILDING_NAME) {
    throw new Error(`ชื่อตึกต้องยาวไม่เกิน ${MAX_BUILDING_NAME} ตัวอักษร`)
  }
  return text
}

// เลขนำหน้าซ้ำสองชั้น = เลขห้องชน
function assertPrefixFree(db, apartmentId, prefix, excludeFloorId = null) {
  if (!prefix) return

  const clash = db
    .prepare(
      `SELECT floor_id, floor_name FROM floors
        WHERE apartment_id = @apartmentId
          AND room_number_prefix = @prefix
          AND (@excludeFloorId IS NULL OR floor_id <> @excludeFloorId)
        LIMIT 1`
    )
    .get({ apartmentId, prefix, excludeFloorId })

  if (clash) {
    throw new Error(`เลขนำหน้า ${prefix} ถูกใช้กับ "${clash.floor_name}" อยู่แล้ว`)
  }
}

function ensureRoomType(db, apartmentId, name = DEFAULT_ROOM_TYPE) {
  const existing = db
    .prepare('SELECT room_type_id FROM room_types WHERE apartment_id = ? AND name = ?')
    .get(apartmentId, name)
  if (existing) return existing.room_type_id

  return db
    .prepare('INSERT INTO room_types (apartment_id, name, created_at) VALUES (?, ?, ?)')
    .run(apartmentId, name, new Date().toISOString()).lastInsertRowid
}

// ต้องคัดลอกทุกครั้ง — ออกบิลใช้ค่ารายห้อง
function insertRoomUtilitySettings(db, roomId, defaults, now) {
  const w = defaults.water
  const e = defaults.electric

  db.prepare(
    `INSERT INTO room_utility_settings (
       room_id,
       is_water_enabled, water_billing_type, water_unit_price_cents,
       water_min_charge_cents, water_flat_rate_cents, show_water_reading_in_invoice,
       is_electric_enabled, electric_billing_type, electric_unit_price_cents,
       electric_min_charge_cents, electric_flat_rate_cents, show_electric_reading_in_invoice,
       created_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    roomId,
    w.enabled ? 1 : 0,
    w.billingType,
    w.unitPriceCents,
    w.minChargeCents,
    w.flatRateCents,
    w.showReadingInInvoice ? 1 : 0,
    e.enabled ? 1 : 0,
    e.billingType,
    e.unitPriceCents,
    e.minChargeCents,
    e.flatRateCents,
    e.showReadingInInvoice ? 1 : 0,
    now
  )
}

// เลขห้องต้องไม่ซ้ำทั้งหอ · หาเลขว่างถัดไป ไม่ใช่ +1
function nextRoomNumber(db, apartmentId, floorId) {
  const ordinal = db
    .prepare(
      `SELECT COUNT(*) AS n FROM floors
        WHERE apartment_id = ? AND floor_id <= ?`
    )
    .get(apartmentId, floorId).n

  // ชั้นที่ตั้งเลขนำหน้าเอง ห้องใหม่ต้องตามนั้น
  const row = db
    .prepare('SELECT room_number_prefix FROM floors WHERE floor_id = ?')
    .get(floorId)
  const prefix = effectivePrefix(row?.room_number_prefix, ordinal)

  const taken = new Set(
    db
      .prepare(
        `SELECT r.room_number AS number FROM rooms r
           JOIN floors f ON f.floor_id = r.floor_id
          WHERE f.apartment_id = ?`
      )
      .all(apartmentId)
      .map((r) => r.number)
  )

  for (let i = 0; i < MAX_ROOMS_PER_FLOOR; i++) {
    const candidate = buildRoomNumber(prefix, i)
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`ชั้นนี้มีห้องครบ ${MAX_ROOMS_PER_FLOOR} ห้องแล้ว`)
}

function assertRoomNumberAvailable(db, apartmentId, roomNumber, exceptRoomId = null) {
  const row = db
    .prepare(
      `SELECT r.room_id FROM rooms r
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE f.apartment_id = ? AND r.room_number = ? AND r.room_id IS NOT ?`
    )
    .get(apartmentId, roomNumber, exceptRoomId)

  if (row) throw new Error(`มีห้อง "${roomNumber}" ในหอพักนี้อยู่แล้ว`)
}

function apartmentIdOfFloor(db, floorId) {
  const row = db.prepare('SELECT apartment_id FROM floors WHERE floor_id = ?').get(floorId)
  if (!row) throw new Error('ไม่พบชั้นที่ระบุ')
  return row.apartment_id
}

export function listFloors(db, apartmentId) {
  const floors = db
    .prepare('SELECT * FROM floors WHERE apartment_id = ? ORDER BY floor_id ASC')
    .all(apartmentId)

  const rooms = db
    .prepare(
      `SELECT r.*, rt.name AS room_type_name
         FROM rooms r
         JOIN floors f ON f.floor_id = r.floor_id
         LEFT JOIN room_types rt ON rt.room_type_id = r.room_type_id
        WHERE f.apartment_id = ?
        ORDER BY r.room_number ASC`
    )
    .all(apartmentId)

  const links = db
    .prepare(
      `SELECT rs.room_id, s.service_id, s.name, s.price_cents, s.is_meter_based
         FROM room_services rs
         JOIN apartment_services s ON s.service_id = rs.apartment_service_id
         JOIN rooms r ON r.room_id = rs.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE f.apartment_id = ?
        ORDER BY s.name COLLATE NOCASE ASC`
    )
    .all(apartmentId)

  const servicesByRoom = new Map()
  for (const link of links) {
    if (!servicesByRoom.has(link.room_id)) servicesByRoom.set(link.room_id, [])
    servicesByRoom.get(link.room_id).push({
      serviceId: link.service_id,
      name: link.name,
      priceCents: link.price_cents,
      isMeterBased: link.is_meter_based === 1
    })
  }

  return floors.map((floor, index) => ({
    floorId: floor.floor_id,
    apartmentId: floor.apartment_id,
    floorName: floor.floor_name,
    buildingName: floor.building_name ?? null,
    numberPrefix: floor.room_number_prefix ?? null,
    // ตัวอย่างเลขห้องถัดไปให้หน้าจอแสดง
    effectivePrefix: effectivePrefix(floor.room_number_prefix, index + 1),
    rooms: rooms
      .filter((r) => r.floor_id === floor.floor_id)
      .map((r) => ({ ...toPublicRoom(r), services: servicesByRoom.get(r.room_id) ?? [] }))
  }))
}

export function getRoomById(db, roomId) {
  const row = db
    .prepare(
      `SELECT r.*, rt.name AS room_type_name
         FROM rooms r
         LEFT JOIN room_types rt ON rt.room_type_id = r.room_type_id
        WHERE r.room_id = ?`
    )
    .get(roomId)
  return row ? toPublicRoom(row) : null
}

export function countRooms(db, apartmentId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM rooms r
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE f.apartment_id = ?`
    )
    .get(apartmentId).n
}

export function validateFloorPlan(specs) {
  const errors = []

  if (!Array.isArray(specs) || specs.length === 0) {
    errors.push('กรุณาระบุจำนวนชั้นอย่างน้อย 1 ชั้น')
    return errors
  }
  if (specs.length > MAX_FLOORS) errors.push(`จำนวนชั้นต้องไม่เกิน ${MAX_FLOORS} ชั้น`)

  const seenPrefixes = new Map()

  specs.forEach((spec, index) => {
    const count = Number(spec?.roomCount)
    if (!Number.isInteger(count) || count < 1) {
      errors.push(`ชั้นที่ ${index + 1}: กรุณากรอกจำนวนห้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป`)
    } else if (count > MAX_ROOMS_PER_FLOOR) {
      errors.push(`ชั้นที่ ${index + 1}: จำนวนห้องต้องไม่เกิน ${MAX_ROOMS_PER_FLOOR} ห้องต่อชั้น`)
    }

    try {
      const prefix = normalizeRoomNumberPrefix(spec?.numberPrefix)
      if (prefix) {
        if (seenPrefixes.has(prefix)) {
          errors.push(
            `ชั้นที่ ${index + 1}: เลขนำหน้า ${prefix} ซ้ำกับชั้นที่ ${seenPrefixes.get(prefix)}`
          )
        } else {
          seenPrefixes.set(prefix, index + 1)
        }
      }
      normalizeBuildingName(spec?.buildingName)
    } catch (err) {
      errors.push(`ชั้นที่ ${index + 1}: ${err.message}`)
    }
  })

  return errors
}

// เฉพาะหอที่ยังไม่มีชั้น — เพิ่มทีหลังใช้ addFloor
export function generateFloorPlan(db, apartmentId, specs) {
  if (db.prepare('SELECT COUNT(*) AS n FROM floors WHERE apartment_id = ?').get(apartmentId).n > 0) {
    throw new Error('หอพักนี้มีผังห้องอยู่แล้ว หากต้องการเพิ่มให้ใช้ปุ่มเพิ่มชั้น/เพิ่มห้อง')
  }

  const defaults = getUtilityDefaults(db, apartmentId)
  const now = new Date().toISOString()

  const run = db.transaction(() => {
    const roomTypeId = ensureRoomType(db, apartmentId)

    specs.forEach((spec, floorIndex) => {
      const ordinal = floorIndex + 1
      const roomCount = Number(spec.roomCount)
      const buildingName = normalizeBuildingName(spec.buildingName)
      const prefix = normalizeRoomNumberPrefix(spec.numberPrefix)
      assertPrefixFree(db, apartmentId, prefix)

      const floorId = db
        .prepare(
          `INSERT INTO floors (apartment_id, floor_name, building_name, room_number_prefix,
                               room_count, created_at)
           VALUES (?,?,?,?,?,?)`
        )
        .run(
          apartmentId,
          spec.floorName?.trim() || `ชั้น ${ordinal}`,
          buildingName,
          prefix,
          roomCount,
          now
        ).lastInsertRowid

      for (let i = 0; i < roomCount; i += 1) {
        createRoomRow(db, {
          floorId,
          roomTypeId,
          roomNumber: buildRoomNumber(effectivePrefix(prefix, ordinal), i),
          defaults,
          now
        })
      }
    })
  })
  run()

  return listFloors(db, apartmentId)
}

// จุดเดียวที่เขียน rooms — สร้าง room_utility_settings คู่กันเสมอ
function createRoomRow(db, { floorId, roomTypeId, roomNumber, defaults, now }) {
  const roomId = db
    .prepare(
      `INSERT INTO rooms (floor_id, room_type_id, room_number, is_active,
                          monthly_rent_cents, daily_rent_cents, status, created_at)
       VALUES (?, ?, ?, 1, 0, NULL, 'vacant', ?)`
    )
    .run(floorId, roomTypeId, roomNumber, now).lastInsertRowid

  insertRoomUtilitySettings(db, roomId, defaults, now)
  return roomId
}

export function addFloor(db, apartmentId, { floorName, roomCount, buildingName, numberPrefix } = {}) {
  const count = Number(roomCount)
  if (!Number.isInteger(count) || count < 0 || count > MAX_ROOMS_PER_FLOOR) {
    throw new Error(`จำนวนห้องต้องเป็นตัวเลข 0-${MAX_ROOMS_PER_FLOOR}`)
  }

  const existingFloors = db
    .prepare('SELECT COUNT(*) AS n FROM floors WHERE apartment_id = ?')
    .get(apartmentId).n
  if (existingFloors >= MAX_FLOORS) throw new Error(`จำนวนชั้นต้องไม่เกิน ${MAX_FLOORS} ชั้น`)

  const building = normalizeBuildingName(buildingName)
  const prefix = normalizeRoomNumberPrefix(numberPrefix)
  assertPrefixFree(db, apartmentId, prefix)

  const defaults = getUtilityDefaults(db, apartmentId)
  const now = new Date().toISOString()
  const ordinal = existingFloors + 1

  const run = db.transaction(() => {
    const roomTypeId = ensureRoomType(db, apartmentId)
    const floorId = db
      .prepare(
        `INSERT INTO floors (apartment_id, floor_name, building_name, room_number_prefix,
                             room_count, created_at)
         VALUES (?,?,?,?,?,?)`
      )
      .run(
        apartmentId,
        floorName?.trim() || `ชั้น ${ordinal}`,
        building,
        prefix,
        count,
        now
      ).lastInsertRowid

    for (let i = 0; i < count; i += 1) {
      const roomNumber = buildRoomNumber(effectivePrefix(prefix, ordinal), i)
      // เลขชนกับห้องที่ตั้งเอง ต้อง error ไม่ข้ามเงียบ
      assertRoomNumberAvailable(db, apartmentId, roomNumber)
      createRoomRow(db, { floorId, roomTypeId, roomNumber, defaults, now })
    }
  })
  run()

  return listFloors(db, apartmentId)
}

// เปลี่ยนเลขนำหน้าไม่แก้เลขห้องที่มีอยู่
export function updateFloor(db, floorId, { floorName, buildingName, numberPrefix } = {}) {
  const existing = db
    .prepare('SELECT apartment_id, floor_name FROM floors WHERE floor_id = ?')
    .get(floorId)
  if (!existing) throw new Error('ไม่พบชั้นที่ต้องการแก้ไข')

  // ไม่ส่งมา = ไม่แตะ · ส่งค่าว่าง = ล้างค่า
  const name = floorName === undefined ? existing.floor_name : String(floorName ?? '').trim()
  if (!name) throw new Error('กรุณากรอกชื่อชั้น')

  const fields = ['floor_name = @name']
  const params = { name, floorId, now: new Date().toISOString() }

  if (buildingName !== undefined) {
    fields.push('building_name = @buildingName')
    params.buildingName = normalizeBuildingName(buildingName)
  }
  if (numberPrefix !== undefined) {
    params.numberPrefix = normalizeRoomNumberPrefix(numberPrefix)
    assertPrefixFree(db, existing.apartment_id, params.numberPrefix, floorId)
    fields.push('room_number_prefix = @numberPrefix')
  }

  db.prepare(`UPDATE floors SET ${fields.join(', ')}, updated_at = @now WHERE floor_id = @floorId`)
    .run(params)

  return listFloors(db, existing.apartment_id)
}

// ลบได้เฉพาะชั้นที่ไม่มีห้องแล้ว
export function deleteFloor(db, floorId) {
  const apartmentId = apartmentIdOfFloor(db, floorId)
  const rooms = db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE floor_id = ?').get(floorId).n
  if (rooms > 0) {
    throw new Error(`ลบไม่ได้ เพราะชั้นนี้ยังมีห้องอยู่ ${rooms} ห้อง กรุณาลบห้องทั้งหมดก่อน`)
  }

  db.prepare('DELETE FROM floors WHERE floor_id = ?').run(floorId)
  return listFloors(db, apartmentId)
}

// ไม่ส่ง roomNumber = ตั้งเลขต่อให้เอง
export function addRoom(db, floorId, { roomNumber, roomTypeName } = {}) {
  const apartmentId = apartmentIdOfFloor(db, floorId)
  const number = String(roomNumber ?? '').trim() || nextRoomNumber(db, apartmentId, floorId)

  assertRoomNumberAvailable(db, apartmentId, number)

  const defaults = getUtilityDefaults(db, apartmentId)
  const now = new Date().toISOString()

  const run = db.transaction(() => {
    const roomTypeId = ensureRoomType(db, apartmentId, roomTypeName?.trim() || DEFAULT_ROOM_TYPE)
    createRoomRow(db, { floorId, roomTypeId, roomNumber: number, defaults, now })
  })
  run()

  return listFloors(db, apartmentId)
}

export function updateRoom(db, roomId, { roomNumber, roomTypeName, isActive }) {
  const existing = db
    .prepare('SELECT floor_id, room_number FROM rooms WHERE room_id = ?')
    .get(roomId)
  if (!existing) throw new Error('ไม่พบห้องที่ต้องการแก้ไข')

  const number = String(roomNumber ?? '').trim()
  if (!number) throw new Error('กรุณากรอกเลขห้อง')

  // ห้องที่มีสัญญาอยู่ปิดใช้งานไม่ได้
  if (!isActive) {
    const active = db
      .prepare("SELECT COUNT(*) AS n FROM contracts WHERE room_id = ? AND status = 'active'")
      .get(roomId).n
    if (active > 0) {
      throw new Error(
        `ห้อง ${existing.room_number} ยังมีสัญญาเช่าที่ใช้งานอยู่ ปิดใช้งานไม่ได้ — ` +
          'ถ้าผู้เช่าย้ายออกแล้ว ให้ยกเลิกสัญญาก่อน'
      )
    }
  }

  const apartmentId = apartmentIdOfFloor(db, existing.floor_id)
  assertRoomNumberAvailable(db, apartmentId, number, roomId)

  const run = db.transaction(() => {
    const roomTypeId = ensureRoomType(db, apartmentId, roomTypeName?.trim() || DEFAULT_ROOM_TYPE)
    db.prepare(
      `UPDATE rooms SET room_number = ?, room_type_id = ?, is_active = ?, updated_at = ?
        WHERE room_id = ?`
    ).run(number, roomTypeId, isActive ? 1 : 0, new Date().toISOString(), roomId)
  })
  run()

  return listFloors(db, apartmentId)
}

// เคยมีสัญญาลบไม่ได้ — ให้ปิดใช้งานแทน
export function deleteRoom(db, roomId) {
  const existing = db.prepare('SELECT floor_id FROM rooms WHERE room_id = ?').get(roomId)
  if (!existing) throw new Error('ไม่พบห้องที่ต้องการลบ')

  const contracts = db
    .prepare('SELECT COUNT(*) AS n FROM contracts WHERE room_id = ?')
    .get(roomId).n
  if (contracts > 0) {
    throw new Error('ลบไม่ได้ เพราะห้องนี้เคยมีสัญญาเช่าแล้ว หากเลิกใช้ให้ปิดใช้งานห้องแทน')
  }

  const apartmentId = apartmentIdOfFloor(db, existing.floor_id)

  const run = db.transaction(() => {
    // ตารางที่ผูก room_id ต้องล้างก่อน — เพิ่มตารางใหม่ต้องมาเพิ่มที่นี่
    db.prepare(
      `DELETE FROM maintenance_request_images
        WHERE maintenance_id IN (SELECT maintenance_id FROM maintenance_requests WHERE room_id = ?)`
    ).run(roomId)
    db.prepare('DELETE FROM maintenance_requests WHERE room_id = ?').run(roomId)
    db.prepare('DELETE FROM room_utility_settings WHERE room_id = ?').run(roomId)
    db.prepare('DELETE FROM room_services WHERE room_id = ?').run(roomId)
    db.prepare('DELETE FROM rooms WHERE room_id = ?').run(roomId)
    deleteOrphanImages(db)
  })
  run()

  return listFloors(db, apartmentId)
}

function assertRoomsBelongToSameApartment(db, roomIds) {
  if (!Array.isArray(roomIds) || roomIds.length === 0) {
    throw new Error('กรุณาเลือกห้องอย่างน้อย 1 ห้อง')
  }

  const placeholders = roomIds.map(() => '?').join(',')
  const apartmentIds = db
    .prepare(
      `SELECT DISTINCT f.apartment_id AS id
         FROM rooms r JOIN floors f ON f.floor_id = r.floor_id
        WHERE r.room_id IN (${placeholders})`
    )
    .all(...roomIds)
    .map((r) => r.id)

  if (apartmentIds.length === 0) throw new Error('ไม่พบห้องที่เลือก')
  // กันคำสั่งเดียวข้ามหอ
  if (apartmentIds.length > 1) throw new Error('ไม่สามารถตั้งค่าห้องข้ามหอพักในครั้งเดียวได้')

  return apartmentIds[0]
}

export function validateRoomRateInput({ monthlyRent, dailyRent }) {
  const errors = errorList()

  try {
    toCents(monthlyRent, 'ค่าเช่ารายเดือน')
  } catch (err) {
    errors.add('monthlyRent', err.message)
  }

  if (String(dailyRent ?? '').trim() !== '') {
    try {
      toCents(dailyRent, 'ค่าเช่ารายวัน')
    } catch (err) {
      errors.add('dailyRent', err.message)
    }
  }

  return errors
}

export function setRoomRates(db, roomIds, { monthlyRent, dailyRent }) {
  const apartmentId = assertRoomsBelongToSameApartment(db, roomIds)

  const monthly = toCents(monthlyRent, 'ค่าเช่ารายเดือน')
  // ว่าง = ไม่รับรายวัน (NULL ไม่ใช่ 0)
  const daily = String(dailyRent ?? '').trim() === '' ? null : toCents(dailyRent, 'ค่าเช่ารายวัน')

  const stmt = db.prepare(
    'UPDATE rooms SET monthly_rent_cents = ?, daily_rent_cents = ?, updated_at = ? WHERE room_id = ?'
  )
  const now = new Date().toISOString()
  const run = db.transaction(() => {
    for (const roomId of roomIds) stmt.run(monthly, daily, now, roomId)
  })
  run()

  return listFloors(db, apartmentId)
}

export function setRoomStatus(db, roomIds, status) {
  if (!ROOM_STATUSES.includes(status)) throw new Error('สถานะห้องไม่ถูกต้อง')
  const apartmentId = assertRoomsBelongToSameApartment(db, roomIds)

  // ห้องที่มีสัญญาตั้งเป็นว่างเองไม่ได้ — ต้องผ่านการย้ายออก
  if (status === 'vacant') {
    const placeholders = roomIds.map(() => '?').join(',')
    const occupied = db
      .prepare(
        `SELECT r.room_number FROM rooms r
           JOIN contracts c ON c.room_id = r.room_id AND c.status = 'active'
          WHERE r.room_id IN (${placeholders})`
      )
      .all(...roomIds)
      .map((r) => r.room_number)

    if (occupied.length > 0) {
      throw new Error(
        `ตั้งเป็นห้องว่างไม่ได้ เพราะห้อง ${occupied.join(', ')} ยังมีสัญญาเช่าที่ใช้งานอยู่ กรุณาแจ้งย้ายออกก่อน`
      )
    }
  }

  const stmt = db.prepare('UPDATE rooms SET status = ?, updated_at = ? WHERE room_id = ?')
  const now = new Date().toISOString()
  const run = db.transaction(() => {
    for (const roomId of roomIds) stmt.run(status, now, roomId)
  })
  run()

  return listFloors(db, apartmentId)
}

// ผูกบริการกับห้อง — ราคาถูกคัดลอกตอนทำสัญญา
function assertServicesBelongToApartment(db, apartmentId, serviceIds) {
  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    throw new Error('กรุณาเลือกค่าบริการอย่างน้อย 1 รายการ')
  }

  const placeholders = serviceIds.map(() => '?').join(',')
  const found = db
    .prepare(
      `SELECT COUNT(*) AS n FROM apartment_services
        WHERE apartment_id = ? AND service_id IN (${placeholders})`
    )
    .get(apartmentId, ...serviceIds).n

  if (found !== serviceIds.length) {
    throw new Error('มีค่าบริการที่ไม่ได้อยู่ในหอพักนี้')
  }
}

export function attachServicesToRooms(db, roomIds, serviceIds) {
  const apartmentId = assertRoomsBelongToSameApartment(db, roomIds)
  assertServicesBelongToApartment(db, apartmentId, serviceIds)

  // ห้องที่มีบริการอยู่แล้วข้ามไป
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO room_services (apartment_service_id, room_id, created_at) VALUES (?,?,?)'
  )
  const now = new Date().toISOString()
  const run = db.transaction(() => {
    for (const roomId of roomIds) {
      for (const serviceId of serviceIds) stmt.run(serviceId, roomId, now)
    }
  })
  run()

  return listFloors(db, apartmentId)
}

// นำออกไม่กระทบสัญญาเดิม (contract_services เก็บสำเนาเอง)
export function detachServicesFromRooms(db, roomIds, serviceIds) {
  const apartmentId = assertRoomsBelongToSameApartment(db, roomIds)
  assertServicesBelongToApartment(db, apartmentId, serviceIds)

  const stmt = db.prepare(
    'DELETE FROM room_services WHERE apartment_service_id = ? AND room_id = ?'
  )
  const run = db.transaction(() => {
    for (const roomId of roomIds) {
      for (const serviceId of serviceIds) stmt.run(serviceId, roomId)
    }
  })
  run()

  return listFloors(db, apartmentId)
}

export function toPublicRoom(row) {
  if (!row) return null
  return {
    roomId: row.room_id,
    floorId: row.floor_id,
    roomNumber: row.room_number,
    roomTypeName: row.room_type_name ?? null,
    isActive: row.is_active === 1,
    monthlyRentCents: row.monthly_rent_cents,
    dailyRentCents: row.daily_rent_cents,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
