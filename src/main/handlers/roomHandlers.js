// IPC ของผังห้อง (ชั้น + ห้อง) — เปลือกบางๆ ครอบ db/rooms.js
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { throwIfErrors } from '../fieldError.js'
import { requireOwnerUserId, requireSessionUserId } from './authHandlers.js'
import {
  addFloor,
  attachServicesToRooms,
  addRoom,
  deleteFloor,
  deleteRoom,
  detachServicesFromRooms,
  generateFloorPlan,
  listFloors,
  updateFloor,
  setRoomRates,
  setRoomStatus,
  updateRoom,
  validateFloorPlan,
  validateRoomRateInput
} from '../db/rooms.js'

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}) }
    } catch (err) {
      logError(`IPC ${channel} ล้มเหลว`, err)
      return { success: false, error: err.message, fields: err.fields }
    }
  })
}

// ช่องที่ห่อด้วยตัวนี้ต้องเข้าสู่ระบบก่อน — เหตุผลเต็มอยู่เหนือ requireSessionUserId()
// ใน authHandlers.js · ต่างกับ handleOwner() ข้างล่างแค่ระดับ: ตัวนั้นต้องเป็นเจ้าของหอ
// ตัวนี้ขอแค่ล็อกอิน (ผังห้องเป็นข้อมูลที่ทุกหน้าจอต้องอ่าน แต่ไม่ใช่ของสาธารณะ)
function handleSession(channel, fn) {
  handle(channel, (payload) => {
    requireSessionUserId()
    return fn(payload)
  })
}

// 🔴 **ทุกช่องที่แก้ผังห้อง/ราคา/สถานะ เป็นของเจ้าของหอเท่านั้น** (ผู้ใช้ตัดสินใจ 2026-08-14:
// ทั้งเมนู "ตั้งค่า" เป็นของเจ้าของ พนักงานทำงานประจำวันในเมนูหลัก)
//
// ค่าห้องกับค่าบริการคือ "คิดเท่าไหร่" — ลดค่าเช่าห้องเพื่อนจาก 3,000 เป็น 2,800 แล้วบิล
// ก็ออกมาถูกต้องตามที่ตั้งไว้ทุกประการ ไม่มีอะไรผิดปกติให้จับได้เลยนอกจากไปไล่ดูราคาห้อง
//
// เขียนเป็นตัวห่ออีกชั้นแทนการใส่ requireOwnerUserId() ทีละช่อง เพราะสิบเอ็ดช่องที่ต้อง
// จำให้ครบคือสิบเอ็ดโอกาสที่จะลืมช่องใดช่องหนึ่ง แล้วรูที่เหลือไว้ก็เท่ากับไม่ได้ล็อกเลย
function handleOwner(channel, fn) {
  handle(channel, (payload) => {
    requireOwnerUserId()
    return fn(payload)
  })
}

export function registerRoomHandlers() {
  handleSession('room:listFloors', ({ apartmentId }) => listFloors(getDatabase(), apartmentId))

  handleOwner('room:generatePlan', ({ apartmentId, floors }) => {
    const errors = validateFloorPlan(floors)
    if (errors.length > 0) throw new Error(errors.join('\n'))

    const result = generateFloorPlan(getDatabase(), apartmentId, floors)
    const rooms = result.reduce((sum, f) => sum + f.rooms.length, 0)
    logInfo(`สร้างผังห้อง ${result.length} ชั้น ${rooms} ห้อง (apartment_id ${apartmentId})`)
    return result
  })

  handleOwner('room:addFloor', ({ apartmentId, floorName, roomCount, buildingName, numberPrefix }) =>
    addFloor(getDatabase(), apartmentId, { floorName, roomCount, buildingName, numberPrefix })
  )

  // ช่องเดียวคุมชื่อชั้น/ป้ายตึก/เลขนำหน้าห้อง — ฟิลด์ที่ไม่ได้ส่งมาคือฟิลด์ที่ไม่ถูกแตะ
  handleOwner('room:updateFloor', ({ floorId, floorName, buildingName, numberPrefix }) =>
    updateFloor(getDatabase(), floorId, { floorName, buildingName, numberPrefix })
  )

  handleOwner('room:deleteFloor', ({ floorId }) => {
    const result = deleteFloor(getDatabase(), floorId)
    logInfo(`ลบชั้น (floor_id ${floorId})`)
    return result
  })

  handleOwner('room:addRoom', ({ floorId, roomNumber, roomTypeName }) =>
    addRoom(getDatabase(), floorId, { roomNumber, roomTypeName })
  )

  handleOwner('room:updateRoom', ({ roomId, roomNumber, roomTypeName, isActive }) =>
    updateRoom(getDatabase(), roomId, { roomNumber, roomTypeName, isActive })
  )

  handleOwner('room:deleteRoom', ({ roomId }) => {
    const result = deleteRoom(getDatabase(), roomId)
    logInfo(`ลบห้อง (room_id ${roomId})`)
    return result
  })

  handleOwner('room:setRates', ({ roomIds, monthlyRent, dailyRent }) => {
    throwIfErrors(validateRoomRateInput({ monthlyRent, dailyRent }))

    const result = setRoomRates(getDatabase(), roomIds, { monthlyRent, dailyRent })
    logInfo(`ตั้งค่าห้อง ${roomIds.length} ห้อง`)
    return result
  })

  handleOwner('room:attachServices', ({ roomIds, serviceIds }) => {
    const result = attachServicesToRooms(getDatabase(), roomIds, serviceIds)
    logInfo(`ผูกค่าบริการ ${serviceIds.length} รายการเข้ากับ ${roomIds.length} ห้อง`)
    return result
  })

  handleOwner('room:detachServices', ({ roomIds, serviceIds }) => {
    const result = detachServicesFromRooms(getDatabase(), roomIds, serviceIds)
    logInfo(`นำค่าบริการ ${serviceIds.length} รายการออกจาก ${roomIds.length} ห้อง`)
    return result
  })

  handleOwner('room:setStatus', ({ roomIds, status }) => {
    const result = setRoomStatus(getDatabase(), roomIds, status)
    logInfo(`ตั้งสถานะห้อง ${roomIds.length} ห้อง เป็น ${status}`)
    return result
  })
}
