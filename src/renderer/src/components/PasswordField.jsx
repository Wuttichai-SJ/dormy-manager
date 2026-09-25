import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import FieldError from './FieldError.jsx'

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
  hint = null,
  error = ''
}) {
  const [shown, setShown] = useState(false)

  return (
    <div className={'field' + (error ? ' has-error' : '')}>
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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
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
      {/* error แทนที่ hint — สองบรรทัดซ้อนกันใต้ช่องเดียวอ่านยาก และ hint มักพูดเรื่องเดียวกัน */}
      {error ? (
        <FieldError id={`${id}-error`} message={error} />
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  )
}
