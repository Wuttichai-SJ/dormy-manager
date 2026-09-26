// สิทธิ์ตรวจที่ main — การซ่อนปุ่มเป็นแค่หน้าจอ
import { invoke } from './ipc.js'

export function listUsers() {
  return invoke('user:list')
}

export function createUser({ fullName, phone, email, password, role }) {
  return invoke('user:create', { fullName, phone, email, password, role })
}

export function updateUser({ userId, fullName, phone, email, role }) {
  return invoke('user:update', { userId, fullName, phone, email, role })
}

export function setUserActive(userId, isActive) {
  return invoke('user:setActive', { userId, isActive })
}

export function resetUserPassword(userId, newPassword) {
  return invoke('user:resetPassword', { userId, newPassword })
}

export function changeOwnPassword({ currentPassword, newPassword }) {
  return invoke('user:changeOwnPassword', { currentPassword, newPassword })
}
