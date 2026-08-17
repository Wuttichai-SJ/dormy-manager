// ตัวห่อ IPC ของหน้าภาพรวม — ช่องอยู่ที่ src/main/handlers/dashboardHandlers.js
//
// ตัวเลขทั้งชุดมาในรอบเดียว ไม่ได้ยิงแยกรายการ์ด เพื่อให้ทุกตัวเลขบนหน้าเป็นภาพของ
// ฐานข้อมูล ณ จังหวะเดียวกัน (และเปิดหอหนึ่งครั้ง = เรียก IPC หนึ่งครั้ง)
import { invoke } from './ipc.js'

export function getDashboardSummary(apartmentId) {
  return invoke('dashboard:summary', { apartmentId })
}
