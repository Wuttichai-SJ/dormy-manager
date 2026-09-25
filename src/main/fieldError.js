// error ที่รู้ว่าผิดที่ "ช่องไหน" ของฟอร์ม — หน้าจอจะได้แสดงข้อความใต้ช่องนั้นตรงๆ
// แทนการแสดงรวมไว้บนสุดของหน้าต่าง (โอ๊คขอ 2026-09-25 "เหมือน error ของระบบทั่วๆไป")
//
// fields = { ชื่อช่อง: ข้อความ } — ชื่อช่องใช้ชื่อเดียวกับ key ใน payload ที่หน้าจอส่งมา
// (fullName, phone, newPassword, ...) หน้าจอจะได้จับคู่เองโดยไม่ต้องมีตารางแปลงชื่อ
//
// message ยังเป็นข้อความเดิมทุกตัวอักษร (ต่อกันด้วย \n ตามลำดับช่อง) — ที่ไหนที่อ่านแค่
// err.message อยู่ ทั้งหน้าจอเก่าและชุดทดสอบ จะเห็นเหมือนเดิมทุกอย่าง
// handle() ของทุกไฟล์ใน handlers/ ส่ง err.fields กลับไปคู่กับ error
export class FieldError extends Error {
  constructor(fields) {
    super(Object.values(fields).join('\n'))
    this.name = 'FieldError'
    this.fields = fields
  }
}

// ตัวช่วยสำหรับ validator ที่คืน { ช่อง: ข้อความ } — ว่าง = ผ่าน
export function throwIfFieldErrors(fields) {
  if (Object.keys(fields).length > 0) throw new FieldError(fields)
}
