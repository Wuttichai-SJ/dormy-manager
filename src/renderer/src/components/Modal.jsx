import React, { useEffect } from 'react'
import Icon from '../Icon.jsx'

// หน้าต่างซ้อน — โครงตามต้นแบบ: หัวเรื่อง (มีไอคอนนำได้) + กากบาทปิดมุมขวา,
// เนื้อหาตรงกลาง, แถบล่างสีเทาอ่อนที่มีปุ่ม "ปิด" (ขาวมีขอบ) และ "บันทึก" (น้ำตาล)
//
// ต้นแบบใช้หน้าต่างซ้อนกับงานที่ "สั่งทีเดียวหลายห้อง" (ระบุค่าห้อง / ระบุค่าบริการ /
// ระบุการคิดค่าน้ำ-ค่าไฟ) เพราะฟอร์มพวกนี้ต้องรู้ก่อนว่าเลือกห้องไว้กี่ห้อง ถ้าวางไว้
// ในหน้าตลอดเวลาจะกินที่และชวนกรอกทั้งที่ยังไม่ได้เลือกอะไร
export default function Modal({ title, icon, onClose, onSubmit, submitLabel = 'บันทึก', busy, children }) {
  // Esc ปิดได้ — ปุ่มกากบาทกับปุ่ม "ปิด" ทำงานเดียวกัน
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // คลิกพื้นหลังมืดเพื่อปิด แต่คลิกในกล่องต้องไม่ทะลุไปโดน (stopPropagation)
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>
            {icon && <Icon name={icon} />}
            <span>{title}</span>
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="ปิด">
            <Icon name="close" />
          </button>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <div className="modal-body">{children}</div>

          <footer className="modal-foot">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              ปิด
            </button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'กำลังบันทึก...' : submitLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
