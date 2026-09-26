import React from 'react'
import { BillSignature } from './BillDocument.jsx'
import { formatBaht, formatDocumentDate } from '../format.js'

// ใบรวมเงินตอนย้ายเข้า — ไม่ได้แทนใบเสร็จ (มีเลขที่ใบเสร็จอ้างอิง) · ดึงใบเสร็จสดทุกครั้ง
export default function MoveInReceiptDocument({
  receipts,
  apartment,
  roomNumber,
  tenantName,
  contractStartDate,
  deposit,
  signedBy
}) {
  const rows = receipts ?? []
  const totalCents = rows.reduce((sum, r) => sum + r.amountCents, 0)

  const hasMixedDates = rows.some((r) => r.paymentDate !== contractStartDate)

  return (
    <article className="move-in-doc">
      <h2 className="invoice-doc-title">ใบรับเงินแรกเข้า</h2>

      <div className="invoice-doc-head">
        <div>
          <strong className="invoice-apartment">{apartment?.name}</strong>
          {apartment?.address && <p className="muted">{apartment.address}</p>}
          {apartment?.phone && <p className="muted">โทร: {apartment.phone}</p>}
        </div>

        <dl className="invoice-doc-meta">
          <div>
            <dt>ห้อง</dt>
            <dd>{roomNumber ?? '-'}</dd>
          </div>
          <div>
            <dt>วันที่ทำสัญญา</dt>
            <dd>{formatDocumentDate(contractStartDate)}</dd>
          </div>
        </dl>
      </div>

      <dl className="invoice-tenant">
        <div>
          <dt>ผู้เช่า</dt>
          <dd>{tenantName ?? '-'}</dd>
        </div>
      </dl>

      {/* คอลัมน์วันที่แสดงเฉพาะเมื่อมีก้อนที่รับคนละวัน */}
      <table className="data-table invoice-items move-in-doc-items">
        <thead>
          <tr>
            <th>#</th>
            <th>รายการ</th>
            {hasMixedDates && <th>วันที่รับเงิน</th>}
            <th>เลขที่ใบเสร็จ</th>
            <th className="align-right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((receipt, index) => (
            <tr key={receipt.paymentId}>
              <td>{index + 1}</td>
              <td>{receipt.remark?.trim() || 'เงินตามสัญญาเช่า'}</td>
              {hasMixedDates && <td>{formatDocumentDate(receipt.paymentDate)}</td>}
              <td>{receipt.receiptNumber}</td>
              <td className="align-right">{formatBaht(receipt.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="invoice-totals">
        <div className="invoice-total-row">
          <dt>รวมเงินที่ได้รับ</dt>
          <dd>{formatBaht(totalCents)}</dd>
        </div>
      </dl>

      {/* เงินประกันค้างต้องอยู่บนกระดาษด้วย */}
      {deposit?.outstandingCents > 0 && (
        <p className="move-in-doc-unpaid">
          <strong>เงินประกันค้างอีก {formatBaht(deposit.outstandingCents)} บาท</strong> — ตกลงไว้{' '}
          {formatBaht(deposit.requiredCents)} บาท รับแล้ว {formatBaht(deposit.receivedCents)} บาท
        </p>
      )}

      <div className="invoice-payment-info">
        <BillSignature label="ผู้รับเงิน" name={signedBy} />
      </div>
    </article>
  )
}
