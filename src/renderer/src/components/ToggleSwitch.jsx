import React from 'react'

// สวิตช์เปิด/ปิดแบบต้นแบบ — แถบสีเทาอ่อนเต็มความกว้าง มีสวิตช์อยู่ซ้ายแล้วตามด้วยข้อความ
// เปิดแล้วเป็นสีเขียว
//
// ยังเป็น <input type="checkbox"> จริงข้างใน (ซ่อนด้วย .toggle-input) ไม่ได้วาดเป็น div
// เปล่าๆ — จะได้กด Space/Tab ได้ตามปกติ และโปรแกรมอ่านหน้าจอยังรู้ว่าเป็นช่องติ๊ก
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
