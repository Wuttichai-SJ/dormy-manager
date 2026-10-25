// ใส่ขีดและจำกัดจำนวนหลักระหว่างพิมพ์ — main ตัดขีดออกก่อนบันทึกเสมอ
import { BANK_ACCOUNT_GROUPS } from './constants.js'

const PROMPTPAY = 'พร้อมเพย์'

function digitsOf(value) {
  return String(value ?? '').replace(/\D/g, '')
}

// [3, 1, 5, 1] → 123-4-56789-0 · ตัดหลักที่เกินทิ้ง
function group(digits, sizes) {
  const parts = []
  let start = 0
  for (const size of sizes) {
    if (start >= digits.length) break
    parts.push(digits.slice(start, start + size))
    start += size
  }
  return parts.join('-')
}

// มือถือ 08x-xxx-xxxx · กรุงเทพ 02-xxx-xxxx · ต่างจังหวัด 0xx-xxx-xxx
export function formatPhoneInput(value) {
  const digits = digitsOf(value)
  if (digits[0] === '0' && digits[1] === '2') return group(digits, [2, 3, 4])
  if (digits[0] === '0' && /[3457]/.test(digits[1] ?? '')) return group(digits, [3, 3, 3])
  return group(digits, [3, 3, 4])
}

// 1-2345-67890-12-3
export function formatIdCardInput(value) {
  return group(digitsOf(value), [1, 4, 5, 2, 1])
}

// พร้อมเพย์ = เบอร์มือถือ หรือ เลขบัตร (เกิน 10 หลัก)
export function formatAccountNumberInput(bankName, value) {
  const digits = digitsOf(value)
  if (bankName === PROMPTPAY) {
    return digits.length > 10 ? formatIdCardInput(digits) : formatPhoneInput(digits)
  }
  return group(digits, BANK_ACCOUNT_GROUPS[bankName] ?? [3, 1, 5, 1])
}

// แสดงผล — เลขเก่าที่จำนวนหลักไม่ตรงกับธนาคารแสดงตามเดิม
export function formatAccountNumber(bankName, digits) {
  const formatted = formatAccountNumberInput(bankName, digits)
  return digitsOf(formatted) === digitsOf(digits) ? formatted : digits
}
