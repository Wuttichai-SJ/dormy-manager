// ห้าม import electron/logger — ชุดทดสอบรันแบบ node
import { FieldError } from '../fieldError.js'

export const METER_SIDES = ['water', 'electric']

export const METER_SIDE_LABELS = {
  water: 'ค่าน้ำ',
  electric: 'ค่าไฟ'
}

const SIDE_COLUMNS = {
  water: {
    previous: 'water_previous_reading',
    current: 'water_current_reading',
    units: 'water_units_used',
    overCycle: 'is_water_over_cycle',
    replaced: 'is_water_meter_replaced',
    removed: 'water_removed_reading',
    newStart: 'water_new_start_reading',
    contractStart: 'water_meter_start'
  },
  electric: {
    previous: 'electric_previous_reading',
    current: 'electric_current_reading',
    units: 'electric_units_used',
    overCycle: 'is_electric_over_cycle',
    replaced: 'is_electric_meter_replaced',
    removed: 'electric_removed_reading',
    newStart: 'electric_new_start_reading',
    contractStart: 'electric_meter_start'
  }
}

function columnsFor(side) {
  const cols = SIDE_COLUMNS[side]
  if (!cols) throw new Error(`ฝั่งมิเตอร์ไม่ถูกต้อง: ${side}`)
  return cols
}

// ปัจจุบันน้อยกว่าครั้งก่อนมี 2 กรณี คิดคนละสูตร: เกินรอบมิเตอร์ / เปลี่ยนมิเตอร์ลูกใหม่
export function calculateUnitsUsed(previous, current, options) {
  // รับ boolean แบบเก่า (= เกินรอบ) ด้วย
  const opts = typeof options === 'object' && options !== null ? options : { isOverCycle: options }
  const { isOverCycle, isMeterReplaced, removedReading, newStartReading, meterDigits } = opts

  const digits = normalizeMeterDigits(meterDigits)
  const rollover = 10 ** digits

  const prev = Number(previous ?? 0)
  const curr = Number(current ?? 0)

  if (prev < 0 || curr < 0) throw new Error('เลขมิเตอร์ติดลบไม่ได้')
  requireWithinDial(curr, rollover, digits, 'เลขมิเตอร์ปัจจุบัน')

  if (isMeterReplaced) {
    if (isOverCycle) {
      throw new Error('เลือก "เกินรอบมิเตอร์" กับ "เปลี่ยนมิเตอร์ใหม่" พร้อมกันไม่ได้')
    }
    return unitsAcrossMeterChange(prev, curr, removedReading, newStartReading, rollover, digits)
  }

  if (!isOverCycle) {
    if (curr < prev) {
      throw new Error(
        `เลขมิเตอร์ปัจจุบัน (${curr}) น้อยกว่าครั้งก่อน (${prev}) — ` +
          'ถ้ามิเตอร์หมุนครบรอบกลับมาเริ่มใหม่ ให้ติ๊ก "เกินรอบมิเตอร์" ' +
          'ถ้าเปลี่ยนมิเตอร์ลูกใหม่ ให้ติ๊ก "เปลี่ยนมิเตอร์ใหม่"'
      )
    }
    return round2(curr - prev)
  }

  if (curr >= prev) return round2(curr - prev)

  // เช่น 5 หลัก: ครั้งก่อน 99,850 ปัจจุบัน 120 → 100000 − 99850 + 120 = 270
  return round2(rollover - prev + curr)
}

// จำนวนหลักต้องใช้ได้เสมอ — เป็นตัวหาร
function normalizeMeterDigits(value) {
  const digits = Math.floor(Number(value))
  return Number.isInteger(digits) && digits >= 3 && digits <= 8 ? digits : 5
}

