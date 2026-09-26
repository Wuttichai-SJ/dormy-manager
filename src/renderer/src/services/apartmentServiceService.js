import { invoke } from './ipc.js'

export function listServices(apartmentId) {
  return invoke('apartmentService:list', { apartmentId })
}

export function createService(apartmentId, payload) {
  return invoke('apartmentService:create', { apartmentId, ...payload })
}

export function updateService(serviceId, payload) {
  return invoke('apartmentService:update', { serviceId, ...payload })
}

export function deleteService(serviceId) {
  return invoke('apartmentService:delete', { serviceId })
}
