import React, { useState } from 'react'
import Alert from './Alert.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from './FieldError.jsx'
import Modal from './Modal.jsx'
import { formatBaht } from '../format.js'
import { cancelPayment } from '../services/paymentService.js'

// ใช้ร่วมกันทั้งหน้าใบแจ้งหนี้และรายงานใบเสร็จ · ปุ่มกดได้เมื่อกรอกเหตุผลแล้ว
export default function CancelReceiptDialog({ receipt, onClose, onCancelled }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = reason.trim().length > 0
  const { errors, formError, fromResult, clear, reset } = useFormErrors(['reason'])

  async function submit() {
    if (!ready) return
    reset()
    setBusy(true)
    const res = await cancelPayment(receipt.paymentId, reason)
    setBusy(false)
    if (!res.success) return fromResult(res)
    onCancelled(res.data)
  }

  return (
    <Modal
      title={`ยกเลิกใบเสร็จ ${receipt.receiptNumber}`}
      icon="close"
      submitLabel="ยืนยันยกเลิกใบเสร็จ"
      busy={busy || !ready}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert kind="warn">
        <strong>ไม่นับเป็นเงินที่รับแล้ว</strong> · ยอดค้างของบิลกลับมาเท่าเดิม · เลขที่{' '}
        {receipt.receiptNumber} ไม่ถูกใช้ซ้ำ
      </Alert>

      <dl className="invoice-totals delete-summary">
        <div>
          <dt>ห้อง</dt>
          <dd>{receipt.roomNumber ?? '-'}</dd>
        </div>
        <div>
          <dt>วันที่รับเงิน</dt>
          <dd>{formatDate(receipt.paymentDate)}</dd>
        </div>
        <div>
          <dt>ยอดรับเงิน</dt>
          <dd>{formatBaht(receipt.amountCents)}</dd>
        </div>
      </dl>

      <div className={fieldClass('field field-required', errors.reason)}>
        <label htmlFor="cancelReceiptReason">
          เหตุผลในการยกเลิก <span className="required">* จำเป็น</span>
        </label>
        <textarea
          id="cancelReceiptReason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            clear('reason')
          }}
          {...invalidProps('cancelReceiptReason', errors.reason)}
          placeholder="เช่น คีย์ยอดผิด / รับเงินผิดห้อง / กดรับเงินซ้ำ"
        />
        {errors.reason ? (
          <FieldError id="cancelReceiptReason-error" message={errors.reason} />
        ) : (
          !ready && <p className="field-hint">ต้องกรอกเหตุผลก่อนจึงจะยกเลิกได้</p>
        )}
      </div>
    </Modal>
  )
}

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}
