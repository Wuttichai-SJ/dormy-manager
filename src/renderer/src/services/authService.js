import { invoke } from './ipc.js'

export function getAuthStatus() {
  return invoke('auth:status')
}

export function setupFirstUser({ fullName, phone, email, password }) {
  return invoke('auth:setup', { fullName, phone, email, password })
}

export function login({ identifier, password, remember }) {
  return invoke('auth:login', { identifier, password, remember })
}

export function logout() {
  return invoke('auth:logout')
}

export function verifyRecoveryCode({ identifier, recoveryCode }) {
  return invoke('auth:recovery:verify', { identifier, recoveryCode })
}

export function resetPasswordWithTicket({ ticket, newPassword }) {
  return invoke('auth:recovery:reset', { ticket, newPassword })
}

export function regenerateRecoveryCode({ password }) {
  return invoke('auth:recovery:regenerate', { password })
}
