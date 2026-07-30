// การแปลงจำนวนเงินเข้า/ออกฐานข้อมูล
//
// กฎเหล็กของโปรเจกต์นี้: เงินเก็บเป็น "สตางค์" (INTEGER) เสมอ ไม่ใช่ REAL
// เพราะ 0.1 + 0.2 ในเลขทศนิยมฐานสองไม่เท่ากับ 0.3 พอดี พอบวกค่าเช่า+ค่าน้ำ+ค่าไฟ
// +ค่าบริการหลายรายการเข้าด้วยกันทุกเดือนเป็นสิบปี ยอดในบิลจะเพี้ยนทีละสตางค์
// จนไม่ตรงกับที่เก็บเงินจริง — ปัญหาที่ไล่หาทีหลังยากมาก
//
// ที่นี่คือด่านเดียวที่แปลง "บาทจากหน้าจอ" เป็น "สตางค์ในฐานข้อมูล"
// ห้ามคูณ 100 กระจายเองตามไฟล์อื่น

// จำกัดที่ ~92,233 ล้านบาท (MAX_SAFE_INTEGER สตางค์) — เกินกว่านี้ JS บวกเลขผิดเงียบๆ
const MAX_CENTS = Number.MAX_SAFE_INTEGER

export function toCents(input, fieldLabel = 'จำนวนเงิน') {
  if (input === null || input === undefined || String(input).trim() === '') {
    throw new Error(`กรุณากรอก${fieldLabel}`)
  }

  // ผู้ใช้พิมพ์ "1,500" หรือ "1,500.50" ได้ตามปกติของคนไทย ตัดคอมมาออกก่อน
  const cleaned = String(input).replace(/,/g, '').trim()

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    // ปฏิเสธทศนิยมเกิน 2 ตำแหน่งด้วย ไม่ปัดให้เงียบๆ — ถ้าผู้ใช้พิมพ์ 33.333
    // แปลว่าเขาเข้าใจอะไรผิด ควรบอกมากกว่าเก็บ 33.33 ไปโดยไม่บอก
    throw new Error(`${fieldLabel}ต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง`)
  }

  const [baht, satang = ''] = cleaned.split('.')
  const cents = Number(baht) * 100 + Number(satang.padEnd(2, '0'))

  if (cents > MAX_CENTS) throw new Error(`${fieldLabel}มีค่ามากเกินกว่าที่ระบบรองรับ`)
  return cents
}

// ใช้ตอนส่งข้อมูลกลับไปให้หน้าจอแก้ไขในฟอร์ม (ไม่ใช่ตอนแสดงผลสวยงาม)
// คืนเป็นสตริงเพื่อคง 2 ตำแหน่งไว้ ไม่ให้ 150000 กลายเป็น "1500" แล้วผู้ใช้งงว่าสตางค์หายไปไหน
export function centsToBaht(cents) {
  const value = Number(cents ?? 0)
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
