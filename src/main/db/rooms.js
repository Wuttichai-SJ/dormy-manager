// ตาราง floors + rooms + room_utility_settings — ผังห้องของหอพัก
//
// สามตารางนี้อยู่ไฟล์เดียวกันเพราะเป็นเรื่องเดียวกันในสายตาผู้ใช้ ("ผังห้อง") และ
// แทบทุกคำสั่งต้องแตะพร้อมกัน — สร้างห้องหนึ่งห้องคือเขียน rooms + room_utility_settings
// เสมอ ถ้าแยกไฟล์จะมีโอกาสที่ใครสักคนเขียน rooms อย่างเดียวแล้วลืมอีกตาราง
//
// หมายเหตุ: ไฟล์ใน db/ ห้าม import logger.js หรืออะไรที่ดึง electron เข้ามา
// (เหตุผลอยู่ใน db/bankAccounts.js) — การ log เป็นหน้าที่ของชั้น handlers
import { getUtilityDefaults } from './utilityDefaults.js'

// ต้นแบบจำกัดไว้ที่ 50 ห้อง/ชั้น และ 30 ชั้น — ใช้ตัวเลขเดียวกัน
// ไม่ใช่เพราะระบบทำมากกว่านี้ไม่ได้ แต่เกินจากนี้แปลว่าผู้ใช้พิมพ์ผิด
// (ไม่มีหอพักไหนมี 500 ห้องในชั้นเดียว) ปล่อยผ่านแล้วจะได้ห้องขยะ 500 ห้องให้ตามลบ
export const MAX_FLOORS = 30
export const MAX_ROOMS_PER_FLOOR = 50

// ชื่อประเภทห้องที่สร้างให้อัตโนมัติตอนยังไม่มีอะไรเลย
// ตาราง rooms บังคับ room_type_id NOT NULL แต่ตอนสร้างผังห้องครั้งแรกผู้ใช้ยังไม่ได้
// คิดเรื่องประเภทห้อง — สร้างประเภทกลางๆ ให้ก่อน แล้วค่อยแก้ทีหลังได้
export const DEFAULT_ROOM_TYPE = 'ทั่วไป'

