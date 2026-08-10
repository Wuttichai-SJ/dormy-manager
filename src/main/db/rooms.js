// ตาราง floors + rooms + room_utility_settings — ผังห้องของหอพัก
//
// สามตารางนี้อยู่ไฟล์เดียวกันเพราะเป็นเรื่องเดียวกันในสายตาผู้ใช้ ("ผังห้อง") และ
// แทบทุกคำสั่งต้องแตะพร้อมกัน — สร้างห้องหนึ่งห้องคือเขียน rooms + room_utility_settings
// เสมอ ถ้าแยกไฟล์จะมีโอกาสที่ใครสักคนเขียน rooms อย่างเดียวแล้วลืมอีกตาราง
//
// หมายเหตุ: ไฟล์ใน db/ ห้าม import logger.js หรืออะไรที่ดึง electron เข้ามา
// (เหตุผลอยู่ใน db/bankAccounts.js) — การ log เป็นหน้าที่ของชั้น handlers
import { getUtilityDefaults } from './utilityDefaults.js'
import { toCents } from '../money.js'

// ต้นแบบจำกัดไว้ที่ 50 ห้อง/ชั้น และ 30 ชั้น — ใช้ตัวเลขเดียวกัน
// ไม่ใช่เพราะระบบทำมากกว่านี้ไม่ได้ แต่เกินจากนี้แปลว่าผู้ใช้พิมพ์ผิด
// (ไม่มีหอพักไหนมี 500 ห้องในชั้นเดียว) ปล่อยผ่านแล้วจะได้ห้องขยะ 500 ห้องให้ตามลบ
export const MAX_FLOORS = 30
export const MAX_ROOMS_PER_FLOOR = 50

// ชื่อประเภทห้องที่สร้างให้อัตโนมัติตอนยังไม่มีอะไรเลย
// ตาราง rooms บังคับ room_type_id NOT NULL แต่ตอนสร้างผังห้องครั้งแรกผู้ใช้ยังไม่ได้
// คิดเรื่องประเภทห้อง — สร้างประเภทกลางๆ ให้ก่อน แล้วค่อยแก้ทีหลังได้
export const DEFAULT_ROOM_TYPE = 'ทั่วไป'

// สถานะห้อง — ต้องตรงกับที่ 001_init.sql ระบุไว้
// ต้นแบบมีให้เลือกแค่ ว่าง/ไม่ว่าง ตอนตั้งค่าครั้งแรก แต่ schema เรารองรับ maintenance
// ด้วย ซึ่งจำเป็นเวลาห้องน้ำท่วม/ซ่อมอยู่ — ห้องแบบนั้นไม่ใช่ทั้ง "ว่างให้เช่า" และ
// ไม่ใช่ "มีคนอยู่" ถ้าไม่มีสถานะนี้เจ้าของจะต้องปล่อยเป็นว่างแล้วเสี่ยงปล่อยเช่าซ้ำ
export const ROOM_STATUSES = ['vacant', 'occupied', 'maintenance']

