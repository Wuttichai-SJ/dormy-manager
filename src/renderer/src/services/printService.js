import { invoke } from './ipc.js'

// maxPages = จำนวนหน้าที่เอกสารควรมี

// คืน { base64, scale }
export function previewDocument(maxPages = 1) {
  return invoke('print:preview', { maxPages })
}

export function listPrinters() {
  return invoke('print:listPrinters')
}

export function printDocument({ deviceName, copies, maxPages = 1 }) {
  return invoke('print:document', { deviceName, copies, maxPages })
}

// คืน { cancelled, filePath }
export function savePdf(fileName, maxPages = 1) {
  return invoke('print:savePdf', { fileName, maxPages })
}

export function revealPdf(filePath) {
  return invoke('print:revealPdf', { filePath })
}
