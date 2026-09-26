import { invoke } from './ipc.js'

// ส่ง null เพื่อยกเลิกการแจ้ง
export function setMoveOutNotice(contractId, noticeDate) {
  return invoke('termination:setNotice', { contractId, noticeDate })
}

// overrideRefundable: null = ตามกฎ · true/false = เจ้าของตัดสินเอง (ต้องส่งเสมอ)
export function getTerminationSheet({ contractId, moveOutDate, adjustments, overrideRefundable }) {
  return invoke('termination:sheet', {
    contractId,
    moveOutDate,
    adjustments,
    overrideRefundable
  })
}

export function completeTermination(payload) {
  return invoke('termination:complete', payload)
}

export function getTermination(contractId) {
  return invoke('termination:get', { contractId })
}

export function listTerminations(apartmentId, { search, dateFrom, dateTo } = {}) {
  return invoke('termination:list', { apartmentId, search, dateFrom, dateTo })
}

export function collectShortfall({ contractId, amount, paymentMethod, paymentDate, remark }) {
  return invoke('termination:collect', {
    contractId,
    amount,
    paymentMethod,
    paymentDate,
    remark
  })
}
