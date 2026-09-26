// จัดรูปแบบเพื่อแสดงผลเท่านั้น

const baht = new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

export function formatBaht(cents) {
  return baht.format(Number(cents ?? 0) / 100)
}

export function centsToInput(cents) {
  return (Number(cents ?? 0) / 100).toFixed(2)
}

// เอกสารใช้ พ.ศ. — ฐานข้อมูลยังเก็บ ค.ศ. แบบ ISO
export const BUDDHIST_YEAR_OFFSET = 543

export function formatDocumentDate(iso) {
  if (!iso) return '-'
  const [year, month, day] = String(iso).split('-')
  if (!year || !month || !day) return '-'
  return `${day}/${month}/${Number(year) + BUDDHIST_YEAR_OFFSET}`
}

export function formatDocumentMonth(month) {
  if (!month) return '-'
  const [year, monthPart] = String(month).split('-')
  if (!year || !monthPart) return '-'
  return `${monthPart}-${Number(year) + BUDDHIST_YEAR_OFFSET}`
}
