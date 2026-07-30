import React, { useState } from 'react'
import Icon from '../Icon.jsx'

// ช่องรหัสผ่านที่กดดูตัวอักษรได้ — จำเป็นจริงในแอปนี้ เพราะรหัสผ่านและรหัสสำรอง
// ถูกจดใส่กระดาษแล้วพิมพ์กลับเข้ามา การพิมพ์ผิดโดยมองไม่เห็นคือปัญหาที่พบบ่อยที่สุด
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder = '',
  autoComplete = 'current-password',
  autoFocus = false,
  hint = null
}) {
  const [shown, setShown] = useState(false)

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-with-action">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="input-action"
          onClick={() => setShown((s) => !s)}
          // ปุ่มนี้ไม่ควรถูกโฟกัสด้วย Tab ระหว่างกรอกฟอร์ม — คนกรอกอยากไปช่องถัดไป
          tabIndex={-1}
          aria-label={shown ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          title={shown ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
        >
          <Icon name={shown ? 'eyeOff' : 'eye'} />
        </button>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}
