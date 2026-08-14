// ทดสอบงานแจ้งซ่อม — รันด้วย: npm run test:maintenance
import {
  assert,
  check,
  ensureElectronRuntime,
  group,
  openTempDatabase,
  summarize,
  throws
} from './lib/harness.mjs'

ensureElectronRuntime(import.meta.url)

const apartments = await import('../src/main/db/apartments.js')
const utility = await import('../src/main/db/utilityDefaults.js')
const rooms = await import('../src/main/db/rooms.js')
const tenants = await import('../src/main/db/tenants.js')
const users = await import('../src/main/db/users.js')
const contracts = await import('../src/main/db/contracts.js')
const maintenance = await import('../src/main/db/maintenance.js')

const { db, cleanup } = await openTempDatabase('dormy-maintenance')

const staff = users.insertUser(db, {
  fullName: 'ผู้จัดการหอ',
  phone: '0801112222',
  passwordHash: 'x',
  recoveryCodeHash: 'y'
})

const apartment = apartments.insertApartment(db, {
  nameTh: 'หอทดสอบแจ้งซ่อม',
  addressTh: 'ที่อยู่',
  dueDateDay: 10,
  lateFeePerDay: '0'
})
const apartmentId = apartment.apartmentId
utility.saveUtilityDefaults(db, apartmentId, {
  water: { enabled: false },
  electric: { enabled: false }
})

function makeRoom(targetApartmentId = apartmentId) {
  const floors = rooms.addFloor(db, targetApartmentId, { roomCount: 1 })
  const room = floors[floors.length - 1].rooms[0]
  rooms.setRoomRates(db, [room.roomId], { monthlyRent: '4000' })
  return room
}

const PNG = { mimeType: 'image/png', bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) }

// -----------------------------------------------------
group('รับแจ้งซ่อม')

check('ไม่ระบุวันนัด = รอดำเนินการ · ระบุวันนัด = นัดช่างแล้ว', () => {
  const room = makeRoom()
  const waiting = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'ก๊อกน้ำรั่ว'
  })
  assert(waiting.status === 'pending', `ได้ ${waiting.status}`)
  // 🔴 NULL = ยังไม่ได้นัด ไม่ใช่วันที่มั่วๆ ที่คนคีย์ใส่ไปก่อน (เหตุผลของ migration 028)
  assert(waiting.appointmentDate === null, `ได้ ${waiting.appointmentDate}`)
  assert(waiting.isOpen === true, 'งานที่เพิ่งแจ้งต้องนับเป็นงานค้าง')

  const booked = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'แอร์ไม่เย็น',
    appointmentDate: '2026-08-05'
  })
  assert(booked.status === 'scheduled', `ได้ ${booked.status}`)
})

check('ห้องว่างก็แจ้งซ่อมได้ และชื่อผู้เช่าเป็น null', () => {
  const room = makeRoom()
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-02',
    description: 'ทาสีใหม่ก่อนปล่อยห้อง'
  })
  assert(request.tenantName === null, `ได้ ${request.tenantName}`)
})

check('ห้องที่มีผู้เช่าอยู่ ติดชื่อผู้เช่ามาให้ติดต่อ', () => {
  const room = makeRoom()
  const person = tenants.insertTenant(db, {
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    phone: '0812223333'
  })
  contracts.createContract(db, {
    roomId: room.roomId,
    rentType: 'monthly',
    startDate: '2026-01-01',
    rentAmount: '4000',
    deposit: '4000',
    depositPaymentMethod: 'cash',
    bookingFee: '0',
    termMonths: 12,
    waterMeterStart: 0,
    electricMeterStart: 0,
    tenants: [person.tenantId],
    createdBy: staff.user_id
  })

  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-03',
    description: 'ไฟหน้าห้องขาด'
  })
  assert(request.tenantName === 'สมชาย ใจดี', `ได้ ${request.tenantName}`)
})

