// ตาราง meter_batches / meter_readings — SQL ดิบล้วน ไม่มี ORM
//
// โครงตามหน้า "จดมิเตอร์" ของต้นแบบ: หนึ่ง "ใบจดมิเตอร์" ต่อวันที่จด แล้วไล่กรอกทุกห้อง
// ในใบนั้น แยกหน้าน้ำกับหน้าไฟ ตารางคือ ห้อง | สถานะห้อง | จดครั้งก่อน | ปัจจุบัน | หน่วย
//
// ห้ามให้ไฟล์นี้ import logger.js หรืออะไรที่ลาก electron เข้ามา — เทสต์รันใต้
// ELECTRON_RUN_AS_NODE ซึ่ง electron เป็น CJS shim ที่ ESM import ไม่ได้

// ทั้งใบเก็บเลขน้ำและเลขไฟไว้แถวเดียวกันต่อห้อง (ตาม 001_init.sql) แต่หน้าจอกรอกทีละฝั่ง
// จึงต้องมี "ฝั่ง" เป็นแนวคิดชัดๆ ไม่งั้นทุกฟังก์ชันต้องเขียนสองชุดที่ต่างกันแค่ชื่อคอลัมน์
export const METER_SIDES = ['water', 'electric']

export const METER_SIDE_LABELS = {
  water: 'ค่าน้ำ',
  electric: 'ค่าไฟ'
}

// ชื่อคอลัมน์ของแต่ละฝั่ง รวมไว้ที่เดียว เพื่อให้ที่อื่นเขียนสูตรครั้งเดียวแล้วใช้ได้ทั้งคู่
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

// ------------------------------------------------------------------
// คำนวณหน่วยที่ใช้
// ------------------------------------------------------------------
// ปกติคือ ปัจจุบัน − ครั้งก่อน ตรงๆ
//
// มีสองเหตุการณ์ที่ทำให้เลขปัจจุบันน้อยกว่าครั้งก่อนได้โดยที่ไม่ได้จดผิด และทั้งสอง
// **คิดหน่วยคนละสูตรกัน** จึงต้องแยกให้ผู้ใช้เลือกว่าเจอเหตุการณ์ไหน:
//
// 1) เกินรอบมิเตอร์ — หน้าปัดวิ่งจนสุดแล้วหมุนกลับไปเริ่มที่ 0 ตัวมิเตอร์เป็นลูกเดิม
//    น้ำ/ไฟที่ใช้ระหว่างทางจนถึงจุดสุดหน้าปัดต้องถูกนับด้วย
//
// 2) เปลี่ยนมิเตอร์ลูกใหม่ — ของเก่าหยุดที่เลขหนึ่ง ของใหม่เริ่มที่อีกเลขหนึ่ง
//    ไม่มีช่วงไหนหายไป จึงไม่มีอะไรให้บวก แค่รวมหน่วยของสองลูกเข้าด้วยกัน
//
// เลือกผิดข้อคือบิลผิดเป็นหลักหมื่น — เปลี่ยนมิเตอร์แล้วไปติ๊ก "เกินรอบ" จะได้หน่วย
// เกินมาเกือบเต็มหน้าปัด และไม่มีอะไรเตือนเลยเพราะตัวเลขดูสมเหตุสมผลในตัวมันเอง
export function calculateUnitsUsed(previous, current, options) {
  // เดิมพารามิเตอร์ที่สามเป็น boolean ของ "เกินรอบมิเตอร์" ตัวเดียว รับทั้งสองแบบไว้
  // เพื่อให้ที่เรียกแบบเก่ายังอ่านออกว่าหมายถึงอะไร
  const opts = typeof options === 'object' && options !== null ? options : { isOverCycle: options }
  const { isOverCycle, isMeterReplaced, removedReading, newStartReading, meterDigits } = opts

  const digits = normalizeMeterDigits(meterDigits)
  // มิเตอร์ 5 หลักอ่านได้สูงสุด 99,999 แล้ววนกลับไป 0 — เลข 100,000 จึงเป็นจุดหมุนกลับ
  // และเป็นเพดานที่เลขบนหน้าปัดไปไม่ถึงในเวลาเดียวกัน
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

  // ติ๊กเกินรอบแล้วแต่เลขยังเดินหน้าปกติ = ติ๊กผิด คิดแบบธรรมดาให้ ไม่ต้องบวกรอบเกิน
  if (curr >= prev) return round2(curr - prev)

  // มิเตอร์ 5 หลัก ครั้งก่อน 99,850 ปัจจุบัน 120 → 100000 − 99850 + 120 = 270
  //
  // **จำนวนหลักมาจากค่าตั้งค่าของหอ ไม่ได้เดาจากเลขครั้งก่อนแล้ว** (เจ้าของหอยืนยัน
  // 2026-08-10 ว่าเป็น 5 หลัก) ของเดิมนับหลักของเลขครั้งก่อนเอา ซึ่งให้คำตอบตรงกันเฉพาะ
  // ตอนที่วนรอบจริง แต่ตอนติ๊กผิดมันจะเงียบ: ครั้งก่อน 850 ปัจจุบัน 120 เคยได้ 270
  // ทั้งที่มิเตอร์ 5 หลักต้องเดินไป 99,270 หน่วยถึงจะกลับมาที่ 120 ได้ — ตัวเลขที่บอกชัดว่า
  // ไม่ได้วนรอบ แต่ติ๊กผิด กลับถูกกลบจนดูสมเหตุสมผล
  return round2(rollover - prev + curr)
}

