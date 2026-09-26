import React, { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from './Alert.jsx'

// หน้าต่างยืนยันก่อนทำสิ่งที่ย้อนกลับไม่ได้ หรือมีผลกับคนอื่น (ลบ / ยกเลิก / ปิดการใช้งาน)
// เดิมปุ่มพวกนี้กดครั้งเดียวทำเลย (เจอจากรีวิวโค้ด 2026-09-25)
//
// หน้าตาแบบกล่องยืนยันทั่วไป: ไอคอนกลางบน · หัวข้อเป็นคำถาม · ผลที่จะเกิดเป็นข้อความอ่านง่าย ·
// ปุ่มสองปุ่มกว้างเท่ากัน (เฟิสขอ 2026-09-26 — รุ่นแรกใช้กล่องเตือนสีครีม ตัวอักษรจาง อ่านยาก)
// ไม่ได้ใช้ Modal เพราะ Modal เป็นหน้าต่างฟอร์ม (หัว + แถบล่าง) ซึ่งหนักเกินไปสำหรับคำถามเดียว
//
// ถ้อยคำ (เฟิสขอให้สอดคล้องกับ flow ที่กำลังทำ):
//   title        = คำถามที่มีคำกริยาเดียวกับปุ่มยืนยัน — "ลบห้อง 101?" คู่กับปุ่ม "ลบห้อง"
//   message      = ผลที่จะเกิดขึ้นจริง บรรทัดเดียว ไม่ใช่ "แน่ใจไหม" ซ้ำ
//   dismissLabel = ปุ่มปิด ปกติ "ยกเลิก" — แต่ถ้าการกระทำเองคือ "ยกเลิก…" ต้องเปลี่ยน
//                  ไม่งั้นมีสองปุ่มที่ขึ้นต้นว่า "ยกเลิก" (เช่น ยกเลิกการจอง → "เก็บการจองไว้")
//
// ไม่ใช้ window.confirm() — กล่องของเบราว์เซอร์หน้าตาไม่เข้าชุดกับแอป และตัวอักษรไทยเล็กมาก
// เปิดมาแล้วโฟกัสอยู่ที่ปุ่มปิด — กด Enter เผลอๆ จะไม่ทำอะไร ต้องตั้งใจกดปุ่มแดงเอง
//
// onConfirm ต้องคืนผลจาก IPC ({ success, error }) — ล้มเหลวจะขึ้น error ในหน้าต่างนี้
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'ลบ',
  busyLabel = 'กำลังลบ...',
  dismissLabel = 'ยกเลิก',
  icon = 'trash',
  onConfirm,
  onClose
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus()
    // ฟังแบบ capture แล้วหยุดไว้ที่นี่ — หน้าต่างยืนยันบางอันซ้อนอยู่บน Modal (เช่นนำบริการออก)
    // ถ้าปล่อยผ่าน Esc ครั้งเดียวจะปิดทั้ง Modal ข้างใต้ไปด้วย
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (!busy) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
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
          <Icon name={icon} />
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
            {dismissLabel}
          </button>
          <button type="button" className="btn confirm-danger" onClick={confirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ใช้แทนการเขียน state ของหน้าต่างยืนยันเองทุกหน้า:
//   const [confirmDialog, ask] = useConfirm()
//   ask({ title, message, confirmLabel, onConfirm: async () => { const res = await api(); … return res } })
//   … แล้ววาง {confirmDialog} ไว้ที่ไหนก็ได้ใน JSX ของหน้านั้น
// onConfirm สำเร็จ (success ไม่เป็น false) → ปิดหน้าต่างให้เอง · ล้มเหลว → error ขึ้นในหน้าต่าง
export function useConfirm() {
  const [request, setRequest] = useState(null)
  const ask = useCallback((options) => setRequest(options), [])
  const close = useCallback(() => setRequest(null), [])

  const dialog = request && (
    <ConfirmDialog
      {...request}
      onClose={close}
      onConfirm={async () => {
        const res = await request.onConfirm()
        if (!res || res.success !== false) setRequest(null)
        return res
      }}
    />
  )
  return [dialog, ask]
}