check('อาการว่าง / ห้องไม่มีจริง / วันนัดก่อนวันแจ้ง ต้องไม่ผ่าน', () => {
  const room = makeRoom()
  throws(
    () =>
      maintenance.createMaintenanceRequest(db, {
        roomId: room.roomId,
        reportedDate: '2026-08-01',
        description: '   '
      }),
    'อาการ',
    'อาการว่างผ่านได้'
  )
  throws(
    () =>
      maintenance.createMaintenanceRequest(db, {
        roomId: 999999,
        reportedDate: '2026-08-01',
        description: 'x'
      }),
    'ไม่พบห้อง',
    'ห้องมั่วผ่านได้'
  )
  throws(
    () =>
      maintenance.createMaintenanceRequest(db, {
        roomId: room.roomId,
        reportedDate: '2026-08-10',
        description: 'x',
        appointmentDate: '2026-08-09'
      }),
    'ไม่ก่อนวันที่แจ้ง',
    'นัดย้อนหลังผ่านได้'
  )
})

// -----------------------------------------------------
group('นัดช่าง / แก้ข้อมูล')

check('ใส่วันนัดทีหลังแล้วสถานะเดินตาม และลบวันนัดออกได้', () => {
  const room = makeRoom()
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'ประตูปิดไม่สนิท'
  })
  assert(request.status === 'pending', 'ตั้งต้นต้องเป็นรอดำเนินการ')

  const booked = maintenance.updateMaintenanceRequest(db, request.maintenanceId, {
    appointmentDate: '2026-08-06'
  })
  assert(booked.status === 'scheduled', `ได้ ${booked.status}`)
  assert(booked.description === 'ประตูปิดไม่สนิท', 'อาการเดิมต้องไม่หาย')

  // ส่ง null = ยกเลิกการนัด ไม่ใช่ "ไม่ได้ส่งมา" (undefined) ซึ่งแปลว่าไม่แตะ
  const unbooked = maintenance.updateMaintenanceRequest(db, request.maintenanceId, {
    appointmentDate: null
  })
  assert(unbooked.status === 'pending', `ได้ ${unbooked.status}`)
  assert(unbooked.appointmentDate === null, 'วันนัดต้องถูกล้าง')
})

// -----------------------------------------------------
group('ปิดงาน')

check('ปิดงานแล้วบันทึกวันที่ซ่อมเสร็จและค่าซ่อม', () => {
  const room = makeRoom()
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'สายชำระรั่ว'
  })

  const done = maintenance.completeMaintenance(db, request.maintenanceId, {
    repairedDate: '2026-08-04',
    repairCost: '350',
    repairDetails: 'เปลี่ยนสายชำระใหม่'
  })
  assert(done.status === 'done', `ได้ ${done.status}`)
  assert(done.isOpen === false, 'งานที่ปิดแล้วต้องไม่นับเป็นงานค้าง')
  assert(done.repairedDate === '2026-08-04', `ได้ ${done.repairedDate}`)
  assert(done.repairCostCents === 35000, `ได้ ${done.repairCostCents}`)
})

// 🔴 บทเรียนเดียวกับเลขมิเตอร์: ช่องที่เว้นว่างต้องไม่กลายเป็น 0 เงียบๆ
// ไม่งั้นยอดค่าซ่อมรวมของหอจะดูน้อยกว่าความจริงตลอดไป และแยกไม่ออกว่างานไหนซ่อมฟรีจริง
check('ค่าซ่อมเว้นว่าง = ยังไม่รู้ (null) · กรอก 0 = ซ่อมแล้วไม่เสียเงิน', () => {
  const room = makeRoom()
  const blank = maintenance.completeMaintenance(
    db,
    maintenance.createMaintenanceRequest(db, {
      roomId: room.roomId,
      reportedDate: '2026-08-01',
      description: 'a'
    }).maintenanceId,
    { repairedDate: '2026-08-02' }
  )
  assert(blank.repairCostCents === null, `เว้นว่างได้ ${blank.repairCostCents}`)

  const free = maintenance.completeMaintenance(
    db,
    maintenance.createMaintenanceRequest(db, {
      roomId: room.roomId,
      reportedDate: '2026-08-01',
      description: 'b'
    }).maintenanceId,
    { repairedDate: '2026-08-02', repairCost: '0' }
  )
  assert(free.repairCostCents === 0, `กรอกศูนย์ได้ ${free.repairCostCents}`)
})

