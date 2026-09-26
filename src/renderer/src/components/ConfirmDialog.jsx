import React, { useState } from 'react'
import Alert from './Alert.jsx'
import Modal from './Modal.jsx'

// หน้าต่างยืนยันก่อนทำสิ่งที่ย้อนกลับไม่ได้ (ลบใบจดมิเตอร์ / ไฟล์สำรอง / งานแจ้งซ่อม)
// เดิมสามปุ่มนี้กดครั้งเดียวลบเลย — ใบจดมิเตอร์หนึ่งใบคือเลขที่จดไว้ทั้งหอทั้งเดือน
// (เจอจากรีวิวโค้ด 2026-09-25 โอ๊คสั่งแก้)
//
// ไม่ใช้ window.confirm() — กล่องของเบราว์เซอร์หน้าตาไม่เข้าชุดกับแอป และตัวอักษรไทยเล็กมาก
//
// onConfirm ต้องคืนผลจาก IPC ({ success, error }) — ล้มเหลวจะขึ้น error ในหน้าต่างนี้
// สำเร็จแล้วผู้เรียกเป็นคนปิดหน้าต่างเอง (จะได้แสดงข้อความ/โหลดรายการใหม่ตามลำดับของตัวเอง)
export default function ConfirmDialog({ title, message, confirmLabel = 'ลบ', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    setBusy(true)
    const res = await onConfirm()
    setBusy(false)
    if (res && !res.success) setError(res.error)
  }

  return (
    <Modal
      title={title}
      icon="trash"
      submitLabel={confirmLabel}
      danger
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert kind="warn">{message}</Alert>
    </Modal>
  )
}
