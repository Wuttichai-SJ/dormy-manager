// ตัวห่อ IPC ของการจองห้อง
// ช่องทั้งหมดอยู่ที่ src/main/handlers/bookingHandlers.js
import { invoke } from './ipc.js'

export function listBookingsByRoom(roomId) {
  return invoke('booking:listByRoom', { roomId })
}

export function countOpenBookings(apartmentId) {
  return invoke('booking:countOpen', { apartmentId })
}

export function createBooking(payload) {
  return invoke('booking:create', payload)
}

export function setBookingStatus(bookingId, status) {
  return invoke('booking:setStatus', { bookingId, status })
}

// contractInput = ข้อมูลสัญญาที่เหลือ (วันที่เข้าพัก ค่าเช่า เงินประกัน มิเตอร์ ผู้เช่า)
// ส่วนห้องกับเงินจองยกมาจากใบจองให้เอง
export function convertBookingToContract(bookingId, contractInput) {
  return invoke('booking:convert', { bookingId, ...contractInput })
}

export function deleteBooking(bookingId) {
  return invoke('booking:delete', { bookingId })
}
