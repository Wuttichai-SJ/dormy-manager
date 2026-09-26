import React, { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from './Alert.jsx'

// หน้าต่างยืนยันก่อนทำสิ่งที่ย้อนกลับไม่ได้ (ลบใบจดมิเตอร์ / ไฟล์สำรอง / งานแจ้งซ่อม)
// เดิมสามปุ่มนี้กดครั้งเดียวลบเลย — ใบจดมิเตอร์หนึ่งใบคือเลขที่จดไว้ทั้งหอทั้งเดือน
// (เจอจากรีวิวโค้ด 2026-09-25 โอ๊คสั่งแก้)
//
// หน้าตาแบบกล่องยืนยันทั่วไป: ไอคอนกลางบน · หัวข้อตัวหนา · ข้อความอ่านง่ายบนพื้นขาว ·
// ปุ่มสองปุ่มกว้างเท่ากัน (เฟิสขอ 2026-09-26 — รุ่นแรกใช้กล่องเตือนสีครีม ตัวอักษรจาง อ่านยาก)
// ไม่ได้ใช้ Modal เพราะ Modal เป็นหน้าต่างฟอร์ม (หัว + แถบล่าง) ซึ่งหนักเกินไปสำหรับคำถามเดียว
//
// ไม่ใช้ window.confirm() — กล่องของเบราว์เซอร์หน้าตาไม่เข้าชุดกับแอป และตัวอักษรไทยเล็กมาก
//
// เปิดมาแล้วโฟกัสอยู่ที่ "ยกเลิก" — กด Enter เผลอๆ จะไม่ลบ ต้องตั้งใจกดปุ่มลบเอง
//
// onConfirm ต้องคืนผลจาก IPC ({ success, error }) — ล้มเหลวจะขึ้น error ในหน้าต่างนี้
// สำเร็จแล้วผู้เรียกเป็นคนปิดหน้าต่างเอง (จะได้แสดงข้อความ/โหลดรายการใหม่ตามลำดับของตัวเอง)
export default function ConfirmDialog({ title, message, confirmLabel = 'ลบ', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function confirm() {
    setError('')
    setBusy(true)
    const res = await onConfirm()
    setBusy(false)
    if (res && !res.success) setError(res.error)
  }

  return (
    // คลิกพื้นหลังมืดเพื่อปิด แต่คลิกในกล่องต้องไม่ทะลุไปโดน (stopPropagation)
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="confirm-icon" aria-hidden="true">
          <Icon name="trash" />
        </span>
        <h2 id="confirm-title" className="confirm-title">
          {title}
        </h2>
        <p id="confirm-message" className="confirm-message">
          {message}
        </p>

        <Alert>{error}</Alert>

        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            disabled={busy}
          >
            ยกเลิก
          </button>
          <button type="button" className="btn confirm-danger" onClick={confirm} disabled={busy}>
            {busy ? 'กำลังลบ...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
