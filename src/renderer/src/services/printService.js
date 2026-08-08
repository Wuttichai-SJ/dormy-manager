// ตัวห่อ IPC ของการพิมพ์
// ช่องทั้งหมดอยู่ที่ src/main/handlers/printHandlers.js
//
// ทั้งสองช่องพิมพ์ "หน้าที่กำลังเปิดอยู่" โดยใช้ @media print ใน styles.css ตัดสินว่า
// อะไรลงกระดาษบ้าง — ไม่ต้องส่งข้อมูลเอกสารข้ามไป
import { invoke } from './ipc.js'

// เปิดกล่องเลือกเครื่องพิมพ์ของ Windows · คืน { cancelled } ถ้าผู้ใช้กดยกเลิก
export function printDocument() {
  return invoke('print:document')
}

// เปิดกล่องบันทึกไฟล์ · คืน { cancelled, filePath }
export function savePdf(fileName) {
  return invoke('print:savePdf', { fileName })
}

// เปิดโฟลเดอร์แล้วเลือกไฟล์ไว้ให้ พร้อมลากไปแนบส่งต่อ
export function revealPdf(filePath) {
  return invoke('print:revealPdf', { filePath })
}
