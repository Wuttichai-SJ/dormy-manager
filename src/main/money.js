// เงินเก็บเป็นสตางค์ (INTEGER) เสมอ — แปลงที่นี่ที่เดียว

// เพดาน MAX_SAFE_INTEGER สตางค์
const MAX_CENTS = Number.MAX_SAFE_INTEGER

export function toCents(input, fieldLabel = 'จำนวนเงิน') {
  if (input === null || input === undefined || String(input).trim() === '') {
    throw new Error(`กรุณากรอก${fieldLabel}`)
  }

  const cleaned = String(input).replace(/,/g, '').trim()

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    // ทศนิยมเกิน 2 ตำแหน่ง = error ไม่ปัดเงียบ
    throw new Error(`${fieldLabel}ต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง`)
  }

  const [baht, satang = ''] = cleaned.split('.')
  const cents = Number(baht) * 100 + Number(satang.padEnd(2, '0'))

  if (cents > MAX_CENTS) throw new Error(`${fieldLabel}มีค่ามากเกินกว่าที่ระบบรองรับ`)
  return cents
}

export function centsToBaht(cents) {
  const value = Number(cents ?? 0)
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
