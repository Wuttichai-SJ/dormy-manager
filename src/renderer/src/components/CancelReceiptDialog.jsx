import React, { useState } from 'react'
import Alert from './Alert.jsx'
import Modal from './Modal.jsx'
import { formatBaht } from '../format.js'
import { cancelPayment } from '../services/paymentService.js'

// หน้าต่างยกเลิกใบเสร็จ — ใช้ร่วมกันทั้งหน้าใบแจ้งหนี้และรายงานใบเสร็จ
// (คีย์ผิดถูกจับได้ทั้งสองที่ ฟอร์มเดียวกันจึงไม่ควรมีสองชุดที่เพี้ยนกันทีหลัง)
//
// เหตุผลบังคับกรอก และปุ่มถูกปิดไว้จนกว่าจะพิมพ์ — แบบเดียวกับหน้าต่างลบใบแจ้งหนี้
// คนที่ตั้งใจจะยกเลิกจริงจะได้รู้ตั้งแต่เห็นหน้าต่างว่าต้องเขียนอะไรสักอย่างก่อน
export default function CancelReceiptDialog({ receipt, onClose, onCancelled, onError }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = reason.trim().length > 0

  async function submit() {
    if (!ready) return
    onError('')
    setBusy(true)
    const res = await cancelPayment(receipt.paymentId, reason)
    setBusy(false)
    if (!res.success) return onError(res.error)
    onCancelled(res.data)
  }

  return (
    <Modal
      title={`ยกเลิกใบเสร็จ ${receipt.receiptNumber}`}
      icon="close"
      submitLabel="ยืนยันยกเลิกใบเสร็จ"
      busy={busy || !ready}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert kind="warn">
        ใบเสร็จจะยังอยู่ในระบบแต่ถูกทำเครื่องหมายว่ายกเลิก และ<strong>ไม่ถูกนับเป็นเงินที่รับมา</strong>
        อีกต่อไป — ยอดค้างของบิลจะกลับมาเท่าเดิม เลขที่ {receipt.receiptNumber} จะไม่ถูกนำไปใช้ซ้ำ
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

      <div className="field field-required">
        <label htmlFor="cancelReceiptReason">
          เหตุผลในการยกเลิก <span className="required">* จำเป็น</span>
        </label>
        <textarea
          id="cancelReceiptReason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เช่น คีย์ยอดผิด / รับเงินผิดห้อง / กดรับเงินซ้ำ"
        />
        {!ready && <p className="field-hint">ต้องกรอกเหตุผลก่อนจึงจะยกเลิกได้</p>}
      </div>
    </Modal>
  )
}

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}
