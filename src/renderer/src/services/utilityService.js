import { invoke } from './ipc.js'

export function getUtilityDefaults(apartmentId) {
  return invoke('utility:get', { apartmentId })
}

export function saveUtilityDefaults(apartmentId, { water, electric }) {
  return invoke('utility:save', { apartmentId, water, electric })
}

export function applyUtilityDefaultsToRooms(apartmentId) {
  return invoke('utility:applyToRooms', { apartmentId })
}
