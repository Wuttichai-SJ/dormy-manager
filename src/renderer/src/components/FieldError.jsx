import React, { useCallback, useState } from 'react'
import Icon from '../Icon.jsx'

// ข้อความ error ใต้ช่องกรอก — แบบเดียวกับฟอร์มทั่วไป: ขอบช่องแดง + ไอคอน + ข้อความแดง
// ติดอยู่ใต้ช่องที่ผิดเลย (โอ๊คขอ 2026-09-25) ไม่ใช่ไปรวมไว้บนสุดของหน้าต่าง
//
// id ใช้ผูกกับ aria-describedby ของช่องกรอก โปรแกรมอ่านหน้าจอจะอ่านข้อความนี้ต่อจากชื่อช่อง
export default function FieldError({ id, message }) {
  if (!message) return null
  return (
    <p id={id} className="field-error" role="alert">
      <Icon name="warningSolid" />
      <span>{message}</span>
    </p>
  )
}

// สถานะ error ของฟอร์มหนึ่งฟอร์ม
//
// main ส่ง { success: false, error, fields } มา (ดู src/main/fieldError.js)
//   · fields บอกช่องที่ผิด → แสดงใต้ช่องนั้น
//   · ช่องที่ฟอร์มนี้ไม่มี หรือ error ที่ไม่ได้บอกช่อง → formError แสดงบนสุดของหน้าต่าง
// knownFields ต้องส่งมา — ไม่งั้น error ของช่องที่ฟอร์มนี้ไม่ได้วาดจะหายไปเงียบๆ
//
// clear(ช่อง) เรียกตอนผู้ใช้แก้ช่องนั้น — แก้แล้ว error ของช่องนั้นหายทันที ไม่ต้องรอกดบันทึก
export function useFormErrors(knownFields) {
  const [state, setState] = useState({ fields: {}, form: '' })

  const fromResult = useCallback(
    (res) => {
      const fields = {}
      const leftover = []
      for (const [key, message] of Object.entries(res.fields ?? {})) {
        if (knownFields.includes(key)) fields[key] = message
        else leftover.push(message)
      }
      const hasFields = Object.keys(fields).length > 0
      setState({
        fields,
        form: hasFields ? leftover.join('\n') : leftover.join('\n') || res.error || ''
      })
    },
    // knownFields เป็นอาร์เรย์คงที่ที่ฟอร์มประกาศไว้ ไม่เปลี่ยนระหว่างใช้งาน
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const clear = useCallback((key) => {
    setState((s) => {
      if (!s.fields[key]) return s
      const { [key]: _removed, ...rest } = s.fields
      return { ...s, fields: rest }
    })
  }, [])

  const reset = useCallback(() => setState({ fields: {}, form: '' }), [])

  return { errors: state.fields, formError: state.form, fromResult, clear, reset }
}
