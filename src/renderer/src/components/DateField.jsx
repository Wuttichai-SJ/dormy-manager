import React, { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

// ช่องวันที่ วว/ดด/ปปปป — <input type=date> แสดงตามภาษาเครื่อง (อาจเป็น mm/dd)
export default function DateField({ id, value, onChange, disabled }) {
  const [text, setText] = useState(() => isoToDisplay(value))
  const pickerRef = useRef(null)

  // ไม่ทับข้อความที่กำลังพิมพ์ถ้าได้ค่าเดียวกัน
  useEffect(() => {
    if (displayToIso(text) !== value) setText(isoToDisplay(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function onType(raw) {
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    let next = digits
    if (digits.length > 4) next = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
    else if (digits.length > 2) next = `${digits.slice(0, 2)}/${digits.slice(2)}`

    setText(next)
    // ยังไม่ครบ = ''
    onChange(displayToIso(next))
  }

  function openPicker() {
    const el = pickerRef.current
    if (!el) return
    // showPicker โยน error ได้ — ผู้ใช้ยังพิมพ์เองได้
    try {
      el.showPicker()
    } catch {
    }
  }

  return (
    <div className="date-field">
      <input
        id={id}
        className="date-field-text"
        type="text"
        inputMode="numeric"
        placeholder="วว/ดด/ปปปป"
        value={text}
        disabled={disabled}
        onChange={(e) => onType(e.target.value)}
      />

      <button
        type="button"
        className="date-field-btn"
        onClick={openPicker}
        disabled={disabled}
        aria-label="เลือกวันที่จากปฏิทิน"
      >
        <Icon name="calendar" />
      </button>

      <input
        ref={pickerRef}
        className="date-field-picker"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        onChange={(e) => {
          setText(isoToDisplay(e.target.value))
          onChange(e.target.value)
        }}
      />
    </div>
  )
}

function isoToDisplay(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? ''))) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// คืน '' ถ้าไม่ครบหรือไม่มีวันนั้นจริง (เช่น 31/02)
function displayToIso(display) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(display ?? ''))
  if (!match) return ''

  const [, dd, mm, yyyy] = match
  const day = Number(dd)
  const month = Number(mm)
  const year = Number(yyyy)
  if (month < 1 || month > 12 || day < 1) return ''
  if (day > new Date(year, month, 0).getDate()) return ''

  return `${yyyy}-${mm}-${dd}`
}
