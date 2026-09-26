import { invoke } from './ipc.js'

export function listMeterBatches(apartmentId) {
  return invoke('meter:listBatches', { apartmentId })
}

export function createMeterBatch(apartmentId, readingDate) {
  return invoke('meter:createBatch', { apartmentId, readingDate })
}

// side = 'water' | 'electric'
export function getMeterSheet(batchId, side) {
  return invoke('meter:getSheet', { batchId, side })
}

export function saveMeterReadings(batchId, side, rows) {
  return invoke('meter:saveReadings', { batchId, side, rows })
}

export function deleteMeterBatch(batchId) {
  return invoke('meter:deleteBatch', { batchId })
}