check('ซ่อมเสร็จก่อนวันที่แจ้งไม่ได้', () => {
  const room = makeRoom()
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-10',
    description: 'x'
  })
  throws(
    () =>
      maintenance.completeMaintenance(db, request.maintenanceId, { repairedDate: '2026-08-09' }),
    'ไม่ก่อนวันที่แจ้ง',
    'ปิดงานย้อนหลังเกินวันแจ้งได้'
  )
})

check('งานที่ปิดแล้วแก้ไขไม่ได้ และยกเลิกไม่ได้', () => {
  const room = makeRoom()
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'x'
  })
  maintenance.completeMaintenance(db, request.maintenanceId, { repairedDate: '2026-08-02' })

  throws(
    () => maintenance.updateMaintenanceRequest(db, request.maintenanceId, { description: 'y' }),
    'ปิดไปแล้ว',
    'แก้งานที่ปิดแล้วได้'
  )
  throws(
    () => maintenance.cancelMaintenance(db, request.maintenanceId, {}),
    'ปิดไปแล้ว',
    'ยกเลิกงานที่ปิดแล้วได้'
  )
})

// -----------------------------------------------------
group('ยกเลิก / เปิดใหม่')

check('ยกเลิกแล้วไม่นับเป็นงานค้าง และปิดงานต่อไม่ได้', () => {
  const room = makeRoom()
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'ผู้เช่าแจ้งซ้ำ'
  })
  const cancelled = maintenance.cancelMaintenance(db, request.maintenanceId, {
    reason: 'แจ้งซ้ำกับใบก่อนหน้า'
  })
  assert(cancelled.status === 'cancelled', `ได้ ${cancelled.status}`)
  assert(cancelled.isOpen === false, 'งานที่ยกเลิกต้องไม่นับเป็นงานค้าง')
  assert(
    String(cancelled.repairDetails).includes('แจ้งซ้ำ'),
    `เหตุผลต้องถูกเก็บไว้ (ได้ ${cancelled.repairDetails})`
  )
  throws(
    () => maintenance.completeMaintenance(db, request.maintenanceId, {}),
    'ยกเลิกไปแล้ว',
    'ปิดงานที่ยกเลิกแล้วได้'
  )
})

check('เปิดงานที่ปิดไปแล้วใหม่ ต้องล้างผลการซ่อมทิ้ง', () => {
  const room = makeRoom()
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'แอร์ไม่เย็น'
  })
  maintenance.completeMaintenance(db, request.maintenanceId, {
    repairedDate: '2026-08-03',
    repairCost: '800',
    repairDetails: 'ล้างแอร์'
  })

  const reopened = maintenance.reopenMaintenance(db, request.maintenanceId)
  assert(reopened.status === 'pending', `ได้ ${reopened.status}`)
  // ถ้าไม่ล้าง งานที่เปิดใหม่จะพกวันที่ซ่อมเสร็จกับค่าซ่อมของรอบก่อนติดมา
  // แล้วยอดค่าซ่อมรวมจะนับซ้ำเมื่อปิดงานอีกครั้ง
  assert(reopened.repairedDate === null, `ได้ ${reopened.repairedDate}`)
  assert(reopened.repairCostCents === null, `ได้ ${reopened.repairCostCents}`)

  throws(
    () => maintenance.reopenMaintenance(db, request.maintenanceId),
    'ยังไม่ได้ปิด',
    'เปิดงานที่เปิดอยู่แล้วซ้ำได้'
  )
})

// -----------------------------------------------------
group('รูปประกอบ')

