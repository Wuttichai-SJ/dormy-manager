// ตัวห่อ IPC ของการพิมพ์
// ช่องทั้งหมดอยู่ที่ src/main/handlers/printHandlers.js
//
// ทั้งสองช่องพิมพ์ "หน้าที่กำลังเปิดอยู่" โดยใช้ @media print ใน styles.css ตัดสินว่า
// อะไรลงกระดาษบ้าง — ไม่ต้องส่งข้อมูลเอกสารข้ามไป
import { invoke } from './ipc.js'

// รายชื่อเครื่องพิมพ์ที่ Windows รู้จัก พร้อมธงว่าตัวไหนเป็นเครื่องพิมพ์เสมือน
export function listPrinters() {
  return invoke('print:listPrinters')
}

// ส่งเข้าเครื่องพิมพ์ที่เลือก — เลือกจากกล่องของเราเอง ฝั่ง main จึงพิมพ์ได้เลยไม่เปิดกล่องซ้อน
export function printDocument({ deviceName, copies }) {
  return invoke('print:document', { deviceName, copies })
}

// เปิดกล่องบันทึกไฟล์ · คืน { cancelled, filePath }
export function savePdf(fileName) {
  return invoke('print:savePdf', { fileName })
}

// เปิดโฟลเดอร์แล้วเลือกไฟล์ไว้ให้ พร้อมลากไปแนบส่งต่อ
export function revealPdf(filePath) {
  return invoke('print:revealPdf', { filePath })
}