export const ROOM_STATUS_LABELS = {
  vacant: 'ว่าง',
  occupied: 'ไม่ว่าง',
  maintenance: 'ปิดปรับปรุง'
}

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
// เลขห้องถัดไปของชั้นหนึ่ง — นับจาก "จำนวนห้องที่มีอยู่" แล้วเดินหน้าจนกว่าจะเจอเลขที่ว่าง
// ไล่หาเลขว่างแทนการ +1 เฉยๆ เพราะห้องกลางชั้นอาจถูกลบไปแล้ว หรือเจ้าของหอพิมพ์เลขเอง
// จนชนกับเลขที่ระบบจะตั้งให้ ถ้าไม่ไล่หาจะโยน "มีห้องนี้อยู่แล้ว" ใส่หน้าคนกดปุ่มเฉยๆ
function nextRoomNumber(db, apartmentId, floorId) {
  const floorNumber = db
    .prepare(
      `SELECT COUNT(*) AS n FROM floors
        WHERE apartment_id = ? AND floor_id <= ?`
    )
    .get(apartmentId, floorId).n

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
    const candidate = buildRoomNumber(floorNumber, i)
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

  // ดึงค่าบริการที่ผูกกับห้องมาในคำสั่งเดียว แล้วค่อยจับกลุ่มใน JS
  // ดีกว่ายิง query แยกทีละห้อง ซึ่งหอ 40 ห้องจะกลายเป็น 40 คำสั่ง
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

  return floors.map((floor) => ({
    floorId: floor.floor_id,
    apartmentId: floor.apartment_id,
    floorName: floor.floor_name,
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
// เว้น roomNumber ไว้ได้ = ให้ระบบตั้งเลขต่อจากห้องสุดท้ายของชั้นนั้นให้เอง
// (ปุ่ม "เพิ่มห้อง" ในผังห้องเรียกแบบไม่ส่งเลขมา แล้วให้เจ้าของหอพิมพ์ทับทีหลังถ้าอยากได้
// เลขอื่น — ต้นแบบก็เพิ่มแถวว่างที่มีเลขให้แล้วทันทีโดยไม่ถามก่อน)
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

  // **ห้องที่มีคนอยู่ ปิดใช้งานไม่ได้** (เจอจริง 2026-08-10 กับหอพักประตู 5 ห้อง 102)
  //
  // "ปิดใช้งาน" แปลว่าห้องนี้เลิกใช้แล้ว ไม่ให้เช่าอีก — แต่ถ้ายังมีสัญญาที่ยังไม่จบอยู่
  // สถานะสองอย่างนี้ขัดกันเอง แล้วห้องจะกลายเป็นห้องที่ "มีผู้เช่า" ในหน้าห้อง แต่
  // หายไปจากใบจดมิเตอร์ (ซึ่งกรอง is_active = 1) โดยไม่มีอะไรบอกว่าหายไปไหน
  // ผู้เช่าจึงอยู่ไปเรื่อยๆ โดยไม่ถูกจดมิเตอร์และไม่มีใครสังเกต
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
// ตั้งค่าหลายห้องพร้อมกัน (ขั้น 6-7 ของ wizard)
// -----------------------------------------------------
// หอ 40 ห้องส่วนใหญ่ราคาเท่ากันหมด ถ้าให้กรอกทีละห้องคือพิมพ์เลขเดิม 40 รอบ
// ต้นแบบจึงทำเป็น "ติ๊กเลือกห้อง แล้วตั้งค่าทีเดียว" — ลอกมาเพราะเหตุผลถูก
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
  // กันไม่ให้คำสั่งเดียวข้ามหอ — ถ้าเกิดขึ้นแปลว่าฝั่งหน้าจอส่งข้อมูลผิด
  if (apartmentIds.length > 1) throw new Error('ไม่สามารถตั้งค่าห้องข้ามหอพักในครั้งเดียวได้')

  return apartmentIds[0]
}

export function validateRoomRateInput({ monthlyRent, dailyRent }) {
  const errors = []

  try {
    toCents(monthlyRent, 'ค่าเช่ารายเดือน')
  } catch (err) {
    errors.push(err.message)
  }

  // ค่าเช่ารายวันไม่บังคับ — หอที่ไม่รับรายวันเว้นว่างไว้ได้ (ต้นแบบก็เขียนแบบนี้)
  if (String(dailyRent ?? '').trim() !== '') {
    try {
      toCents(dailyRent, 'ค่าเช่ารายวัน')
    } catch (err) {
      errors.push(err.message)
    }
  }

  return errors
}

export function setRoomRates(db, roomIds, { monthlyRent, dailyRent }) {
  const apartmentId = assertRoomsBelongToSameApartment(db, roomIds)

  const monthly = toCents(monthlyRent, 'ค่าเช่ารายเดือน')
  // เว้นว่าง = ไม่รับรายวัน เก็บเป็น NULL ไม่ใช่ 0
  // เพราะ 0 แปลว่า "รับรายวันแต่ฟรี" ซึ่งคนละความหมายกัน
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

  // ห้องที่มีสัญญาเช่าอยู่จะถูกตั้งเป็น "ว่าง" ด้วยมือไม่ได้
  // ถ้าปล่อยให้ทำได้ ห้องนั้นจะโผล่ในรายการห้องว่างทั้งที่มีคนอยู่ แล้วอาจถูกปล่อยเช่าซ้ำ
  // การทำให้ห้องว่างต้องเกิดจากการย้ายออกเท่านั้น
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

// -----------------------------------------------------
// ค่าบริการรายห้อง (ขั้น 8 ของ wizard)
// -----------------------------------------------------
// ผูกค่าบริการจากแคตตาล็อกของหอ (apartment_services) เข้ากับห้องที่เลือก
// ราคาไม่ได้ถูกคัดลอกมาที่นี่ — ตาราง room_services เก็บแค่ "ห้องนี้มีบริการนี้"
// ราคาจริงถูกคัดลอกอีกทีตอนทำสัญญา (contract_services) เพื่อให้การขึ้นราคาภายหลัง
// ไม่ย้อนไปเปลี่ยนสัญญาที่เซ็นไปแล้ว
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

  // OR IGNORE เพราะ (apartment_service_id, room_id) เป็น UNIQUE อยู่แล้ว
  // ห้องที่มีบริการนั้นอยู่แล้วให้ข้ามไปเงียบๆ ไม่ใช่ทำให้ทั้งคำสั่งล้มเหลว
  // ผู้ใช้เลือกทั้งชั้นแล้วบางห้องมีอยู่แล้วเป็นเรื่องปกติ ไม่ใช่ข้อผิดพลาด
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

// การนำออกจากห้องไม่กระทบสัญญาที่ทำไปแล้ว เพราะ contract_services เก็บสำเนาของตัวเอง
// ผู้เช่าที่ยังอยู่จึงถูกเก็บค่าบริการต่อไปตามสัญญาจนกว่าจะหมดสัญญา — ตั้งใจให้เป็นแบบนี้
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