// เลขเกินหน้าปัด = พิมพ์เกินหลัก
function requireWithinDial(value, rollover, digits, label) {
  if (value >= rollover) {
    throw new Error(
      `${label} (${value}) เกินหน้าปัดมิเตอร์ ${digits} หลัก ซึ่งอ่านได้สูงสุด ${rollover - 1} — ` +
        'กรุณาตรวจสอบเลขที่กรอก หรือแก้จำนวนหลักของมิเตอร์ที่หน้าตั้งค่าหอพัก'
    )
  }
}

// (เลขถอดเก่า − ครั้งก่อน) + (ปัจจุบัน − เลขเริ่มลูกใหม่)
function unitsAcrossMeterChange(prev, curr, removedReading, newStartReading, rollover, digits) {
  if (removedReading === null || removedReading === undefined || removedReading === '') {
    throw new Error('เปลี่ยนมิเตอร์ใหม่ ต้องกรอกเลขตอนถอดมิเตอร์เก่า')
  }
  if (newStartReading === null || newStartReading === undefined || newStartReading === '') {
    throw new Error('เปลี่ยนมิเตอร์ใหม่ ต้องกรอกเลขเริ่มต้นของมิเตอร์ลูกใหม่')
  }

  const removed = Number(removedReading)
  const newStart = Number(newStartReading)

  if (!Number.isFinite(removed) || !Number.isFinite(newStart)) {
    throw new Error('เลขมิเตอร์ตอนเปลี่ยนต้องเป็นตัวเลข')
  }
  if (removed < 0 || newStart < 0) throw new Error('เลขมิเตอร์ติดลบไม่ได้')
  requireWithinDial(removed, rollover, digits, 'เลขตอนถอดมิเตอร์เก่า')
  requireWithinDial(newStart, rollover, digits, 'เลขเริ่มต้นของมิเตอร์ลูกใหม่')

  if (removed < prev) {
    throw new Error(
      `เลขตอนถอดมิเตอร์เก่า (${removed}) น้อยกว่าเลขที่จดครั้งก่อน (${prev}) — กรุณาตรวจสอบเลขที่กรอก`
    )
  }
  if (curr < newStart) {
    throw new Error(
      `เลขมิเตอร์ปัจจุบัน (${curr}) น้อยกว่าเลขเริ่มต้นของมิเตอร์ลูกใหม่ (${newStart}) — กรุณาตรวจสอบเลขที่กรอก`
    )
  }

  return round2(removed - prev + (curr - newStart))
}

function round2(n) {
  // ปัดแก้ float (100.1 - 2)
  return Math.round(n * 100) / 100
}

export function listBatches(db, apartmentId) {
  return db
    .prepare(
      `SELECT b.batch_id, b.reading_date, b.created_at,
              (SELECT COUNT(*) FROM meter_readings r WHERE r.meter_batch_id = b.batch_id) AS roomCount,
              (SELECT COUNT(*) FROM invoices i WHERE i.meter_batch_id = b.batch_id
                 AND i.status <> 'cancelled') AS invoiceCount
         FROM meter_batches b
        WHERE b.apartment_id = ?
        ORDER BY b.reading_date DESC, b.batch_id DESC`
    )
    .all(apartmentId)
    .map((row) => ({
      batchId: row.batch_id,
      readingDate: row.reading_date,
      createdAt: row.created_at,
      roomCount: row.roomCount,
      // ใบที่ออกบิลแล้วห้ามลบหรือแก้เลข
      isUsedForBilling: row.invoiceCount > 0
    }))
}

export function getBatchById(db, batchId) {
  const row = db.prepare('SELECT * FROM meter_batches WHERE batch_id = ?').get(batchId)
  if (!row) return null
  return { batchId: row.batch_id, apartmentId: row.apartment_id, readingDate: row.reading_date }
}

function getMeterDigits(db, apartmentId) {
  const row = db.prepare('SELECT meter_digits FROM apartments WHERE apartment_id = ?').get(apartmentId)
  return row?.meter_digits ?? undefined
}

