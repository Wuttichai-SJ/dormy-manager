// error ที่รู้ว่าผิดช่องไหน — fields = { ชื่อช่อง: ข้อความ }, ไม่มีช่องใช้ _form
export class FieldError extends Error { // สร้าง field error ลูกโดยมีคุณสมบัติเหมือน Error ระบบ
  constructor(fields, message) { 
    // super --> ส่งข้อความไปให้ class แม่
    super(message ?? Object.values(fields).join('\n')) // ส่งข้อความ Error
    this.name = 'FieldError' // ใช้ชื่อ FieldError เพื่อระบุว่า Error นี้เกิดจาก fieldError.js ที่เกี่ยวกับการกรอกข้อมูล ไม่ใช่หลังระบบ
    this.fields = fields // เก็บค่าไว้ใน Error เวลาจะแสดงใน UI
  }
}

// เงื่อนไขถ้า key object ที่เก็บมีตั้งแต่ 1 ให่ Error
export function throwIfFieldErrors(fields) {
  if (Object.keys(fields).length > 0) throw new FieldError(fields) 
}

// อาร์เรย์ error ที่จำชื่อช่องด้วย — add(ช่อง, ข้อความ) / push(ข้อความ)
export function errorList() {
  const list = []
  const owners = new Map() // set owners ให้มีความสามารถในการจำ
  list.add = (field, message) => {
    owners.set(list.length, field)
    list.push(message)
  } // -----------------------------------> list [ list[0] = "กรุณากรอกชื่อ" ]
  // owners[0] = "name" 
  
  list.toFieldError = () => { // เอา error ใน list มาแปลงจัดระเบียบ
    const fields = {}
    const general = []
    list.forEach((message, index) => { // วน error ทุกตัวใน list
      const field = owners.get(index) // field = owners.index
      if (!field) general.push(message) // หากไม่ใช่ error ที่มี index map ให้เก็บ error ใน general
      else if (!(field in fields)) fields[field] = message // นำ index มาเติมเข้า fields = message --> name: "กรุณากรอกชื่อ"
    })
    // วน loop เสด เช็คว่า general มี error ไหม
    if (general.length > 0) fields._form = general.join('\n') // ถ้ามีให้เป็น ( _form: "ข้อความ general" )
    return new FieldError(fields, list.join('\n')) // นำ object fields ทั้งหมดส่งไปที่ class
  }
  return list
}

export function throwIfErrors(list) {
  if (list.length > 0) throw list.toFieldError()
}
