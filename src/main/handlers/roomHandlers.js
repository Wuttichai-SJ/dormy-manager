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

function handleSession(channel, fn) {
  handle(channel, (payload) => {
    requireSessionUserId()
    return fn(payload)
  })
}

// แก้ผังห้อง/ราคา/สถานะ เฉพาะเจ้าของหอ
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
