// error ที่รู้ว่าผิดช่องไหน — fields = { ชื่อช่อง: ข้อความ }, ไม่มีช่องใช้ _form
export class FieldError extends Error {
  constructor(fields, message) {
    super(message ?? Object.values(fields).join('\n'))
    this.name = 'FieldError'
    this.fields = fields
  }
}

export function throwIfFieldErrors(fields) {
  if (Object.keys(fields).length > 0) throw new FieldError(fields)
}

// อาร์เรย์ error ที่จำชื่อช่องด้วย — add(ช่อง, ข้อความ) / push(ข้อความ)
export function errorList() {
  const list = []
  const owners = new Map()
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

export function throwIfErrors(list) {
  if (list.length > 0) throw list.toFieldError()
}