// -----------------------------------------------------
// ตัวช่วย
// -----------------------------------------------------
// เลขห้องอัตโนมัติ: ชั้น 1 ได้ 101, 102, 103 / ชั้น 10 ได้ 1001, 1002
// เติมศูนย์ให้ลำดับห้องเป็น 2 หลักเสมอ เพื่อให้เรียงตามตัวอักษรแล้วยังถูกลำดับ
// (ถ้าไม่เติม ชั้น 1 ที่มี 12 ห้องจะเรียงเป็น 101, 1010, 1011, 102 ... ซึ่งอ่านแล้วงง)
export function buildRoomNumber(floorNumber, index) {
  return `${floorNumber}${String(index + 1).padStart(2, '0')}`
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

// คัดลอกวิธีคิดค่าน้ำ/ค่าไฟของหอลงห้องที่เพิ่งสร้าง
// ต้องทำทุกครั้งที่สร้างห้อง ไม่ใช่ปล่อยว่างไว้แล้วค่อยมาเติม เพราะ room_utility_settings
// เป็นตัวที่ตอนออกบิลใช้จริง ห้องที่ไม่มีแถวนี้จะออกบิลค่าน้ำค่าไฟไม่ได้เลย
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

// เลขห้องต้องไม่ซ้ำทั้งหอ ไม่ใช่แค่ในชั้นเดียวกัน (unique index กันได้แค่ระดับชั้น)
// เพราะเวลาผู้เช่าบอกว่า "ห้อง 205" ไม่มีใครถามต่อว่าชั้นไหน
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

// -----------------------------------------------------
// อ่าน
// -----------------------------------------------------
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

  return floors.map((floor) => ({
    floorId: floor.floor_id,
    apartmentId: floor.apartment_id,
    floorName: floor.floor_name,
    rooms: rooms.filter((r) => r.floor_id === floor.floor_id).map(toPublicRoom)
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

// -----------------------------------------------------
// สร้างผังห้องครั้งแรก (ขั้น 4-5 ของ wizard)
// -----------------------------------------------------
export function validateFloorPlan(specs) {
  const errors = []

  if (!Array.isArray(specs) || specs.length === 0) {
    errors.push('กรุณาระบุจำนวนชั้นอย่างน้อย 1 ชั้น')
    return errors
  }
  if (specs.length > MAX_FLOORS) errors.push(`จำนวนชั้นต้องไม่เกิน ${MAX_FLOORS} ชั้น`)

  specs.forEach((spec, index) => {
    const count = Number(spec?.roomCount)
    if (!Number.isInteger(count) || count < 1) {
      errors.push(`ชั้นที่ ${index + 1}: กรุณากรอกจำนวนห้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป`)
    } else if (count > MAX_ROOMS_PER_FLOOR) {
      errors.push(`ชั้นที่ ${index + 1}: จำนวนห้องต้องไม่เกิน ${MAX_ROOMS_PER_FLOOR} ห้องต่อชั้น`)
    }
  })

  return errors
}

// สร้างชั้นพร้อมห้องทั้งหมดในธุรกรรมเดียว
// ถ้าพลาดกลางทางต้องไม่เหลือชั้นที่มีห้องครึ่งๆ กลางๆ ให้ผู้ใช้มานั่งไล่ลบเอง
//
// ใช้ได้เฉพาะตอนที่หอยังไม่มีชั้นเลย — การเพิ่มชั้นทีหลังใช้ addFloor
// เพราะถ้าปล่อยให้เรียกซ้ำได้ เลขห้องจะชนกับของเดิมทั้งหมด
export function generateFloorPlan(db, apartmentId, specs) {
  if (db.prepare('SELECT COUNT(*) AS n FROM floors WHERE apartment_id = ?').get(apartmentId).n > 0) {
    throw new Error('หอพักนี้มีผังห้องอยู่แล้ว หากต้องการเพิ่มให้ใช้ปุ่มเพิ่มชั้น/เพิ่มห้อง')
  }

  const defaults = getUtilityDefaults(db, apartmentId)
  const now = new Date().toISOString()

  const run = db.transaction(() => {
    const roomTypeId = ensureRoomType(db, apartmentId)

    specs.forEach((spec, floorIndex) => {
      const floorNumber = floorIndex + 1
      const roomCount = Number(spec.roomCount)

      const floorId = db
        .prepare(
          'INSERT INTO floors (apartment_id, floor_name, room_count, created_at) VALUES (?,?,?,?)'
        )
        .run(apartmentId, spec.floorName?.trim() || `ชั้น ${floorNumber}`, roomCount, now)
        .lastInsertRowid

      for (let i = 0; i < roomCount; i += 1) {
        createRoomRow(db, {
          floorId,
          roomTypeId,
          roomNumber: buildRoomNumber(floorNumber, i),
          defaults,
          now
        })
      }
    })
  })
  run()

  return listFloors(db, apartmentId)
}

// จุดเดียวที่เขียนแถว rooms — บังคับให้ room_utility_settings ถูกสร้างคู่กันเสมอ
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

// -----------------------------------------------------
// ชั้น
// -----------------------------------------------------
export function addFloor(db, apartmentId, { floorName, roomCount }) {
  const count = Number(roomCount)
  if (!Number.isInteger(count) || count < 0 || count > MAX_ROOMS_PER_FLOOR) {
    throw new Error(`จำนวนห้องต้องเป็นตัวเลข 0-${MAX_ROOMS_PER_FLOOR}`)
  }

  const existingFloors = db
    .prepare('SELECT COUNT(*) AS n FROM floors WHERE apartment_id = ?')
    .get(apartmentId).n
  if (existingFloors >= MAX_FLOORS) throw new Error(`จำนวนชั้นต้องไม่เกิน ${MAX_FLOORS} ชั้น`)

  const defaults = getUtilityDefaults(db, apartmentId)
  const now = new Date().toISOString()
  const floorNumber = existingFloors + 1

  const run = db.transaction(() => {
    const roomTypeId = ensureRoomType(db, apartmentId)
    const floorId = db
      .prepare(
        'INSERT INTO floors (apartment_id, floor_name, room_count, created_at) VALUES (?,?,?,?)'
      )
      .run(apartmentId, floorName?.trim() || `ชั้น ${floorNumber}`, count, now).lastInsertRowid

    for (let i = 0; i < count; i += 1) {
      const roomNumber = buildRoomNumber(floorNumber, i)
      // ชั้นที่เพิ่มทีหลังอาจได้เลขที่ชนกับห้องที่ผู้ใช้ตั้งชื่อเองไว้ก่อน — ข้ามไปเงียบๆ
      // ไม่ได้ เพราะผู้ใช้สั่งสร้าง N ห้องแล้วจะได้ไม่ครบ ต้องบอกให้ไปแก้ก่อน
      assertRoomNumberAvailable(db, apartmentId, roomNumber)
      createRoomRow(db, { floorId, roomTypeId, roomNumber, defaults, now })
    }
  })
  run()

  return listFloors(db, apartmentId)
}

export function renameFloor(db, floorId, floorName) {
  const name = String(floorName ?? '').trim()
  if (!name) throw new Error('กรุณากรอกชื่อชั้น')

  const result = db
    .prepare('UPDATE floors SET floor_name = ?, updated_at = ? WHERE floor_id = ?')
    .run(name, new Date().toISOString(), floorId)
  if (result.changes === 0) throw new Error('ไม่พบชั้นที่ต้องการแก้ไข')

  return listFloors(db, apartmentIdOfFloor(db, floorId))
}

// ลบชั้นได้เฉพาะชั้นที่ไม่มีห้องแล้ว — บังคับให้ลบห้องทีละห้องก่อน
// จงใจไม่ทำ "ลบชั้นแล้วห้องหายหมด" เพราะกดพลาดครั้งเดียวข้อมูลทั้งชั้นหายไป
export function deleteFloor(db, floorId) {
  const apartmentId = apartmentIdOfFloor(db, floorId)
  const rooms = db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE floor_id = ?').get(floorId).n
  if (rooms > 0) {
    throw new Error(`ลบไม่ได้ เพราะชั้นนี้ยังมีห้องอยู่ ${rooms} ห้อง กรุณาลบห้องทั้งหมดก่อน`)
  }

  db.prepare('DELETE FROM floors WHERE floor_id = ?').run(floorId)
  return listFloors(db, apartmentId)
}

// -----------------------------------------------------
// ห้อง
// -----------------------------------------------------
export function addRoom(db, floorId, { roomNumber, roomTypeName }) {
  const number = String(roomNumber ?? '').trim()
  if (!number) throw new Error('กรุณากรอกเลขห้อง')

  const apartmentId = apartmentIdOfFloor(db, floorId)
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
  const existing = db.prepare('SELECT floor_id FROM rooms WHERE room_id = ?').get(roomId)
  if (!existing) throw new Error('ไม่พบห้องที่ต้องการแก้ไข')

  const number = String(roomNumber ?? '').trim()
  if (!number) throw new Error('กรุณากรอกเลขห้อง')

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

// ลบห้องไม่ได้ถ้าเคยมีสัญญาเช่า — ประวัติบิลและสัญญาอ้างถึงห้องนี้อยู่
// ห้องที่เลิกใช้แล้วให้ปิดใช้งาน (is_active = 0) แทนการลบ
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
    // ตารางลูกที่ผูกกับห้องต้องถูกล้างก่อน ไม่งั้น FK บล็อก
    db.prepare('DELETE FROM room_utility_settings WHERE room_id = ?').run(roomId)
    db.prepare('DELETE FROM room_services WHERE room_id = ?').run(roomId)
    db.prepare('DELETE FROM rooms WHERE room_id = ?').run(roomId)
  })
  run()

  return listFloors(db, apartmentId)
}

// -----------------------------------------------------
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
