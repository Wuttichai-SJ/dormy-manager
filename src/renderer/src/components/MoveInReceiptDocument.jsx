import React from 'react'
import { BillSignature } from './BillDocument.jsx'
import { formatBaht, formatDocumentDate } from '../format.js'

// ใบรับเงินแรกเข้า — กระดาษใบเดียวที่รวมเงินทุกก้อนตอนผู้เช่าย้ายเข้า
//
// **ทำไมต้องมี:** ตอนทำสัญญาระบบออกใบเสร็จแยกก้อนละใบ (เงินจอง / เงินประกัน /
// ค่าเช่าเดือนแรก) ซึ่งถูกต้องในแง่บัญชี แต่ผู้เช่าได้กระดาษสามใบที่หน้าตาเหมือนกัน
// ต่างกันแค่จำนวนเงิน อ่านแล้วไม่รู้ว่าจ่ายอะไรไปบ้างและรวมเท่าไหร่
//
// 🔴 **เอกสารนี้ไม่ได้แทนใบเสร็จ** — ใบเสร็จแต่ละก้อนยังมีอยู่และยังพิมพ์แยกได้
// ตารางข้างล่างจึงมีคอลัมน์ "เลขที่ใบเสร็จ" เพื่อให้ตามเส้นทางเงินจากกระดาษใบนี้
// กลับไปหาใบเสร็จตัวจริงได้ (หลักเดียวกับตารางใบเสร็จในใบสรุปการย้ายออก)
//
// **ทำไมไม่ยุบเป็นใบเสร็จใบเดียวเลขเดียว:** เงินจองรับไว้คนละวันกับวันทำสัญญาได้
// (ผู้เช่าวางเงินจอง 01/03 เข้าอยู่ 25/05) ถ้ายุบเป็นใบเดียวต้องเลือกวันที่เดียว
// แล้วรายรับของเดือนที่รับเงินจองจะหายไปจากรายงาน · และระบบติดตามเงินประกันด้วยการ
// รวมยอด purpose='deposit' ซึ่งยุบแล้วแยกไม่ออก
//
// **ดึงใบเสร็จสดทุกครั้งที่พิมพ์ ไม่ได้ล็อกไว้ตอนทำสัญญา** — พิมพ์ตอนเซ็นสัญญาได้
// 3 บรรทัด พิมพ์อีกทีหลังเก็บเงินประกันส่วนที่ค้างครบแล้วได้ 4 บรรทัด ตรงกับความจริงเสมอ
//
// ไม่ได้ใช้ BillDocument เพราะนี่ไม่ใช่ใบแจ้งหนี้ (ไม่มีราคาต่อหน่วย ไม่มี VAT)
// แต่ใช้คลาสชุดเดียวกับเอกสารอื่นให้กระดาษที่ออกมาเป็นตระกูลเดียวกัน
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

  // วันที่ต่างกันได้ในเอกสารใบเดียว — เงินจองมักรับไว้ก่อนวันทำสัญญา จึงต้องมีคอลัมน์
  // วันที่รายบรรทัด ไม่ใช่เขียนวันเดียวไว้ที่หัวแล้วเหมาว่าทุกก้อนรับวันนั้น
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
          <div>
            <dt>จำนวนใบเสร็จ</dt>
            <dd>{rows.length} ใบ</dd>
          </div>
        </dl>
      </div>

      <dl className="invoice-tenant">
        <div>
          <dt>ผู้เช่า</dt>
          <dd>{tenantName ?? '-'}</dd>
        </div>
      </dl>

      {/* คอลัมน์วันที่ขึ้นเฉพาะตอนที่มีก้อนที่รับคนละวันกับวันทำสัญญา — ถ้าจ่ายครบวันเดียว
          (ซึ่งเป็นเคสปกติ) การมีคอลัมน์วันที่ซ้ำกันทุกบรรทัดรกเปล่าๆ */}
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
              {/* remark คือข้อความที่บันทึกไว้ตอนรับเงินจริง บอกชัดว่าเป็นเงินก้อนไหน */}
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

      {/* 🔴 เงินประกันที่ยังเก็บไม่ครบต้องอยู่บนกระดาษ ไม่ใช่รู้กันแค่บนจอของเจ้าของหอ
          ผู้เช่าที่ถือใบนี้ต้องเห็นว่ายังค้างอยู่เท่าไหร่ ไม่ใช่เห็นแค่ยอดที่จ่ายไปแล้ว
          แล้วเข้าใจว่าจบกันแล้ว (หลักเดียวกับบรรทัด "ยังค้างชำระ" ในใบสรุปย้ายออก) */}
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
