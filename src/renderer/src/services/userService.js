// ตัวห่อ IPC ของหน้าจัดการผู้ใช้ — ช่องทั้งหมดอยู่ที่ src/main/handlers/userHandlers.js
//
// ทุกช่องยกเว้น changeOwnPassword เป็นของเจ้าของหอเท่านั้น และ **main เป็นฝ่ายตรวจ**
// การซ่อนปุ่มฝั่งนี้เป็นแค่การจัดหน้าจอ ไม่ได้กันสิทธิ์
import { invoke } from './ipc.js'

export function listUsers() {
  return invoke('user:list')
}

// สร้างบัญชีใหม่ · บัญชีเจ้าของจะได้ recoveryCode กลับมาให้แสดงครั้งเดียว (พนักงานได้ null)
export function createUser({ fullName, phone, email, password, role }) {
  return invoke('user:create', { fullName, phone, email, password, role })
}

// แก้ข้อมูล/บทบาท · เลื่อนพนักงานขึ้นเป็นเจ้าของจะได้ recoveryCode ใบใหม่กลับมา
export function updateUser({ userId, fullName, phone, email, role }) {
  return invoke('user:update', { userId, fullName, phone, email, role })
}

// ปิด/เปิดบัญชี — ระบบไม่มีการลบผู้ใช้ทิ้ง เพราะใบเสร็จเก่าอ้างชื่อผู้รับเงินไว้
export function setUserActive(userId, isActive) {
  return invoke('user:setActive', { userId, isActive })
}

// เจ้าของตั้งรหัสผ่านใหม่ให้บัญชีอื่น = ทางกู้คืนของพนักงานที่ลืมรหัสผ่าน
export function resetUserPassword(userId, newPassword) {
  return invoke('user:resetPassword', { userId, newPassword })
}

// เปลี่ยนรหัสผ่านของตัวเอง — บัญชีที่แก้คือบัญชีในเซสชันเสมอ หน้าจอระบุคนอื่นไม่ได้
export function changeOwnPassword({ currentPassword, newPassword }) {
  return invoke('user:changeOwnPassword', { currentPassword, newPassword })
}
