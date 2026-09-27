import { invoke } from './ipc.js'

export function listBackups() {
  return invoke('backup:list')
}

export function createBackup(label) {
  return invoke('backup:create', { label })
}

export function restoreBackup(fileName) {
  return invoke('backup:restore', { fileName })
}

export function deleteBackup(fileName) {
  return invoke('backup:delete', { fileName })
}

export function revealBackupFolder() {
  return invoke('backup:reveal')
}

// คืน { cancelled } หรือ { filePath }
export function exportBackup(fileName) {
  return invoke('backup:export', { fileName })
}

// คืน { cancelled } หรือข้อมูลไฟล์ที่นำเข้า
export function importBackup() {
  return invoke('backup:import')
}