export function createBatch(db, apartmentId, readingDate) {
  if (!isDate(readingDate)) throw new FieldError({ readingDate: 'กรุณาเลือกวันที่จดมิเตอร์' })

  const exists = db
    .prepare('SELECT batch_id FROM meter_batches WHERE apartment_id = ? AND reading_date = ?')
    .get(apartmentId, readingDate)
  if (exists) {
    throw new FieldError({
      readingDate: `มีใบจดมิเตอร์ของวันที่ ${readingDate} อยู่แล้ว กรุณาเปิดใบเดิมเพื่อแก้ไข`
    })
  }

  const now = new Date().toISOString()
  const result = db
    .prepare(
      'INSERT INTO meter_batches (apartment_id, reading_date, created_at) VALUES (?, ?, ?)'
    )
    .run(apartmentId, readingDate, now)

  return getBatchById(db, result.lastInsertRowid)
}

export function deleteBatch(db, batchId) {
  const batch = getBatchById(db, batchId)
  if (!batch) throw new Error('ไม่พบใบจดมิเตอร์ที่ต้องการลบ')

  const used = db
    .prepare(
      "SELECT COUNT(*) AS n FROM invoices WHERE meter_batch_id = ? AND status <> 'cancelled'"
    )
    .get(batchId).n
  if (used > 0) {
    throw new Error('ลบไม่ได้ เพราะใบจดมิเตอร์นี้ถูกใช้ออกบิลไปแล้ว')
  }

  const run = db.transaction(() => {
    db.prepare('DELETE FROM meter_readings WHERE meter_batch_id = ?').run(batchId)
    db.prepare('DELETE FROM meter_batches WHERE batch_id = ?').run(batchId)
  })
  run()
  return true
}

