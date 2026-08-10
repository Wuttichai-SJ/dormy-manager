// IPC ของโมดูลการจอง — เปลือกบางๆ ครอบ db/bookings.js
// กฎเดียวกับ handler อื่น: คืน { success, data | error } เท่านั้น ห้าม throw ข้ามสะพาน
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import {
  convertBookingToContract,
  countOpenBookings,
  createBooking,
  deleteBooking,
  listBookingsByRoom,
  setBookingStatus,
  validateBookingInput
} from '../db/bookings.js'
import { validateContractInput } from '../db/contracts.js'
import { requireSessionUserId } from './authHandlers.js'

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}) }
    } catch (err) {
      logError(`${channel} ล้มเหลว`, err)
      return { success: false, error: err.message }
    }
  })
}

export function registerBookingHandlers() {
  handle('booking:listByRoom', ({ roomId }) => listBookingsByRoom(getDatabase(), roomId))

  handle('booking:countOpen', ({ apartmentId }) => countOpenBookings(getDatabase(), apartmentId))

  handle('booking:create', (payload) => {
    const errors = validateBookingInput(payload)
    if (errors.length > 0) throw new Error(errors.join('\n'))

    const booking = createBooking(getDatabase(), payload)
    logInfo(`รับจองห้อง ${payload.roomId} โดย ${booking.customerName} (booking_id ${booking.bookingId})`)
    return booking
  })

  handle('booking:setStatus', ({ bookingId, status }) => {
    const booking = setBookingStatus(getDatabase(), bookingId, status)
    logInfo(`เปลี่ยนสถานะการจอง ${bookingId} เป็น ${status}`)
    return booking
  })

  // ตรวจข้อมูลสัญญาก่อนเสมอ — ถ้าปล่อยผ่านแล้วไปพังกลางธุรกรรม การจองจะยังไม่ถูกแปลง
  // แต่ผู้ใช้เห็นข้อความ error ดิบๆ ของ SQLite แทนที่จะรู้ว่ากรอกอะไรขาด
  handle('booking:convert', ({ bookingId, ...contractInput }) => {
    const errors = validateContractInput(contractInput)
    if (errors.length > 0) throw new Error(errors.join('\n'))

    // ผู้รับเงินของใบเสร็จเงินจองมาจากเซสชันเสมอ ห้ามให้หน้าจอส่งมาเอง
    const contract = convertBookingToContract(getDatabase(), bookingId, {
      ...contractInput,
      createdBy: requireSessionUserId()
    })
    logInfo(`แปลงการจอง ${bookingId} เป็นสัญญา (contract_id ${contract.contractId})`)
    return contract
  })

  handle('booking:delete', ({ bookingId }) => {
    const result = deleteBooking(getDatabase(), bookingId)
    logInfo(`ลบการจอง ${bookingId}`)
    return result
  })
}