// จำนวนหลักต้องใช้ได้เสมอ ต่อให้ผู้เรียกลืมส่งมา — ตัวเลขนี้ไปเป็นตัวหารของบิล
// (10 ** 0 = 1 จะทำให้ทุกเลขมิเตอร์ "เกินหน้าปัด" แล้วบันทึกอะไรไม่ได้เลยทั้งหอ)
function normalizeMeterDigits(value) {
  const digits = Math.floor(Number(value))
  return Number.isInteger(digits) && digits >= 3 && digits <= 8 ? digits : 5
}

// มิเตอร์ 5 หลักอ่านได้ไม่เกิน 99,999 — เลขที่เกินนั้นคือพิมพ์เกินหลัก ไม่ใช่ค่าที่อ่านได้จริง
//
// เป็นความผิดพลาดที่เกิดง่ายที่สุดของงานนี้ (กด 0 เกินไปหนึ่งตัวตอนไล่พิมพ์เร็วๆ ทั้งหอ)
// และแพงที่สุด เพราะ 10,500 → 105,000 จะกลายเป็นค่าน้ำหลักหมื่นบาทในบิลใบเดียว
function requireWithinDial(value, rollover, digits, label) {
  if (value >= rollover) {
    throw new Error(
      `${label} (${value}) เกินหน้าปัดมิเตอร์ ${digits} หลัก ซึ่งอ่านได้สูงสุด ${rollover - 1} — ` +
        'กรุณาตรวจสอบเลขที่กรอก หรือแก้จำนวนหลักของมิเตอร์ที่หน้าตั้งค่าหอพัก'
    )
  }
}

// หน่วยที่ใช้ตอนเปลี่ยนมิเตอร์ = ส่วนที่ลูกเก่าเดินไปก่อนถูกถอด + ส่วนที่ลูกใหม่เดินมาจนถึงวันจด
//
//   (เลขถอดเก่า − ครั้งก่อน) + (ปัจจุบัน − เลขเริ่มลูกใหม่)
//
// เลขเริ่มลูกใหม่มักเป็น 0 แต่ไม่เสมอไป มิเตอร์มือสองหรือมิเตอร์ที่ช่างทดสอบมาก่อนติดตั้ง
// จะมีเลขค้างอยู่ ถ้าเหมาว่าเป็น 0 หน่วยที่ค้างในลูกใหม่จะถูกคิดเงินกับผู้เช่าทันที
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

  // มิเตอร์ลูกเก่าเดินถอยหลังไม่ได้ ถ้าเลขถอดน้อยกว่าครั้งก่อนแปลว่าจดผิด หรือลูกเก่า
  // หมุนครบรอบก่อนถูกถอดด้วย — กรณีหลังหายากจนไม่คุ้มจะเดาแทนผู้ใช้ ให้คนดูดีกว่า
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
  // มิเตอร์อ่านทศนิยมได้ (.5 หน่วย) แต่ float ทำให้ 100.1 - 2 กลายเป็น 98.09999999999999
  return Math.round(n * 100) / 100
}

// ------------------------------------------------------------------
// ใบจดมิเตอร์
// ------------------------------------------------------------------
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
      // ใบที่ออกบิลไปแล้วห้ามลบ/ห้ามแก้เลข ไม่งั้นบิลที่พิมพ์ส่งผู้เช่าไปแล้วจะไม่ตรงฐานข้อมูล
      isUsedForBilling: row.invoiceCount > 0
    }))
}

