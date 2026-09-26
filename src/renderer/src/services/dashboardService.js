import { invoke } from './ipc.js'

export function getDashboardSummary(apartmentId) {
  return invoke('dashboard:summary', { apartmentId })
}
