import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'

// จุด ⓘ ท้ายชื่อช่อง — เก็บคำอธิบายที่ "ไม่ต้องอ่านทุกครั้ง" (สูตรคิดเงิน / เหตุผล)
// ไว้ในกล่องที่เปิดเมื่อกด หน้าจอจะได้ไม่เต็มไปด้วยย่อหน้าอธิบาย
//
// 🔴 เปิด/ปิดด้วยการ "คลิก" ไม่ใช่ชี้เมาส์ — โอ๊คสั่ง 2026-09-25 หลังลองแบบชี้เมาส์สองรุ่น
// แล้วกล่องค้างไม่ยอมหาย (รุ่นแรกเปิดตามโฟกัส รุ่นสองมี fade-out รอ transitionend)
// แบบคลิกมีสถานะเดียวคือ open ปิดแล้วถอดกล่องออกทันที ไม่มีอะไรให้ค้าง
//
// กล่องวาดผ่าน portal ลง body ด้วย position: fixed — ถ้าวางไว้ในที่เดิม กรอบตารางที่
// เลื่อนแนวนอนได้ (overflow) กับหน้าต่างซ้อนจะตัดกล่องขาดครึ่ง
// fixed จึงต้องปิดเมื่อเลื่อนจอด้วย ไม่งั้นกล่องลอยค้างอยู่ที่เดิมขณะไอคอนเลื่อนไปแล้ว
//
// คำเตือนที่กันเงินผิด/ข้อมูลหาย ห้ามซ่อนไว้ในนี้ — ต้องเห็นโดยไม่ต้องกด
export default function InfoTip({ text }) {
  const id = useId()
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  function toggle(e) {
    // ไอคอนมักอยู่ใน <label> ของ checkbox — ไม่กันไว้ กดดูคำอธิบายแล้วช่องจะถูกติ๊กไปด้วย
    e.preventDefault()
    e.stopPropagation()
    if (pos) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    // ใกล้ขอบบนจอเกินไปก็ให้กล่องลงไปอยู่ใต้ไอคอนแทน
    const below = r.top < 120
    // กล่องกว้างสุด 280px วางกึ่งกลางไอคอน — ไอคอนชิดขอบจอก็เลื่อนกล่องเข้ามาไม่ให้ล้นจอ
    const x = Math.min(Math.max(r.left + r.width / 2, 152), window.innerWidth - 152)
    setPos({ x, y: below ? r.bottom + 8 : r.top - 8, below })
  }

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    // กดที่ไอคอนเองไม่นับ ให้ toggle เป็นคนปิด — ไม่งั้นปิดแล้วเปิดใหม่ทันทีในคลิกเดียว
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
            {text}
          </div>,
          document.body
        )}
    </>
  )
}
