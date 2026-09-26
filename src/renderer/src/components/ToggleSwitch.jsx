import React from 'react'

// ข้างในยังเป็น checkbox จริง (คีย์บอร์ดและโปรแกรมอ่านหน้าจอใช้ได้)
export default function ToggleSwitch({ checked, onChange, label, disabled }) {
  return (
    <label className={'toggle-row' + (disabled ? ' disabled' : '')}>
      <input
        type="checkbox"
        className="toggle-input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
      <span className="toggle-label">{label}</span>
    </label>
  )
}
