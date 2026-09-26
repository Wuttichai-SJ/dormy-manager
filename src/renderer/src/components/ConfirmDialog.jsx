import React, { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from './Alert.jsx'

// หน้าต่างยืนยันก่อนลบ/ยกเลิก · title เป็นคำถามคู่กับปุ่ม · tone 'danger' | 'primary' · onConfirm คืนผลจาก IPC · โฟกัสเริ่มที่ปุ่มปิด
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'ลบ',
  busyLabel = 'กำลังลบ...',
  dismissLabel = 'ยกเลิก',
  icon = 'trash',
  tone = 'danger',
  onConfirm,
  onClose
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus()
    // capture + stopPropagation — Esc ต้องไม่ปิด Modal ข้างใต้ด้วย
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
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className={`confirm-icon confirm-icon-${tone}`} aria-hidden="true">
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
          <button type="button" className={`btn confirm-${tone}`} onClick={confirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// const [confirmDialog, ask] = useConfirm() แล้ววาง {confirmDialog} ในหน้า
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
