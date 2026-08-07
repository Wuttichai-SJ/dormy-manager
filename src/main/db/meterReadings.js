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
    contractStart: 'water_meter_start'
  },
  electric: {
    previous: 'electric_previous_reading',
    current: 'electric_current_reading',
    units: 'electric_units_used',
    overCycle: 'is_electric_over_cycle',
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
// ปกติคือ ปัจจุบัน - ครั้งก่อน ตรงๆ
//
// "เกินรอบมิเตอร์" คือกรณีที่หน้าปัดมิเตอร์วิ่งจนสุดแล้วหมุนกลับไปเริ่มใหม่ที่ 0
// (เช่นมิเตอร์ 5 หลักอ่านได้ 99,850 เดือนถัดมาอ่านได้ 120) เลขปัจจุบันจะน้อยกว่าครั้งก่อน
// ทั้งที่ใช้น้ำ/ไฟไปจริง ถ้าลบตรงๆ จะได้ค่าติดลบแล้วบิลออกมาผิด
//
// เราไม่รู้ว่ามิเตอร์แต่ละตัวมีกี่หลัก จึงเดาจากจำนวนหลักของเลขครั้งก่อน:
// ครั้งก่อน 99,850 = 5 หลัก → จุดหมุนกลับคือ 100,000 → หน่วยที่ใช้ = 100000 - 99850 + 120
//
// **ข้อสมมติที่ยังไม่ได้ยืนยันกับของจริง** — ถ้าเจ้าของหอเจอมิเตอร์หมุนครบรอบจริงเมื่อไหร่
// ให้เทียบตัวเลขที่ระบบคิดกับที่การประปา/การไฟฟ้าคิด แล้วกลับมาแก้ตรงนี้
export function calculateUnitsUsed(previous, current, isOverCycle) {
  const prev = Number(previous ?? 0)
  const curr = Number(current ?? 0)

  if (prev < 0 || curr < 0) throw new Error('เลขมิเตอร์ติดลบไม่ได้')

  if (!isOverCycle) {
    if (curr < prev) {
      throw new Error(
        `เลขมิเตอร์ปัจจุบัน (${curr}) น้อยกว่าครั้งก่อน (${prev}) — ` +
          'ถ้ามิเตอร์หมุนครบรอบกลับมาเริ่มใหม่ ให้ติ๊ก "เกินรอบมิเตอร์"'
      )
    }
    return round2(curr - prev)
  }

  // ติ๊กเกินรอบแล้วแต่เลขยังเดินหน้าปกติ = ติ๊กผิด คิดแบบธรรมดาให้ ไม่ต้องบวกรอบเกิน
  if (curr >= prev) return round2(curr - prev)

  const digits = String(Math.floor(prev)).length
  const rollover = 10 ** digits
  return round2(rollover - prev + curr)
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
  const derived = new Map(
    getBatchSheet(db, batchId, side).rooms.map((r) => [r.roomId, r.derivedPreviousReading])
  )

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
      const units = calculateUnitsUsed(previous, row.currentReading, row.isOverCycle)
      prepared.push({
        roomId: row.roomId,
        previous,
        current: Number(row.currentReading ?? 0),
        units,
        overCycle: row.isOverCycle ? 1 : 0
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
       created_at
     ) VALUES (
       @batchId, @roomId,
       @previous, @current, @units, @overCycle,
       @now
     )
     ON CONFLICT (meter_batch_id, room_id) DO UPDATE SET
       ${cols.previous} = @previous,
       ${cols.current}  = @current,
       ${cols.units}    = @units,
       ${cols.overCycle} = @overCycle,
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
