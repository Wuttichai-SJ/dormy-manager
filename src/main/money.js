// เงินเก็บเป็นสตางค์ (INTEGER) เสมอ — แปลงที่นี่ที่เดียว



// JavaScript ใช้ Number แบบ floating-point ซึ่งอาจเกิดปัญหาความแม่นยำ เช่น 0.1 + 0.2 = 0.3000000004
// เพดาน MAX_SAFE_INTEGER สตางค์
const MAX_CENTS = Number.MAX_SAFE_INTEGER

export function toCents(input, fieldLabel = 'จำนวนเงิน') { // แปลงเงิน 10.00 --> 1000
  if (input === null || input === undefined || String(input).trim() === '') {
    throw new Error(`กรุณากรอก${fieldLabel}`)
  }

  const cleaned = String(input).replace(/,/g, '').trim() // 1,200 --> 1200

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    // ทศนิยมเกิน 2 ตำแหน่ง = error ไม่ปัดเงียบ
    throw new Error(`${fieldLabel}ต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง`)
  }

  const [baht, satang = ''] = cleaned.split('.') // 1250.50 ---> ["1250", "50"]
  const cents = Number(baht) * 100 + Number(satang.padEnd(2, '0')) // 1250*100 = 125000 + 50 = return 125050
                                          // padEnd --> เพิ่มตัวขาด
  if (cents > MAX_CENTS) throw new Error(`${fieldLabel}มีค่ามากเกินกว่าที่ระบบรองรับ`)
  return cents
}

export function centsToBaht(cents) { // แปลง 125050 --> 1250.50
  const value = Number(cents ?? 0)
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value) // make ค่าเป็น +
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}` // padStart เติมข้างหน้า
}                       // floor ตัดทศนิยมทิ้ง
