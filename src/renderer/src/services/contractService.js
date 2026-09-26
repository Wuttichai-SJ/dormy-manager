import { invoke } from './ipc.js'

export function listRoomsForApartment(apartmentId, filters = {}) {
  return invoke('room:listForApartment', { apartmentId, ...filters })
}

export function getContractsForRoom(roomId) {
  return invoke('contract:forRoom', { roomId })
}

export function getContract(contractId) {
  return invoke('contract:get', { contractId })
}

export function createContract(payload) {
  return invoke('contract:create', payload)
}