export function getBatchById(db, batchId) {
  const row = db.prepare('SELECT * FROM meter_batches WHERE batch_id = ?').get(batchId)
  if (!row) return null
  return { batchId: row.batch_id, apartmentId: row.apartment_id, readingDate: row.reading_date }
}

// จำนวนหลักของหน้าปัดมิเตอร์ ตั้งไว้ที่ระดับหอ (migration 020)
//
// อ่านด้วย SQL ตรงๆ ไม่ import db/apartments.js เพื่อไม่ให้สองโมดูลนี้อ้างกันไปมา
// — ตอนออกบิล invoices.js เรียกทั้งคู่อยู่แล้ว
function getMeterDigits(db, apartmentId) {
  const row = db.prepare('SELECT meter_digits FROM apartments WHERE apartment_id = ?').get(apartmentId)
  return row?.meter_digits ?? undefined
}

export function createBatch(db, apartmentId, readingDate) {
  if (!isDate(readingDate)) throw new Error('กรุณาเลือกวันที่จดมิเตอร์')

  const exists = db
    .prepare('SELECT batch_id FROM meter_batches WHERE apartment_id = ? AND reading_date = ?')
    .get(apartmentId, readingDate)
  if (exists) {
    throw new Error(`มีใบจดมิเตอร์ของวันที่ ${readingDate} อยู่แล้ว กรุณาเปิดใบเดิมเพื่อแก้ไข`)
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

// ------------------------------------------------------------------
// หน้ากรอกเลขมิเตอร์ของฝั่งหนึ่ง
// ------------------------------------------------------------------
// คืนทุกห้องที่เปิดใช้งานของหอ พร้อมเลข "จดครั้งก่อน" ที่ระบบหาให้ ตามลำดับ:
//   1) เลขปัจจุบันของใบจดก่อนหน้าใบนี้ (ไล่ตามวันที่)
//   2) เลขมิเตอร์วันเข้าพักที่บันทึกไว้ในสัญญาที่ยังใช้งานอยู่
//   3) 0 — ห้องว่างที่ไม่เคยมีสัญญาและไม่เคยจด
//
// ต้องมีข้อ 2 ไม่งั้นบิลเดือนแรกของผู้เช่าใหม่จะคิดหน่วยตั้งแต่เลขที่ผู้เช่าคนก่อนทิ้งไว้
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
              (SELECT c.${cols.contractStart}
                 FROM contracts c
                WHERE c.room_id = r.room_id AND c.status = 'active'
                ORDER BY c.start_date DESC, c.contract_id DESC
                LIMIT 1) AS contractStart
         FROM rooms r
         JOIN floors f ON f.floor_id = r.floor_id
         LEFT JOIN meter_readings saved
                ON saved.room_id = r.room_id AND saved.meter_batch_id = @batchId
        WHERE f.apartment_id = @apartmentId AND r.is_active = 1
        ORDER BY f.floor_id, r.room_number`
    )
    .all({ batchId, apartmentId: batch.apartmentId, readingDate: batch.readingDate })

  return {
    batchId: batch.batchId,
    readingDate: batch.readingDate,
    side,
    // หน้าจอต้องใช้ตัวเลขเดียวกับที่ฝั่ง main ใช้คำนวณ ไม่งั้นตัวเลขหน่วยที่ขึ้นระหว่างพิมพ์
    // จะไม่ตรงกับที่บันทึกจริง
    meterDigits: normalizeMeterDigits(getMeterDigits(db, batch.apartmentId)),
    rooms: rows.map((row) => {
      // เลขครั้งก่อนที่ระบบไล่หาให้ — เลขปิดของรอบก่อนหน้า แล้วค่อยลงไปที่เลขมิเตอร์
      // วันเข้าพักในสัญญา สุดท้ายคือ 0
      const derived = Number(row.lastReading ?? row.contractStart ?? 0)
      return {
        roomId: row.room_id,
        roomNumber: row.room_number,
        floorName: row.floor_name,
        status: row.status,
        // แถวที่บันทึกไปแล้วแสดงเลขที่บันทึกไว้จริง เพราะจำนวนหน่วยที่คิดไปแล้วมาจากเลขนั้น
        // ถ้าแสดงเลขที่ไล่หาใหม่ ตัวเลขบนจอจะไม่ตรงกับหน่วยที่อยู่ข้างๆ
        previousReading: Number(row.savedPrevious ?? derived),
        // เลขที่ระบบไล่หาให้ — ตอนบันทึกใช้ตัวนี้เสมอ ไม่ใช้ค่าที่หน้าจอส่งมา
        derivedPreviousReading: derived,
        currentReading: row.savedCurrent === null ? null : Number(row.savedCurrent),
        unitsUsed: row.savedUnits === null ? null : Number(row.savedUnits),
        isOverCycle: row.savedOverCycle === 1,
        isMeterReplaced: row.savedReplaced === 1,
        removedReading: row.savedRemoved === null ? null : Number(row.savedRemoved),
        newStartReading: row.savedNewStart === null ? null : Number(row.savedNewStart),
        isSaved: row.savedCurrent !== null
      }
    })
  }
}

// ------------------------------------------------------------------
// บันทึกเลขมิเตอร์ทั้งใบ (ฝั่งเดียว)
// ------------------------------------------------------------------
// รับทั้งหน้าเป็นก้อนเดียว เพราะต้นแบบให้กรอกทั้งตารางแล้วกดบันทึกครั้งเดียว
// ถ้าแถวไหนคำนวณไม่ผ่าน ต้องไม่มีแถวไหนถูกเขียนเลย — ครึ่งใบที่บันทึกสำเร็จอ่านไม่ออก
// ว่าตกลงจดครบหรือยัง
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

  // **เลขครั้งก่อนคิดจากฝั่งนี้เสมอ ไม่รับค่าที่หน้าจอส่งมา**
  //
  // เลขปิดของรอบก่อนคือเลขเปิดของรอบนี้ ไม่ใช่ตัวเลขที่ใครจะกรอกทับได้ ถ้าปล่อยให้แก้
  // โซ่ของมิเตอร์จะขาดตรงไหนก็ได้ แล้วหน่วยที่หายไประหว่างสองรอบจะไม่มีใครเรียกเก็บ
  // — และไม่มีทางรู้ย้อนหลังว่าขาดตรงไหน เพราะทุกแถวดูสมเหตุสมผลในตัวเอง
  //
  // ล็อกที่หน้าจออย่างเดียวไม่พอ ต้องบังคับที่นี่ด้วย ไม่งั้นก็ยังส่งค่าอื่นเข้ามาได้อยู่ดี
  const sheet = getBatchSheet(db, batchId, side)
  const derived = new Map(sheet.rooms.map((r) => [r.roomId, r.derivedPreviousReading]))
  // จำนวนหลักมาจากค่าตั้งค่าของหอเสมอ ไม่รับจากหน้าจอ — เหตุผลเดียวกับเลขครั้งก่อน
  const meterDigits = sheet.meterDigits

  // คำนวณและตรวจให้ครบทุกแถวก่อน แล้วค่อยเขียน — รวบ error ทุกแถวไว้บอกทีเดียว
  // ไม่ใช่ให้ผู้ใช้แก้ทีละแถวแล้วกดบันทึกใหม่รอบละห้อง
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
        // เก็บเลขของการเปลี่ยนมิเตอร์เฉพาะรอบที่เปลี่ยนจริง แถวอื่นต้องเป็น NULL
        // ไม่ใช่ 0 — 0 เป็นเลขมิเตอร์ที่อ่านได้จริง แยกจาก "ไม่มีเหตุการณ์นี้" ไม่ออก
        removed: row.isMeterReplaced ? Number(row.removedReading) : null,
        newStart: row.isMeterReplaced ? Number(row.newStartReading) : null
      })
    } catch (err) {
      errors.push(`ห้อง ${label}: ${err.message}`)
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'))

  const now = new Date().toISOString()
  // แถวหนึ่งเก็บทั้งน้ำและไฟ แต่หน้าจอบันทึกทีละฝั่ง คอลัมน์ของอีกฝั่งจึงถูกปล่อยเป็น NULL
  //
  // **ห้ามเขียนเป็น 0** — เคยทำแบบนั้นตอนที่คอลัมน์ยังเป็น NOT NULL แล้วหน้าจอของฝั่งที่สอง
  // อ่านเลข 0 นั้นว่า "บันทึกไว้แล้ว" จึงไม่ไล่หาเลขครั้งก่อนจากรอบที่แล้วหรือจากสัญญาต่อ
  // ผู้ใช้เลยต้องพิมพ์เลขครั้งก่อนของฝั่งไฟเองทุกเดือน (ดู migration 014)
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

// ------------------------------------------------------------------
function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
