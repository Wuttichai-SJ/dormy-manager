// ตัวห่อ IPC ของการแจ้งย้ายออก / ยกเลิกสัญญา / คืนเงินประกัน
// ช่องทั้งหมดอยู่ที่ src/main/handlers/terminationHandlers.js
//
// ไม่ต้องส่ง "ผู้ทำรายการ" ไปเอง — ฝั่ง main อ่านจากเซสชันที่ล็อกอินอยู่เสมอ
import { invoke } from './ipc.js'

// บันทึกวันที่ผู้เช่าแจ้งย้ายออก · ส่ง null เพื่อยกเลิกการแจ้ง (ผู้เช่าเปลี่ยนใจไม่ย้ายแล้ว)
export function setMoveOutNotice(contractId, noticeDate) {
  return invoke('termination:setNotice', { contractId, noticeDate })
}

// หน้าสรุปก่อนยืนยัน — คำนวณอย่างเดียว ยังไม่เขียนอะไรลงฐานข้อมูล
// เรียกใหม่ทุกครั้งที่เปลี่ยนวันที่ออกหรือแก้รายการ เพราะทั้งผลการตัดสินเรื่องเงินประกัน
// และยอดสุทธิขยับตามวันที่ (สูตรอยู่ฝั่ง main ที่เดียว)
// overrideRefundable = null/undefined ใช้ผลตามกฎ · true/false คือเจ้าของหอตัดสินเอง
// ต้องส่งไปด้วยเสมอ ไม่งั้นยอดสรุปบนจอจะเป็นของ "ตามกฎ" ค้างไว้ทั้งที่ติ๊กข้ามกฎแล้ว
export function getTerminationSheet({ contractId, moveOutDate, adjustments, overrideRefundable }) {
  return invoke('termination:sheet', {
    contractId,
    moveOutDate,
    adjustments,
    overrideRefundable
  })
}

// ยืนยันย้ายออก — ตัดหนี้จากเงินประกัน ออกใบเสร็จคืนเงิน ปิดสัญญา คืนห้องเป็นว่าง
// ทั้งหมดในธุรกรรมเดียว · overrideRefundable ใส่เมื่อเจ้าของตัดสินต่างจากกฎ (ต้องมีเหตุผล)
export function completeTermination(payload) {
  return invoke('termination:complete', payload)
}

export function getTermination(contractId) {
  return invoke('termination:get', { contractId })
}
