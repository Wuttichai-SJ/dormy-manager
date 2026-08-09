// สร้างเนื้อไฟล์ CSV — ตรรกะล้วน ไม่แตะ electron และไม่แตะไฟล์ จึงทดสอบได้
//
// **ส่งออกเป็น CSV ไม่ใช่ .xlsx** ตามนโยบาย dependency ขั้นต่ำ — ไฟล์ .xlsx จริงต้องพึ่ง
// ไลบรารีอย่าง exceljs ซึ่งเป็นภาระอีกตัวที่ต้องดูแลไป 20 ปี ส่วน CSV เขียนเองได้ในไม่กี่บรรทัด
// และ Excel เปิดได้ตรงๆ (ดับเบิลคลิกไฟล์แล้วขึ้นเป็นตารางเลย)

// **ต้องมี BOM ของ UTF-8 นำหน้าไฟล์เสมอ** ไม่งั้น Excel บน Windows จะเดารหัสอักขระเป็น
// ANSI แล้วภาษาไทยกลายเป็นตัวยึกยือทั้งไฟล์ — นี่คือเหตุผลเดียวที่คนบ่นว่า "export
// ภาษาไทยแล้วอ่านไม่ออก" และแก้ได้ด้วยสามไบต์
export const UTF8_BOM = '﻿'

// ครอบทุกช่องด้วยเครื่องหมายคำพูดไปเลย ง่ายกว่าและไม่มีทางผิด — ตัวเลขที่อยู่ในเครื่องหมาย
// คำพูด Excel ก็ยังอ่านเป็นตัวเลข ส่วน " ในเนื้อข้อมูลต้องคูณเป็น "" ตามกติกาของ CSV
function toCsvCell(value) {
  if (value === null || value === undefined) return '""'
  return `"${String(value).replace(/"/g, '""')}"`
}

// columns = [{ key, label }] · rows = อาร์เรย์ของ object
// หน้าจอเป็นคนบอกว่าจะส่งออกคอลัมน์ไหนด้วยชื่ออะไร เพราะหัวตารางในไฟล์ควรตรงกับที่เห็นบนจอ
//
// ปิดท้ายด้วย \r\n เพราะ Excel บน Windows คาดหวังแบบนั้น
export function buildCsv(columns, rows) {
  if (!Array.isArray(columns) || columns.length === 0) throw new Error('ไม่ได้ระบุคอลัมน์')
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('ไม่มีข้อมูลให้ส่งออก')

  const lines = [columns.map((c) => toCsvCell(c.label)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((c) => toCsvCell(row?.[c.key])).join(','))
  }

  return UTF8_BOM + lines.join('\r\n') + '\r\n'
}

// ชื่อไฟล์ต้องเอาไปตั้งเป็นชื่อไฟล์จริงบน Windows ได้ — ห้าม \ / : * ? " < > |
export function safeFileName(name, fallback = 'export') {
  return String(name ?? '').replace(/[\\/:*?"<>|]/g, '').trim() || fallback
}
