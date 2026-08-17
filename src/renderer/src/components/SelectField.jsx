import React, { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

// ช่องเลือกจากรายการ ที่ **กางลงล่างเสมอ**
//
// ทำไมไม่ใช้ <select> เปล่าๆ: รายการที่กางออกของ <select> ไม่ใช่ HTML แต่เป็นหน้าต่าง
// ของระบบปฏิบัติการ Chromium เป็นคนเลือกให้เองว่าจะกางขึ้นหรือลง โดยดูว่าใต้ช่องมีที่ว่าง
// พอไหม — CSS สั่งไม่ได้เลยแม้แต่นิดเดียว
//
// รายการธนาคารมี 18 รายการ (สูงราว 660px) ซึ่งไม่มีวันพอใต้ช่องในหน้าต่างสูง 800px
// มันจึงกางขึ้น **ทับหัวข้อและปิดตัวช่วยตั้งค่าทั้งหน้า** ทำให้ไม่รู้ว่ากำลังกรอกอะไรอยู่
// (ผู้ใช้เจอเองตอนทดสอบ .exe 2026-08-17)
//
// ที่นี่จึงวาดรายการเป็น HTML ปกติแล้วคุมตำแหน่งเอง: กางลงล่างท่าเดียว จำกัดความสูง
// แล้วเลื่อนในตัวเอง และถ้าที่ว่างใต้ช่องไม่พอ ให้ **เลื่อนหน้าจอลงมาหารายการ**
// แทนการพลิกทิศ — เหตุผลเดียวกับ DateField: พฤติกรรมที่แพลตฟอร์มไม่ให้เราคุม
// และเปลี่ยนได้เองในอีกยี่สิบปี ต้องเอามาไว้ในมือเรา
export default function SelectField({
  id,
  value,
  onChange,
  options,
  placeholder = 'เลือก',
  disabled
}) {
  const [open, setOpen] = useState(false)
  // แถวที่ไฮไลต์อยู่จากการกดลูกศร — คนละเรื่องกับแถวที่ถูกเลือกไว้จริง
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  // รับได้ทั้งอาร์เรย์ของข้อความ และของ { value, label } — หน้าที่มีอยู่ส่งมาเป็นข้อความล้วน
  const items = (options ?? []).map((option) =>
    typeof option === 'object' ? option : { value: option, label: option }
  )
  const selectedIndex = items.findIndex((item) => item.value === value)
  const selected = selectedIndex === -1 ? null : items[selectedIndex]

  // กดที่อื่นบนหน้าจอ = ปิดรายการ · ใช้ mousedown ไม่ใช่ click เพราะต้องปิดให้ทัน
  // ก่อนที่ปุ่มอื่นจะได้รับการกด ไม่งั้นรายการจะยังคาจออยู่ตอนหน้าเปลี่ยนไปแล้ว
  useEffect(() => {
    if (!open) return
    function onDocumentMouseDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }, [open])

  // เปิดแล้วต้องเห็นรายการทั้งกล่อง — ถ้าที่ว่างใต้ช่องไม่พอ ให้เลื่อนหน้าจอลงมาให้
  // (`block: 'nearest'` = เลื่อนเท่าที่จำเป็น ไม่กระโดดจนคนหาที่เดิมไม่เจอ)
  useEffect(() => {
    if (!open) return
    menuRef.current?.scrollIntoView({ block: 'nearest' })
    menuRef.current?.querySelector('.select-field-option.active')?.scrollIntoView({
      block: 'nearest'
    })
  }, [open, activeIndex])

  function openMenu() {
    if (disabled) return
    // เปิดมาให้ยืนอยู่ที่ค่าที่เลือกไว้ ไม่ใช่แถวแรกเสมอ — กดลูกศรลงจะได้ไปตัวถัดไปของ
    // ค่าปัจจุบัน ไม่ใช่ย้อนกลับไปต้นรายการ
    setActiveIndex(selectedIndex === -1 ? 0 : selectedIndex)
    setOpen(true)
  }

  function commit(index) {
    const item = items[index]
    if (!item) return
    onChange(item.value)
    setOpen(false)
    // คืนโฟกัสให้ปุ่ม ไม่งั้นกด Tab ต่อจะเริ่มจากต้นฟอร์มใหม่
    buttonRef.current?.focus()
  }

  function onKeyDown(event) {
    if (disabled) return

    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }

    // Tab ออกจากช่อง = ปิดรายการ แต่ไม่ขัดการย้ายโฟกัส
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }

    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(items.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(0, index - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(items.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      commit(activeIndex)
    }
  }

  return (
    <div className="select-field" ref={wrapRef}>
      <button
        id={id}
        ref={buttonRef}
        type="button"
        className={'select-field-btn' + (selected ? '' : ' placeholder')}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="select-field-value">{selected ? selected.label : placeholder}</span>
        <Icon name="chevronDown" />
      </button>

      {open && (
        <div className="select-field-menu" ref={menuRef} role="listbox">
          {items.length === 0 ? (
            <p className="select-field-empty">ไม่มีตัวเลือก</p>
          ) : (
            items.map((item, index) => (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={item.value === value}
                className={
                  'select-field-option' +
                  (index === activeIndex ? ' active' : '') +
                  (item.value === value ? ' selected' : '')
                }
                // ไฮไลต์ตามเมาส์ด้วย ไม่งั้นแถวที่ลูกศรค้างไว้กับแถวที่เมาส์ชี้จะเป็นสองแถว
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
