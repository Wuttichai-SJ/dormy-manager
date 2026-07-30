// IPC ของผังห้อง (ชั้น + ห้อง) — เปลือกบางๆ ครอบ db/rooms.js
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import {
  addFloor,
  addRoom,
  deleteFloor,
  deleteRoom,
  generateFloorPlan,
  listFloors,
  renameFloor,
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
      return { success: false, error: err.message }
    }
  })
}

export function registerRoomHandlers() {
  handle('room:listFloors', ({ apartmentId }) => listFloors(getDatabase(), apartmentId))

  handle('room:generatePlan', ({ apartmentId, floors }) => {
    const errors = validateFloorPlan(floors)
    if (errors.length > 0) throw new Error(errors.join('\n'))

    const result = generateFloorPlan(getDatabase(), apartmentId, floors)
    const rooms = result.reduce((sum, f) => sum + f.rooms.length, 0)
    logInfo(`สร้างผังห้อง ${result.length} ชั้น ${rooms} ห้อง (apartment_id ${apartmentId})`)
    return result
  })

  handle('room:addFloor', ({ apartmentId, floorName, roomCount }) =>
    addFloor(getDatabase(), apartmentId, { floorName, roomCount })
  )

  handle('room:renameFloor', ({ floorId, floorName }) =>
    renameFloor(getDatabase(), floorId, floorName)
  )

  handle('room:deleteFloor', ({ floorId }) => {
    const result = deleteFloor(getDatabase(), floorId)
    logInfo(`ลบชั้น (floor_id ${floorId})`)
    return result
  })

  handle('room:addRoom', ({ floorId, roomNumber, roomTypeName }) =>
    addRoom(getDatabase(), floorId, { roomNumber, roomTypeName })
  )

  handle('room:updateRoom', ({ roomId, roomNumber, roomTypeName, isActive }) =>
    updateRoom(getDatabase(), roomId, { roomNumber, roomTypeName, isActive })
  )

  handle('room:deleteRoom', ({ roomId }) => {
    const result = deleteRoom(getDatabase(), roomId)
    logInfo(`ลบห้อง (room_id ${roomId})`)
    return result
  })

  handle('room:setRates', ({ roomIds, monthlyRent, dailyRent }) => {
    const errors = validateRoomRateInput({ monthlyRent, dailyRent })
    if (errors.length > 0) throw new Error(errors.join('\n'))

    const result = setRoomRates(getDatabase(), roomIds, { monthlyRent, dailyRent })
    logInfo(`ตั้งค่าห้อง ${roomIds.length} ห้อง`)
    return result
  })

  handle('room:setStatus', ({ roomIds, status }) => {
    const result = setRoomStatus(getDatabase(), roomIds, status)
    logInfo(`ตั้งสถานะห้อง ${roomIds.length} ห้อง เป็น ${status}`)
    return result
  })
}
