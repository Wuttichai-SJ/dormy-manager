import React, { useCallback, useState } from 'react'
import Icon from '../Icon.jsx'

// ข้อความ error ใต้ช่องกรอก
export default function FieldError({ id, message }) {
  if (!message) return null
  return (
    <p id={id} className="field-error" role="alert">
      <Icon name="warningSolid" />
      <span>{message}</span>
    </p>
  )
}

// fields จาก main → ใต้ช่อง · ช่องที่ฟอร์มไม่มี → formError บนสุด · knownFields ต้องส่งมา
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

// id ของข้อความ error = `${id}-error`
export function fieldClass(base, error) {
  return error ? `${base} has-error` : base
}

export function invalidProps(id, error) {
  return error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {}
}
