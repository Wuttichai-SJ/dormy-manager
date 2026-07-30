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
