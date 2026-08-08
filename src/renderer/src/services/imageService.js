// ตัวห่อ IPC ของรูปภาพ — ตอนนี้ใช้กับ QR รับเงินของหอพักอย่างเดียว
// ช่องทั้งหมดอยู่ที่ src/main/handlers/imageHandlers.js
//
// หน้าจอไม่เคยแตะตัวไฟล์เลย: กล่องเลือกไฟล์เปิดฝั่ง main และ main เป็นคนอ่านไฟล์เอง
// สิ่งที่ข้ามกลับมาคือ data URL ที่เอาไปใส่ <img> ได้ตรงๆ
import { invoke } from './ipc.js'

// คืน { cancelled } ถ้าผู้ใช้ปิดกล่องเลือกไฟล์ · ไม่งั้นคืน { imageId, dataUrl }
export function uploadQrImage(apartmentId) {
  return invoke('image:uploadQr', { apartmentId })
}

// คืน { imageId, dataUrl } · dataUrl เป็น null ถ้าหอยังไม่ได้อัปโหลด QR
export function getQrImage(apartmentId) {
  return invoke('image:getQr', { apartmentId })
}

export function removeQrImage(apartmentId) {
  return invoke('image:removeQr', { apartmentId })
}

export function getImageDataUrl(imageId) {
  return invoke('image:getDataUrl', { imageId })
}
