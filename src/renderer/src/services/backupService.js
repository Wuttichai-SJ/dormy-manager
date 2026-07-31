// ตัวห่อ IPC ของการสำรอง/กู้คืนข้อมูล
// ช่องทั้งหมดอยู่ที่ src/main/handlers/backupHandlers.js
import { invoke } from './ipc.js'

export function listBackups() {
  return invoke('backup:list')
}

export function createBackup(label) {
  return invoke('backup:create', { label })
}

// กู้คืนแล้วแอปจะปิดตัวเองและเปิดใหม่ทันที — คำเตือนและการยืนยันอยู่ฝั่ง main
// (กล่องของระบบ) เพราะต้องแน่ใจว่าผู้ใช้เห็นก่อนที่หน้าจอจะหายไป
export function restoreBackup(fileName) {
  return invoke('backup:restore', { fileName })
}

export function deleteBackup(fileName) {
  return invoke('backup:delete', { fileName })
}

export function revealBackupFolder() {
  return invoke('backup:reveal')
}
