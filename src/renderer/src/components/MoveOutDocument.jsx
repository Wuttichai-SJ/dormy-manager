import React from 'react'
import { BillSignature } from './BillDocument.jsx'
import { formatBaht, formatDocumentDate } from '../format.js'

// ใบสรุปการย้ายออก — เอกสารที่ยื่นให้ผู้เช่าตอนคืนห้อง (ต้นแบบเรียก "พิมพ์ใบสรุปการย้ายออก")
//
// **หน้าที่เดียวของเอกสารนี้คือตอบว่า "เงินหายไปไหนบ้าง"** ผู้เช่าวางเงินประกันไว้ก้อนหนึ่ง
// แล้ววันย้ายออกได้คืนไม่เท่าเดิม (หรือต้องจ่ายเพิ่ม) — ถ้าไม่มีกระดาษแจกแจง ข้อพิพาท
// จะเกิดตรงนี้เสมอ และหอไม่มีอะไรยืนยันว่าหักอะไรไปบ้างด้วยเหตุผลอะไร
//
// ไม่ได้ใช้ BillDocument เพราะนี่ไม่ใช่ใบแจ้งหนี้ (ไม่มีรายการ × ราคาต่อหน่วย ไม่มี VAT)
// แต่ใช้คลาสชุดเดียวกับเอกสารอื่น เพื่อให้กระดาษที่ออกมาหน้าตาเป็นตระกูลเดียวกัน
export default function MoveOutDocument({ termination, signedBy }) {
  const t = termination
  const apartment = t.apartment ?? {}

  // แถวบนสุดของตารางเงิน — เงินประกันที่รับมาจริง แล้วไล่หักลงมา
  const rows = [
    {
      label: t.isDepositRefundable
        ? 'เงินประกันที่คืนได้'
        : `เงินประกัน (ริบทั้งหมด — ${t.forfeitReasonLabel})`,
      amount: t.refundableDepositCents,
      strong: true
    }
  ]

  if (t.outstandingTotalCents > 0) {
    rows.push({ label: 'หัก ใบแจ้งหนี้ค้างชำระ', amount: -t.outstandingTotalCents })
  }

  // แจกแจงทีละบรรทัด ไม่ใช่ยอดรวมก้อนเดียว — "หักไป 800 บาท" ที่อธิบายไม่ได้
  // คือคำตอบที่ผู้เช่าไม่ยอมรับ
  for (const item of t.items) {
    rows.push({
      label: `${item.amountCents > 0 ? 'หัก ' : 'คืน '}${item.description} (${item.itemTypeLabel})`,
      amount: -item.amountCents
    })
  }

  return (
    <article className="move-out-doc">
      <h2 className="invoice-doc-title">ใบสรุปการย้ายออก</h2>

      <div className="invoice-doc-head">
        <div>
          <strong className="invoice-apartment">{apartment.name}</strong>
          {apartment.address && <p className="muted">{apartment.address}</p>}
          {apartment.phone && <p className="muted">โทร: {apartment.phone}</p>}
        </div>

        <dl className="invoice-doc-meta">
          <div>
            <dt>ห้อง</dt>
            <dd>{t.roomNumber}</dd>
          </div>
          <div>
            <dt>ผู้เช่า</dt>
            <dd>{t.tenantName ?? '-'}</dd>
          </div>
          <div>
            <dt>วันที่แจ้งย้ายออก</dt>
            <dd>{t.isNoticeGiven ? formatDocumentDate(t.noticeDate) : 'ไม่ได้แจ้งล่วงหน้า'}</dd>
          </div>
          <div>
            <dt>วันที่ย้ายออก</dt>
            <dd>{formatDocumentDate(t.moveOutDate)}</dd>
          </div>
        </dl>
      </div>

      {/* เงื่อนไขที่ใช้ตัดสิน — ต้องอยู่บนกระดาษด้วย ไม่ใช่แค่บนจอของเจ้าของหอ
          ผู้เช่าที่ถูกริบเงินประกันมีสิทธิ์เห็นว่าตัดสินจากตัวเลขอะไร */}
      <dl className="invoice-tenant move-out-doc-terms">
        <div>
          <dt>อยู่มาแล้ว</dt>
          <dd>
            {t.monthsStayed} เดือน
            {t.termMonths ? ` (สัญญา ${t.termMonths} เดือน)` : ' (ไม่กำหนดระยะสัญญา)'}
          </dd>
        </div>
        <div>
          <dt>แจ้งล่วงหน้า</dt>
          <dd>
            {t.isNoticeGiven ? `${t.noticeDaysGiven} วัน` : 'ไม่ได้แจ้ง'}
            {` (สัญญากำหนด ${t.requiredNoticeDays ?? 15} วัน)`}
          </dd>
        </div>
        <div>
          <dt>เงินประกันที่รับไว้</dt>
          <dd>{formatBaht(t.depositSnapshotCents)}</dd>
        </div>
      </dl>

      <table className="data-table invoice-items">
        <thead>
          <tr>
            <th>รายการ</th>
            <th className="align-right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.label}-${index}`}>
              <td>{row.label}</td>
              <td className="align-right">
                <span className={row.amount < 0 ? 'negative' : undefined}>
                  {formatBaht(row.amount)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="invoice-totals">
        <div className="invoice-total-row">
          <dt>{t.netRefundCents >= 0 ? 'คืนให้ผู้เช่า' : 'ผู้เช่าต้องชำระเพิ่ม'}</dt>
          <dd>{formatBaht(Math.abs(t.netRefundCents))}</dd>
        </div>
      </dl>

      {/* ใบเสร็จที่ออกจริงในวันนั้น — เส้นทางเงินต้องตามได้จากกระดาษใบนี้ไปถึงใบเสร็จ */}
      {t.receipts.length > 0 && (
        <table className="data-table invoice-items move-out-doc-receipts">
          <thead>
            <tr>
              <th>เลขที่ใบเสร็จ</th>
              <th>รายการ</th>
              <th className="align-right">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {t.receipts.map((receipt) => (
              <tr key={receipt.receiptNumber}>
                <td>{receipt.receiptNumber}</td>
                <td>{receipt.label}</td>
                <td className="align-right">
                  <span className={receipt.amountCents < 0 ? 'negative' : undefined}>
                    {formatBaht(receipt.amountCents)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ยังเก็บเงินส่วนต่างไม่ได้ ต้องเขียนไว้บนกระดาษ ไม่ใช่ปล่อยให้ทั้งสองฝ่าย
          เข้าใจว่าจบกันแล้ว */}
      {t.unpaidBalanceCents > 0 && (
        <p className="move-out-doc-unpaid">
          <strong>ยังค้างชำระ {formatBaht(t.unpaidBalanceCents)} บาท</strong> — ยังไม่ได้รับเงินส่วนนี้
        </p>
      )}

      {t.isManualOverride && t.overrideReason && (
        <p className="move-out-doc-note">หมายเหตุ: {t.overrideReason}</p>
      )}

      <div className="invoice-payment-info">
        <BillSignature label="ผู้รับเงิน / ผู้คืนเงิน" name={signedBy} />
      </div>
    </article>
  )
}
