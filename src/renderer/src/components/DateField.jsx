import React, { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

// ช่องกรอกวันที่แบบ วว/ดด/ปปปป
//
// ทำไมไม่ใช้ <input type="date"> เปล่าๆ: Chromium เลือกรูปแบบที่ "แสดง" จากภาษาของตัว
// เบราว์เซอร์เอง ไม่ใช่จากแอป เครื่องที่ตั้งเป็นอังกฤษ-อเมริกันจะขึ้น mm/dd/yyyy
// ซึ่งคนไทยอ่านสลับวันกับเดือนได้ทันที (03/08 = 3 ส.ค. หรือ 8 มี.ค.?) และ attribute lang
// ก็สั่งมันไม่ได้ จะแก้ด้วยการตั้ง locale ของ Electron ก็ได้ผลข้างเคียงทั้งแอป
// แถมเป็นพฤติกรรมของแพลตฟอร์มที่อาจเปลี่ยนได้ในอีก 20 ปี
//
// ที่นี่จึงคุมการแสดงผลเอง 100%: ช่องข้อความที่พิมพ์ วว/ดด/ปปปป และแปลงเป็น 'YYYY-MM-DD'
// (รูปแบบเดียวที่ฐานข้อมูลเก็บ) ให้เอง ส่วนปุ่มปฏิทินยังเรียกตัวเลือกวันที่ของระบบมาใช้
// เพื่อไม่ต้องเขียนปฏิทินเองทั้งอัน
export default function DateField({ id, value, onChange, disabled }) {
  const [text, setText] = useState(() => isoToDisplay(value))
  const pickerRef = useRef(null)

  // ค่าจากข้างนอกเปลี่ยน (โหลดข้อมูลมาใส่ฟอร์ม / กดล้างฟอร์ม) ต้องตามให้ทัน
  // แต่ห้ามทับข้อความที่ผู้ใช้กำลังพิมพ์ค้างอยู่ถ้ามันแปลงแล้วได้ค่าเดียวกัน
  useEffect(() => {
    if (displayToIso(text) !== value) setText(isoToDisplay(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function onType(raw) {
    // รับเฉพาะตัวเลข แล้วใส่ทับ / ให้เอง — ผู้ใช้ไม่ต้องพิมพ์ขีดคั่นเอง
    // และห้ามพิมพ์ตัวอักษรอื่นปนลงไปได้ตั้งแต่แรก
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    let next = digits
    if (digits.length > 4) next = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
    else if (digits.length > 2) next = `${digits.slice(0, 2)}/${digits.slice(2)}`

    setText(next)
    // กรอกยังไม่ครบ = ยังไม่มีวันที่ ส่ง '' ออกไปให้ผู้เรียกรู้ว่าค่ายังไม่พร้อมใช้
    onChange(displayToIso(next))
  }

  function openPicker() {
    const el = pickerRef.current
    if (!el) return
    // showPicker() มีใน Chromium 99+ (Electron 33 = Chromium 130) แต่โยน error ได้
    // ถ้าถูกเรียกนอกการกดของผู้ใช้ — ล้มแล้วไม่ต้องทำอะไร ผู้ใช้ยังพิมพ์เองได้อยู่
    try {
      el.showPicker()
    } catch {
      /* ไม่มีตัวเลือกวันที่ให้ใช้ ก็พิมพ์เอาได้ */
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

      {/* ตัวเลือกวันที่ของระบบ ซ่อนไว้หลังปุ่มปฏิทิน — ไม่ให้ผู้ใช้เห็นข้อความในนี้
          เพราะรูปแบบที่มันแสดงคือปัญหาที่คอมโพเนนต์นี้ตั้งใจแก้ */}
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

// 'YYYY-MM-DD' -> 'DD/MM/YYYY'
function isoToDisplay(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? ''))) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// 'DD/MM/YYYY' -> 'YYYY-MM-DD' คืน '' ถ้ายังไม่ครบหรือไม่ใช่วันที่ที่มีอยู่จริง
//
// ต้องเช็คว่าวันมีอยู่จริงด้วย ไม่ใช่แค่ตัวเลขอยู่ในช่วง — 31/02 ผ่านการเช็คช่วงได้
// แล้วจะถูกส่งเข้าฐานข้อมูลเป็นวันที่ที่ไม่มีอยู่บนปฏิทิน
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
