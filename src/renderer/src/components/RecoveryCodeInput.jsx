import React, { useRef } from 'react'

// 4 ช่อง ช่องละ 4 ตัว · ค่าที่ส่งออกไม่มีขีด
const SEG_LEN = 4
const SEG_COUNT = 4
const TOTAL = SEG_LEN * SEG_COUNT

// ตัวอักษรที่ไม่มีในรหัสสำรอง (ดู CODE_ALPHABET ใน main/auth.js)
const CONFUSABLE = /[01OIL]/

function clean(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, TOTAL)
}

export default function RecoveryCodeInput({ id, label, value, onChange, autoFocus = false }) {
  const refs = useRef([])
  const code = clean(value)
  const segments = Array.from({ length: SEG_COUNT }, (_, i) =>
    code.slice(i * SEG_LEN, (i + 1) * SEG_LEN)
  )

  function focusChar(position) {
    const clamped = Math.max(0, Math.min(position, TOTAL - 1))
    const box = refs.current[Math.floor(clamped / SEG_LEN)]
    if (!box) return
    box.focus()
    const offset = clamped % SEG_LEN
    requestAnimationFrame(() => box.setSelectionRange(offset, offset))
  }

  function writeAt(startIndex, text) {
    const typed = clean(text)
    const before = code.slice(0, startIndex)
    const after = code.slice(startIndex + typed.length)
    const next = (before + typed + after).slice(0, TOTAL)
    onChange(next)
    focusChar(before.length + typed.length)
  }

  function handleChange(index, e) {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const before = code.slice(0, index * SEG_LEN)
    const after = code.slice((index + 1) * SEG_LEN)
    const next = (before + raw + after).slice(0, TOTAL)
    onChange(next)
    focusChar(before.length + raw.length)
  }

  function handleKeyDown(index, e) {
    const start = index * SEG_LEN + e.target.selectionStart

    if (e.key === 'Backspace' && e.target.selectionStart === 0 && index > 0) {
      e.preventDefault()
      const cut = index * SEG_LEN
      onChange(code.slice(0, cut - 1) + code.slice(cut))
      focusChar(cut - 1)
      return
    }
    if (e.key === 'ArrowLeft' && e.target.selectionStart === 0 && index > 0) {
      e.preventDefault()
      focusChar(start - 1)
    }
    if (e.key === 'ArrowRight' && e.target.selectionStart === SEG_LEN && index < SEG_COUNT - 1) {
      e.preventDefault()
      focusChar(start)
    }
  }

  function handlePaste(index, e) {
    e.preventDefault()
    writeAt(index * SEG_LEN + e.target.selectionStart, e.clipboardData.getData('text'))
  }

  const hasConfusable = CONFUSABLE.test(code)

  return (
    <div className="field">
      <label htmlFor={`${id}-0`}>{label}</label>

      <div className="code-segments">
        {segments.map((segment, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="code-dash">-</span>}
            <input
              id={`${id}-${i}`}
              ref={(el) => (refs.current[i] = el)}
              className="code-segment"
              value={segment}
              onChange={(e) => handleChange(i, e)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={(e) => handlePaste(i, e)}
              onFocus={(e) => e.target.select()}
              // maxLength 5 — ให้ตัวที่ 5 ไหลไปช่องถัดไป
              maxLength={SEG_LEN + 1}
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label={`รหัสสำรองกลุ่มที่ ${i + 1} จาก ${SEG_COUNT}`}
              autoFocus={autoFocus && i === 0}
            />
          </React.Fragment>
        ))}
      </div>

      <p className="field-hint code-progress">
        <span>
          กรอกแล้ว {code.length} / {TOTAL} ตัว
        </span>
        {code.length === TOTAL && <span className="code-complete">ครบแล้ว</span>}
      </p>

      {hasConfusable && (
        <p className="field-hint code-warn">
          รหัสสำรองไม่มีตัว <b>0 1 O I L</b> — ลองดูกระดาษอีกครั้ง
        </p>
      )}
    </div>
  )
}
