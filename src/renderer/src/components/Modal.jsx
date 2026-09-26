import React, { useEffect } from 'react'
import Icon from '../Icon.jsx'
import Alert from './Alert.jsx'

// หน้าต่างซ้อน — โครงตามต้นแบบ: หัวเรื่อง (มีไอคอนนำได้) + กากบาทปิดมุมขวา,
// เนื้อหาตรงกลาง, แถบล่างสีเทาอ่อนที่มีปุ่ม "ปิด" (ขาวมีขอบ) และ "บันทึก" (น้ำตาล)
//
// ต้นแบบใช้หน้าต่างซ้อนกับงานที่ "สั่งทีเดียวหลายห้อง" (ระบุค่าห้อง / ระบุค่าบริการ /
// ระบุการคิดค่าน้ำ-ค่าไฟ) เพราะฟอร์มพวกนี้ต้องรู้ก่อนว่าเลือกห้องไว้กี่ห้อง ถ้าวางไว้
// ในหน้าตลอดเวลาจะกินที่และชวนกรอกทั้งที่ยังไม่ได้เลือกอะไร
// wide = หน้าต่างกว้างเกือบเต็มจอ สำหรับเนื้อหาที่ต้องการพื้นที่จริงๆ (ตัวอย่างก่อนพิมพ์)
export default function Modal({
  title,
  icon,
  onClose,
  onSubmit,
  submitLabel = 'บันทึก',
  busy,
  wide,
  error,
  danger,
  children
}) {
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
        className={'modal' + (wide ? ' modal-wide' : '')}
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
          {/* error ของการกดบันทึกต้องขึ้นในหน้าต่างนี้ ตรงหน้าคนกรอก — เดิมหลายหน้าต่างส่ง error
              ออกไปขึ้นที่หน้าข้างหลัง ซึ่งถูกฉากมืดบังอยู่ มองไม่เห็น (โอ๊คเจอที่แก้ไขผู้ใช้ 2026-09-25) */}
          <div className="modal-body">
            <Alert>{error}</Alert>
            {children}
          </div>

          <footer className="modal-foot">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              ปิด
            </button>
            {/* danger = ปุ่มยืนยันสีแดง ใช้กับการลบที่ย้อนกลับไม่ได้ (ConfirmDialog) */}
            <button type="submit" className={danger ? 'btn btn-danger' : 'btn'} disabled={busy}>
              {busy ? 'กำลังบันทึก...' : submitLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
