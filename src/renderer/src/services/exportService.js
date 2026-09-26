import { invoke } from './ipc.js'

// columns = [{ key, label }] · rows = อาร์เรย์ของ object
export function exportCsv({ fileName, columns, rows }) {
  return invoke('export:csv', { fileName, columns, rows })
}

export function revealExport(filePath) {
  return invoke('export:reveal', { filePath })
}
