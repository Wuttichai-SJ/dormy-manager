import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import FieldError from './FieldError.jsx'

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
          // ไม่ให้ Tab มาโฟกัสปุ่มนี้
          tabIndex={-1}
          aria-label={shown ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          title={shown ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
        >
          <Icon name={shown ? 'eyeOff' : 'eye'} />
        </button>
      </div>
      {error ? (
        <FieldError id={`${id}-error`} message={error} />
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  )
}
