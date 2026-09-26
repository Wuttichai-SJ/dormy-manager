// ต้องมี BOM ไม่งั้น Excel อ่านภาษาไทยเพี้ยน
export const UTF8_BOM = '﻿'

// ข้อความขึ้นต้นด้วย = + - @ เติม ' กัน Excel คำนวณเป็นสูตร (ตัวเลขไม่แตะ)
const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/

function toCsvCell(value) {
  if (value === null || value === undefined) return '""'
  let text = String(value)
  if (typeof value === 'string' && FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) {
    text = `'${text}`
  }
  return `"${text.replace(/"/g, '""')}"`
}

export function buildCsv(columns, rows) {
  if (!Array.isArray(columns) || columns.length === 0) throw new Error('ไม่ได้ระบุคอลัมน์')
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('ไม่มีข้อมูลให้ส่งออก')

  const lines = [columns.map((c) => toCsvCell(c.label)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((c) => toCsvCell(row?.[c.key])).join(','))
  }

  return UTF8_BOM + lines.join('\r\n') + '\r\n'
}

export function safeFileName(name, fallback = 'export') {
  return String(name ?? '').replace(/[\\/:*?"<>|]/g, '').trim() || fallback
}
