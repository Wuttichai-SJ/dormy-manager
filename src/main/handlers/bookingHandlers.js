import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { throwIfErrors } from '../fieldError.js'
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

export function registerBookingHandlers() {
  handleSession('booking:listByRoom', ({ roomId }) => listBookingsByRoom(getDatabase(), roomId))

  handleSession('booking:countOpen', ({ apartmentId }) => countOpenBookings(getDatabase(), apartmentId))

  handleSession('booking:create', (payload) => {
    throwIfErrors(validateBookingInput(payload))

    const booking = createBooking(getDatabase(), payload)
    logInfo(`รับจองห้อง ${payload.roomId} โดย ${booking.customerName} (booking_id ${booking.bookingId})`)
    return booking
  })

  handleSession('booking:setStatus', ({ bookingId, status }) => {
    const booking = setBookingStatus(getDatabase(), bookingId, status)
    logInfo(`เปลี่ยนสถานะการจอง ${bookingId} เป็น ${status}`)
    return booking
  })

  handle('booking:convert', ({ bookingId, ...contractInput }) => {
    const errors = validateContractInput(contractInput)
    if (errors.length > 0) throw new Error(errors.join('\n'))

    // ผู้รับเงินมาจากเซสชันเสมอ ไม่รับจากหน้าจอ
    const contract = convertBookingToContract(getDatabase(), bookingId, {
      ...contractInput,
      createdBy: requireSessionUserId()
    })
    logInfo(`แปลงการจอง ${bookingId} เป็นสัญญา (contract_id ${contract.contractId})`)
    return contract
  })

  handleSession('booking:delete', ({ bookingId }) => {
    const result = deleteBooking(getDatabase(), bookingId)
    logInfo(`ลบการจอง ${bookingId}`)
    return result
  })
}
