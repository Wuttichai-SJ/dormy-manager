import { invoke } from './ipc.js'

export function listTenants(search) {
  return invoke('tenant:list', { search })
}

export function listTenantsByApartment(apartmentId) {
  return invoke('tenant:listByApartment', { apartmentId })
}

export function getTenant(tenantId) {
  return invoke('tenant:get', { tenantId })
}

export function createTenant(payload) {
  return invoke('tenant:create', payload)
}

export function updateTenant(tenantId, payload) {
  return invoke('tenant:update', { tenantId, ...payload })
}

export function deleteTenant(tenantId) {
  return invoke('tenant:delete', { tenantId })
}