check('แนบรูปได้ ลบได้ และเกินเพดานไม่ได้', () => {
  const room = makeRoom()
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'รอยรั่วบนฝ้า'
  })

  const first = maintenance.addMaintenanceImage(db, request.maintenanceId, PNG)
  assert(first.request.imageIds.length === 1, `ได้ ${first.request.imageIds.length} รูป`)

  for (let i = 1; i < maintenance.MAX_IMAGES_PER_REQUEST; i += 1) {
    maintenance.addMaintenanceImage(db, request.maintenanceId, PNG)
  }
  throws(
    () => maintenance.addMaintenanceImage(db, request.maintenanceId, PNG),
    'สูงสุด',
    'แนบเกินเพดานได้'
  )

  const after = maintenance.removeMaintenanceImage(db, request.maintenanceId, first.imageId)
  assert(
    after.imageIds.length === maintenance.MAX_IMAGES_PER_REQUEST - 1,
    `ลบแล้วเหลือ ${after.imageIds.length}`
  )
  // รูปที่หลุดจากงานแล้วต้องไม่ค้างอยู่ในตาราง images ไม่งั้นไฟล์ฐานข้อมูลจะพกรูป
  // ที่ไม่มีใครใช้ติดไปกับไฟล์สำรองทุกครั้ง
  const orphan = db.prepare('SELECT COUNT(*) AS n FROM images WHERE image_id = ?').get(first.imageId).n
  assert(orphan === 0, 'รูปกำพร้าไม่ถูกเก็บกวาด')
})

check('ลบงานทิ้งแล้วรูปของงานนั้นถูกเก็บกวาดตามไปด้วย', () => {
  const room = makeRoom()
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'คีย์ผิดห้อง'
  })
  const image = maintenance.addMaintenanceImage(db, request.maintenanceId, PNG)

  maintenance.deleteMaintenanceRequest(db, request.maintenanceId)
  assert(
    maintenance.getMaintenanceRequest(db, request.maintenanceId) === null,
    'งานยังอยู่หลังลบ'
  )
  const left = db.prepare('SELECT COUNT(*) AS n FROM images WHERE image_id = ?').get(image.imageId).n
  assert(left === 0, 'รูปของงานที่ถูกลบยังค้างอยู่')
})

// 🔴 บทเรียนจาก deleteApartment ที่เคยลืม apartment_utility_defaults:
// ตารางใหม่ที่ผูกกับห้อง ต้องถูกล้างใน deleteRoom ด้วย ไม่งั้น FK บล็อกแล้วโยนข้อความดิบ
// ของ SQLite ออกไปที่หน้าจอ ซึ่งเจ้าของหออ่านไม่รู้เรื่องและดูเหมือนปุ่มลบเสีย
check('ลบห้องที่มีงานแจ้งซ่อมอยู่ได้ ไม่ติด FOREIGN KEY', () => {
  const room = makeRoom()
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'ห้องนี้กำลังจะถูกลบ'
  })
  maintenance.addMaintenanceImage(db, request.maintenanceId, PNG)

  rooms.deleteRoom(db, room.roomId)

  const left = db
    .prepare('SELECT COUNT(*) AS n FROM maintenance_requests WHERE room_id = ?')
    .get(room.roomId).n
  assert(left === 0, 'งานซ่อมของห้องที่ถูกลบยังค้างอยู่')
})

// -----------------------------------------------------
group('รายการและตัวกรอง')

check('ตัวกรอง open ได้เฉพาะงานที่ยังต้องตามต่อ', () => {
  const report = maintenance.listMaintenanceRequests(db, apartmentId, { status: 'open' })
  assert(report.requests.length > 0, 'ต้องมีงานค้างอยู่บ้าง')
  assert(
    report.requests.every((r) => r.status === 'pending' || r.status === 'scheduled'),
    'มีงานที่ปิด/ยกเลิกหลุดเข้ามา'
  )
})

// การ์ดสรุปต้องนับจากทั้งหอ ไม่ใช่จากผลที่กรองอยู่ — ไม่งั้นกรอง "ซ่อมเสร็จแล้ว"
// แล้วตัวเลข "งานค้าง" จะกลายเป็น 0 ทั้งที่ยังค้างอยู่จริง
check('การ์ดสรุปนับจากทั้งหอ ไม่ใช่จากผลที่กรอง', () => {
  const all = maintenance.listMaintenanceRequests(db, apartmentId)
  const filtered = maintenance.listMaintenanceRequests(db, apartmentId, { status: 'done' })

  assert(filtered.openCount === all.openCount, 'ยอดงานค้างเปลี่ยนตามตัวกรอง')
  assert(filtered.countByStatus.pending === all.countByStatus.pending, 'ยอดรอดำเนินการเปลี่ยนตาม')
  assert(
    filtered.requests.every((r) => r.status === 'done'),
    'ตัวกรองสถานะไม่ทำงาน'
  )
  assert(filtered.count === filtered.requests.length, 'count ไม่ตรงกับจำนวนแถว')
})