// เลขครั้งก่อน: สัญญาเริ่มหลังรอบจดล่าสุด → เลขวันเข้าพัก · นอกนั้น → เลขรอบก่อน · ไม่มีเลย → 0
export function getBatchSheet(db, batchId, side) {
  const cols = columnsFor(side)
  const batch = getBatchById(db, batchId)
  if (!batch) throw new Error('ไม่พบใบจดมิเตอร์')

  const rows = db
    .prepare(
      `SELECT r.room_id, r.room_number, r.status, f.floor_id, f.floor_name,
              saved.${cols.previous} AS savedPrevious,
              saved.${cols.current}  AS savedCurrent,
              saved.${cols.units}    AS savedUnits,
              saved.${cols.overCycle} AS savedOverCycle,
              saved.${cols.replaced} AS savedReplaced,
              saved.${cols.removed}  AS savedRemoved,
              saved.${cols.newStart} AS savedNewStart,
              (SELECT pr.${cols.current}
                 FROM meter_readings pr
                 JOIN meter_batches pb ON pb.batch_id = pr.meter_batch_id
                WHERE pr.room_id = r.room_id
                  AND pb.apartment_id = @apartmentId
                  -- ข้ามรอบที่จดแต่อีกฝั่ง — แถวมีอยู่ก็จริงแต่ฝั่งนี้ยังเป็น NULL
                  -- ต้องไล่ย้อนไปหารอบที่จดฝั่งนี้ไว้จริง ไม่ใช่หยุดแค่รอบล่าสุด
                  AND pr.${cols.current} IS NOT NULL
                  AND (pb.reading_date < @readingDate
                       OR (pb.reading_date = @readingDate AND pb.batch_id < @batchId))
                ORDER BY pb.reading_date DESC, pb.batch_id DESC
                LIMIT 1) AS lastReading,
              -- วันที่ของรอบที่ให้เลขข้างบนมา — ต้องรู้เพื่อเทียบกับวันเริ่มสัญญา
              -- (เงื่อนไขเดียวกันเป๊ะกับซับคิวรีข้างบน ถ้าแก้ต้องแก้ทั้งคู่)
              (SELECT pb.reading_date
                 FROM meter_readings pr
                 JOIN meter_batches pb ON pb.batch_id = pr.meter_batch_id
                WHERE pr.room_id = r.room_id
                  AND pb.apartment_id = @apartmentId
                  AND pr.${cols.current} IS NOT NULL
                  AND (pb.reading_date < @readingDate
                       OR (pb.reading_date = @readingDate AND pb.batch_id < @batchId))
                ORDER BY pb.reading_date DESC, pb.batch_id DESC
                LIMIT 1) AS lastReadingDate,
              (SELECT c.${cols.contractStart}
                 FROM contracts c
                WHERE c.room_id = r.room_id AND c.status = 'active'
                ORDER BY c.start_date DESC, c.contract_id DESC
                LIMIT 1) AS contractStart,
              (SELECT c.start_date
                 FROM contracts c
                WHERE c.room_id = r.room_id AND c.status = 'active'
                ORDER BY c.start_date DESC, c.contract_id DESC
                LIMIT 1) AS contractStartDate
         FROM rooms r
         JOIN floors f ON f.floor_id = r.floor_id
         LEFT JOIN meter_readings saved
                ON saved.room_id = r.room_id AND saved.meter_batch_id = @batchId
        WHERE f.apartment_id = @apartmentId AND r.is_active = 1
        ORDER BY f.floor_id, r.room_number`
    )
    .all({ batchId, apartmentId: batch.apartmentId, readingDate: batch.readingDate })

  // ห้องที่ปิดใช้งานแต่ยังมีผู้เช่า ต้องแสดงให้เห็น
  const hiddenRooms = db
    .prepare(
      `SELECT r.room_number
         FROM rooms r
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE f.apartment_id = ? AND r.is_active = 0
          AND EXISTS (SELECT 1 FROM contracts c
                       WHERE c.room_id = r.room_id AND c.status = 'active')
        ORDER BY r.room_number`
    )
    .all(batch.apartmentId)
    .map((row) => row.room_number)

  const newTenantRooms = []

  const sheetRooms = rows.map((row) => {
    const lastReading = row.lastReading === null ? null : Number(row.lastReading)
    const contractMeterStart = row.contractStart === null ? null : Number(row.contractStart)

    // วันเท่ากัน = จดวันย้ายเข้าพอดี ใช้เลขนั้นต่อได้
    const startsFromContract =
      contractMeterStart !== null &&
      (lastReading === null ||
        (Boolean(row.contractStartDate) && row.lastReadingDate < row.contractStartDate))

    const derived = startsFromContract ? contractMeterStart : (lastReading ?? 0)
    const previousSource = startsFromContract ? 'contract' : lastReading === null ? 'none' : 'batch'
    const supersededReading = startsFromContract ? lastReading : null

    if (supersededReading !== null) {
      newTenantRooms.push({
        roomNumber: row.room_number,
        contractStartDate: row.contractStartDate,
        previousReading: derived,
        supersededReading
      })
    }

    return {
      roomId: row.room_id,
      roomNumber: row.room_number,
      floorName: row.floor_name,
      status: row.status,
      previousReading: Number(row.savedPrevious ?? derived),
      derivedPreviousReading: derived,
      // 'batch' / 'contract' / 'none'
      previousSource,
      contractStartDate: row.contractStartDate ?? null,
      supersededReading,
      currentReading: row.savedCurrent === null ? null : Number(row.savedCurrent),
      unitsUsed: row.savedUnits === null ? null : Number(row.savedUnits),
      isOverCycle: row.savedOverCycle === 1,
      isMeterReplaced: row.savedReplaced === 1,
      removedReading: row.savedRemoved === null ? null : Number(row.savedRemoved),
      newStartReading: row.savedNewStart === null ? null : Number(row.savedNewStart),
      isSaved: row.savedCurrent !== null
    }
  })

  return {
    batchId: batch.batchId,
    readingDate: batch.readingDate,
    side,
    hiddenRooms,
    newTenantRooms,
    // หน้าจอต้องใช้ตัวเลขเดียวกับที่ main คำนวณ
    meterDigits: normalizeMeterDigits(getMeterDigits(db, batch.apartmentId)),
    rooms: sheetRooms
  }
}

