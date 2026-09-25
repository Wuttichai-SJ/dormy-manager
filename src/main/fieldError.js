// error ที่รู้ว่าผิดที่ "ช่องไหน" ของฟอร์ม — หน้าจอจะได้แสดงข้อความใต้ช่องนั้นตรงๆ
// แทนการแสดงรวมไว้บนสุดของหน้าต่าง (โอ๊คขอ 2026-09-25 "เหมือน error ของระบบทั่วๆไป")
//
// fields = { ชื่อช่อง: ข้อความ } — ชื่อช่องใช้ชื่อเดียวกับ key ใน payload ที่หน้าจอส่งมา
// (fullName, phone, newPassword, ...) หน้าจอจะได้จับคู่เองโดยไม่ต้องมีตารางแปลงชื่อ
// ข้อความที่ไม่ได้เป็นของช่องไหนอยู่ใต้ key `_form` — หน้าจอแสดงบนสุดของหน้าต่าง
//
// message ยังเป็นข้อความเดิมทุกตัวอักษร (ต่อกันด้วย \n ตามลำดับที่ตรวจเจอ) — ที่ไหนที่อ่าน
// แค่ err.message อยู่ ทั้งหน้าจอเก่าและชุดทดสอบ จะเห็นเหมือนเดิมทุกอย่าง
// handle() ของทุกไฟล์ใน handlers/ ส่ง err.fields กลับไปคู่กับ error
export class FieldError extends Error {
  // message ไม่ส่งมา = ต่อข้อความทุกช่องเข้าด้วยกัน (errorList ส่งมาเองเพื่อรักษาลำดับเดิม)
  constructor(fields, message) {
    super(message ?? Object.values(fields).join('\n'))
    this.name = 'FieldError'
    this.fields = fields
  }
}

// ตัวช่วยสำหรับ validator ที่คืน { ช่อง: ข้อความ } — ว่าง = ผ่าน
export function throwIfFieldErrors(fields) {
  if (Object.keys(fields).length > 0) throw new FieldError(fields)
}

// อาร์เรย์ข้อความ error แบบเดิม ที่จำเพิ่มว่าข้อความไหนเป็นของช่องไหน
//
// validator หลายตัวคืนอาร์เรย์ข้อความ และชุดทดสอบนับ .length / อ่านข้อความในนั้นอยู่
// ตัวนี้ยังเป็นอาร์เรย์ธรรมดาทุกอย่าง (push / length / join ใช้ได้เหมือนเดิม) แค่เพิ่ม
//   · add(ช่อง, ข้อความ) — บันทึกข้อความพร้อมชื่อช่อง
//   · push(ข้อความ)     — ข้อความที่ไม่ได้เป็นของช่องไหน (ขึ้นบนสุดของหน้าต่าง)
// ช่องเดียวมีหลายข้อความ แสดงข้อความแรกก่อน แก้แล้วข้อความถัดไปค่อยโผล่ตอนกดบันทึกรอบหน้า
export function errorList() {
  const list = []
  const owners = new Map() // index ในอาร์เรย์ → ชื่อช่อง
  list.add = (field, message) => {
    owners.set(list.length, field)
    list.push(message)
  }
  list.toFieldError = () => {
    const fields = {}
    const general = []
    list.forEach((message, index) => {
      const field = owners.get(index)
      if (!field) general.push(message)
      else if (!(field in fields)) fields[field] = message
    })
    if (general.length > 0) fields._form = general.join('\n')
    return new FieldError(fields, list.join('\n'))
  }
  return list
}

// ใช้แทน `if (errors.length > 0) throw new Error(errors.join('\n'))` กับ errorList()
export function throwIfErrors(list) {
  if (list.length > 0) throw list.toFieldError()
}
