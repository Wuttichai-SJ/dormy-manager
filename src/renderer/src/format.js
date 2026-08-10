// การจัดรูปแบบสำหรับ "แสดงผล" เท่านั้น — การแปลงเงินเข้าฐานข้อมูลอยู่ที่ src/main/money.js
// ฝั่งนี้แปลงสตางค์เป็นข้อความอ่านง่าย ไม่มีการคำนวณเงินเกิดขึ้นที่นี่เด็ดขาด

// ใช้ th-TH เพื่อให้ได้คอมมาคั่นหลักพันแบบไทย และบังคับ 2 ตำแหน่งเสมอ
// (1500 → "1,500.00" ไม่ใช่ "1,500" — ใบแจ้งหนี้ต้องเห็นสตางค์ทุกบรรทัด)
const baht = new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

export function formatBaht(cents) {
  return baht.format(Number(cents ?? 0) / 100)
}

// สำหรับเติมกลับลงช่องกรอกในฟอร์มแก้ไข — ห้ามมีคอมมา ไม่งั้นส่งกลับไปแล้ว
// ต้องมาไล่ตัดคอมมาอีกรอบ (main รับได้ทั้งสองแบบ แต่ให้ค่าที่สะอาดไปเลยดีกว่า)
export function centsToInput(cents) {
  return (Number(cents ?? 0) / 100).toFixed(2)
}

// ------------------------------------------------------------------
// วันที่บนเอกสารที่ยื่นให้ผู้เช่า — พ.ศ. (ผู้ใช้สั่ง 2026-08-10)
// ------------------------------------------------------------------
// ใบแจ้งหนี้กับใบเสร็จเป็นเอกสารที่ผู้เช่าคนไทยถือกลับบ้าน จึงใช้ปี พ.ศ. ต่างจากต้นแบบ
// ที่ขึ้นเป็น ค.ศ.
//
// **ฐานข้อมูลยังเก็บเป็น ค.ศ. รูปแบบ ISO เหมือนเดิมทุกที่** — ที่นี่แปลงตอนแสดงผลอย่างเดียว
// ถ้าเก็บเป็น พ.ศ. ลงฐานข้อมูล การเทียบวันที่ ('2026-08-31' > '2026-07-20') จะพังทั้งระบบ
// และข้อมูลเก่ากับใหม่จะปนกันจนแยกไม่ออกว่าแถวไหนเป็นปีอะไร
export const BUDDHIST_YEAR_OFFSET = 543

// 'YYYY-MM-DD' -> 'DD/MM/พ.ศ.'
export function formatDocumentDate(iso) {
  if (!iso) return '-'
  const [year, month, day] = String(iso).split('-')
  if (!year || !month || !day) return '-'
  return `${day}/${month}/${Number(year) + BUDDHIST_YEAR_OFFSET}`
}

// 'YYYY-MM' -> 'MM-พ.ศ.' (ลำดับเดือน-ปี ตามที่ต้นแบบขึ้นบนบิล)
export function formatDocumentMonth(month) {
  if (!month) return '-'
  const [year, monthPart] = String(month).split('-')
  if (!year || !monthPart) return '-'
  return `${monthPart}-${Number(year) + BUDDHIST_YEAR_OFFSET}`
}