// บันทึกทั้งใบ — แถวไหนไม่ผ่านต้องไม่เขียนเลยสักแถว
export function saveBatchReadings(db, batchId, side, rows) {
  const cols = columnsFor(side)
  const batch = getBatchById(db, batchId)
  if (!batch) throw new Error('ไม่พบใบจดมิเตอร์')

  const used = db
    .prepare(
      "SELECT COUNT(*) AS n FROM invoices WHERE meter_batch_id = ? AND status <> 'cancelled'"
    )
    .get(batchId).n
  if (used > 0) {
    throw new Error('แก้ไขไม่ได้ เพราะใบจดมิเตอร์นี้ถูกใช้ออกบิลไปแล้ว')
  }

  // เลขครั้งก่อนคิดที่ main เสมอ ไม่รับจากหน้าจอ
  const sheet = getBatchSheet(db, batchId, side)
  const derived = new Map(sheet.rooms.map((r) => [r.roomId, r.derivedPreviousReading]))
  // จำนวนหลักมาจากค่าของหอ ไม่รับจากหน้าจอ
  const meterDigits = sheet.meterDigits

  const errors = []
  const prepared = []
  for (const row of rows ?? []) {
    const label = row.roomNumber ?? `ห้อง #${row.roomId}`
    if (!derived.has(row.roomId)) {
      errors.push(`ห้อง ${label}: ไม่ได้อยู่ในหอพักของใบจดมิเตอร์นี้`)
      continue
    }

    const previous = derived.get(row.roomId)
    try {
      const units = calculateUnitsUsed(previous, row.currentReading, {
        isOverCycle: row.isOverCycle,
        isMeterReplaced: row.isMeterReplaced,
        removedReading: row.removedReading,
        newStartReading: row.newStartReading,
        meterDigits
      })
      prepared.push({
        roomId: row.roomId,
        previous,
        current: Number(row.currentReading ?? 0),
        units,
        overCycle: row.isOverCycle ? 1 : 0,
        replaced: row.isMeterReplaced ? 1 : 0,
        // ไม่ได้เปลี่ยนมิเตอร์ = NULL (ไม่ใช่ 0)
        removed: row.isMeterReplaced ? Number(row.removedReading) : null,
        newStart: row.isMeterReplaced ? Number(row.newStartReading) : null
      })
    } catch (err) {
      errors.push(`ห้อง ${label}: ${err.message}`)
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'))

  const now = new Date().toISOString()
  // อีกฝั่งปล่อยเป็น NULL — ห้ามเขียน 0
  const upsert = db.prepare(
    `INSERT INTO meter_readings (
       meter_batch_id, room_id,
       ${cols.previous}, ${cols.current}, ${cols.units}, ${cols.overCycle},
       ${cols.replaced}, ${cols.removed}, ${cols.newStart},
       created_at
     ) VALUES (
       @batchId, @roomId,
       @previous, @current, @units, @overCycle,
       @replaced, @removed, @newStart,
       @now
     )
     ON CONFLICT (meter_batch_id, room_id) DO UPDATE SET
       ${cols.previous} = @previous,
       ${cols.current}  = @current,
       ${cols.units}    = @units,
       ${cols.overCycle} = @overCycle,
       ${cols.replaced} = @replaced,
       ${cols.removed}  = @removed,
       ${cols.newStart} = @newStart,
       updated_at = @now`
  )

  const run = db.transaction(() => {
    for (const row of prepared) upsert.run({ ...row, batchId, now })
  })
  run()

  return getBatchSheet(db, batchId, side)
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
