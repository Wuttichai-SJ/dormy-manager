import { invoke } from './ipc.js'

// คืน { cancelled } หรือ { imageId, dataUrl }
export function uploadQrImage(apartmentId) {
  return invoke('image:uploadQr', { apartmentId })
}

export function getQrImage(apartmentId) {
  return invoke('image:getQr', { apartmentId })
}

export function removeQrImage(apartmentId) {
  return invoke('image:removeQr', { apartmentId })
}

export function getImageDataUrl(imageId) {
  return invoke('image:getDataUrl', { imageId })
}
