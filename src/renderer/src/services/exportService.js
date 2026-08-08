// ตัวห่อ IPC ของการส่งออกตาราง
// ช่องทั้งหมดอยู่ที่ src/main/handlers/exportHandlers.js
//
// ไฟล์ที่ได้เป็น CSV ที่มี BOM ของ UTF-8 นำหน้า — ดับเบิลคลิกแล้ว Excel เปิดเป็นตาราง
// และภาษาไทยไม่เพี้ยน (ดูเหตุผลที่ไม่ทำเป็น .xlsx ในไฟล์ handler)
import { invoke } from './ipc.js'

// columns = [{ key, label }] · rows = อาร์เรย์ของ object ที่มีคีย์ตรงกับ columns
export function exportCsv({ fileName, columns, rows }) {
  return invoke('export:csv', { fileName, columns, rows })
}

export function revealExport(filePath) {
  return invoke('export:reveal', { filePath })
}