check('ค้นด้วยเลขห้องและอาการได้', () => {
  const room = makeRoom()
  maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'ปั๊มน้ำเสียงดังผิดปกติ'
  })

  const byText = maintenance.listMaintenanceRequests(db, apartmentId, { search: 'ปั๊มน้ำ' })
  assert(byText.requests.length === 1, `ค้นอาการได้ ${byText.requests.length} รายการ`)

  const byRoom = maintenance.listMaintenanceRequests(db, apartmentId, {
    search: byText.requests[0].roomNumber
  })
  assert(
    byRoom.requests.some((r) => r.roomNumber === byText.requests[0].roomNumber),
    'ค้นด้วยเลขห้องไม่เจอ'
  )
})

check('สถานะที่ไม่รู้จัก / ไม่ระบุหอ ต้องไม่ผ่าน', () => {
  throws(
    () => maintenance.listMaintenanceRequests(db, apartmentId, { status: 'ซ่อมอยู่' }),
    'สถานะไม่ถูกต้อง',
    'สถานะมั่วผ่านได้'
  )
  throws(
    () => maintenance.listMaintenanceRequests(db, null),
    'ไม่พบหอพัก',
    'ไม่ระบุหอผ่านได้'
  )
})

check('งานของหออื่นไม่ปนเข้ามา', () => {
  const other = apartments.insertApartment(db, {
    nameTh: 'หอที่สอง',
    addressTh: 'ที่อยู่',
    dueDateDay: 10,
    lateFeePerDay: '0'
  })
  const room = makeRoom(other.apartmentId)
  const request = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'งานของหอที่สอง'
  })

  const mine = maintenance.listMaintenanceRequests(db, apartmentId)
  assert(
    !mine.requests.some((r) => r.maintenanceId === request.maintenanceId),
    'งานของหออื่นโผล่ในรายการของหอนี้'
  )

  const theirs = maintenance.listMaintenanceRequests(db, other.apartmentId)
  assert(theirs.count === 1, `หอที่สองต้องมี 1 งาน (ได้ ${theirs.count})`)
})

check('ค่าซ่อมรวมนับเฉพาะงานที่ปิดแล้ว และไม่นับช่องที่เว้นว่าง', () => {
  const fresh = apartments.insertApartment(db, {
    nameTh: 'หอนับค่าซ่อม',
    addressTh: 'ที่อยู่',
    dueDateDay: 10,
    lateFeePerDay: '0'
  })
  const room = makeRoom(fresh.apartmentId)

  const open = maintenance.createMaintenanceRequest(db, {
    roomId: room.roomId,
    reportedDate: '2026-08-01',
    description: 'ยังไม่ปิด'
  })
  maintenance.completeMaintenance(
    db,
    maintenance.createMaintenanceRequest(db, {
      roomId: room.roomId,
      reportedDate: '2026-08-01',
      description: 'ปิดแล้ว มีค่าซ่อม'
    }).maintenanceId,
    { repairedDate: '2026-08-02', repairCost: '1200' }
  )
  maintenance.completeMaintenance(
    db,
    maintenance.createMaintenanceRequest(db, {
      roomId: room.roomId,
      reportedDate: '2026-08-01',
      description: 'ปิดแล้ว ไม่รู้ค่าซ่อม'
    }).maintenanceId,
    { repairedDate: '2026-08-02' }
  )

  const report = maintenance.listMaintenanceRequests(db, fresh.apartmentId)
  assert(report.repairCostTotalCents === 120000, `ได้ ${report.repairCostTotalCents}`)
  assert(report.openCount === 1, `งานค้างได้ ${report.openCount}`)
  assert(open.isOpen === true, 'งานที่ยังไม่ปิดต้องนับเป็นค้าง')
})

// -----------------------------------------------------
cleanup()
summarize('งานแจ้งซ่อมทำงานครบทุกเส้นทาง')
