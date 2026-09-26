import React, { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

// รายการกางลงล่างเสมอ — <select> ของระบบกางขึ้นทับหน้าจอได้
export default function SelectField({
  id,
  value,
  onChange,
  options,
  placeholder = 'เลือก',
  disabled
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const items = (options ?? []).map((option) =>
    typeof option === 'object' ? option : { value: option, label: option }
  )
  const selectedIndex = items.findIndex((item) => item.value === value)
  const selected = selectedIndex === -1 ? null : items[selectedIndex]

  // ใช้ mousedown เพื่อปิดก่อนปุ่มอื่นรับคลิก
  useEffect(() => {
    if (!open) return
    function onDocumentMouseDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    menuRef.current?.scrollIntoView({ block: 'nearest' })
    menuRef.current?.querySelector('.select-field-option.active')?.scrollIntoView({
      block: 'nearest'
    })
  }, [open, activeIndex])

  function openMenu() {
    if (disabled) return
    setActiveIndex(selectedIndex === -1 ? 0 : selectedIndex)
    setOpen(true)
  }

  function commit(index) {
    const item = items[index]
    if (!item) return
    onChange(item.value)
    setOpen(false)
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
