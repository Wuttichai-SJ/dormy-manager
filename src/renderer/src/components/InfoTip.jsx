import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'

// คำอธิบายที่เปิดด้วยการคลิก (ไม่ใช่ hover) · วาดผ่าน portal แบบ fixed ปิดเมื่อเลื่อนจอ · คำเตือนเรื่องเงินห้ามซ่อนในนี้
export default function InfoTip({ title, points = [] }) {
  const items = points.filter(Boolean)

  const id = useId()
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  function toggle(e) {
    // กันคลิกทะลุไปติ๊ก checkbox ใน label
    e.preventDefault()
    e.stopPropagation()
    if (pos) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    const below = r.top < 120
    const x = Math.min(Math.max(r.left + r.width / 2, 162), window.innerWidth - 162)
    setPos({ x, y: below ? r.bottom + 8 : r.top - 8, below })
  }

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const onDown = (e) => !ref.current?.contains(e.target) && close()
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [pos])

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="hint-icon"
        aria-label="คำอธิบาย"
        aria-expanded={Boolean(pos)}
        aria-describedby={pos ? id : undefined}
        onClick={toggle}
      >
        <Icon name="info" />
      </button>
      {pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className={'info-tip' + (pos.below ? ' info-tip-below' : '')}
            style={{ left: pos.x, top: pos.y }}
          >
            <strong className="info-tip-title">{title}</strong>
            {items.length > 0 && (
              <ul className="info-tip-points">
                {items.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
