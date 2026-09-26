import React from 'react'
import { BillSignature } from './BillDocument.jsx'
import { formatBaht, formatDocumentDate } from '../format.js'

export default function MoveOutDocument({ termination, signedBy }) {
  const t = termination
  const apartment = t.apartment ?? {}

  // กลุ่ม 1 — เงินประกันหักค่าเสียหาย · แสดงทุกแถวแม้เป็น 0
  const depositRows = [{ label: 'เงินประกันที่รับไว้', amount: t.depositSnapshotCents }]

  for (const item of t.items.filter((i) => i.itemType === 'service')) {
    depositRows.push({ label: item.description, amount: -Math.abs(item.amountCents) })
  }

  depositRows.push({
    label: 'คงเหลือ',
    amount: t.depositBalanceCents,
    subtotal: true
  })

  if (t.excessDamageCents > 0) {
    depositRows.push({ label: 'ผู้เช่าจ่ายเพิ่ม', amount: t.excessDamageCents })
  }

  depositRows.push({
    label: t.forfeitedCents > 0 ? `ริบเงินประกัน — ${t.forfeitReasonLabel}` : 'ริบเงินประกัน',
    amount: -t.forfeitedCents
  })

  depositRows.push({
    label: 'คืนให้ผู้เช่า',
    amount: t.depositRefundCents,
    subtotal: true
  })

  // กลุ่ม 2 — ชำระแยก ไม่แตะเงินประกัน
  const chargeRows = t.items
    .filter((i) => i.itemType === 'meter')
    .map((item) => ({ label: item.description, amount: Math.abs(item.amountCents) }))

  // กลุ่ม 3 — หอต้องคืน แม้เงินประกันถูกริบ
  const returnRows = t.items
    .filter((i) => i.itemType === 'discount_refund')
    .map((item) => ({ label: item.description, amount: Math.abs(item.amountCents) }))

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

      <MoneyTable title="เงินประกันและค่าเสียหายห้อง" rows={depositRows} />

      {chargeRows.length > 0 && (
        <MoneyTable
          title="ค่าใช้จ่ายที่ต้องชำระแยก (ไม่หักจากเงินประกัน)"
          rows={chargeRows}
        />
      )}

      {returnRows.length > 0 && <MoneyTable title="เงินที่หอพักคืนให้" rows={returnRows} />}

      {t.outstandingTotalCents > 0 && (
        <p className="move-out-doc-unpaid">
          <strong>ใบแจ้งหนี้ค้างชำระ {formatBaht(t.outstandingTotalCents)} บาท</strong> —
          ยังต้องชำระ ไม่ได้หักจากเงินประกัน
        </p>
      )}

      <dl className="invoice-totals">
        {t.tenantOwesCents > 0 && (
          <div>
            <dt>รวมที่ผู้เช่าต้องชำระ</dt>
            <dd>{formatBaht(t.tenantOwesCents)}</dd>
          </div>
        )}
        {t.buildingReturnsCents > 0 && (
          <div>
            <dt>รวมที่หอพักคืนให้</dt>
            <dd>{formatBaht(t.buildingReturnsCents)}</dd>
          </div>
        )}
        <div className="invoice-total-row">
          <dt>{t.netRefundCents >= 0 ? 'คืนให้ผู้เช่า' : 'ผู้เช่าต้องชำระเพิ่ม'}</dt>
          <dd>{formatBaht(Math.abs(t.netRefundCents))}</dd>
        </div>
      </dl>

      {(t.receipts ?? []).length > 0 && (
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

      {t.unpaidBalanceCents > 0 && (
        <p className="move-out-doc-unpaid">
          <strong>ยังค้างชำระ {formatBaht(t.unpaidBalanceCents)} บาท</strong> — ยังไม่ได้รับเงินส่วนนี้
        </p>
      )}

      {/* ใบที่คำนวณด้วยสูตรรุ่นเก่า — แจ้งบนกระดาษว่ายอดไม่ตรง */}
      {t.hasNetRefundMismatch && (
        <p className="move-out-doc-note">
          หมายเหตุ: ยอดสุทธิของใบนี้เป็นยอดที่บันทึกไว้ ณ วันย้ายออก ตามกติกาที่ใช้อยู่ในวันนั้น ·
          คิดด้วยกติกาปัจจุบันจะได้{' '}
          {t.recomputedNetRefundCents >= 0 ? 'คืนให้ผู้เช่า ' : 'ผู้เช่าต้องชำระเพิ่ม '}
          {formatBaht(Math.abs(t.recomputedNetRefundCents))} บาท
        </p>
      )}

      {/* ยังไม่ยืนยัน = ใบตัวอย่าง */}
      {t.isDraft && <p className="move-out-doc-note">** เอกสารตัวอย่าง ยังไม่ได้บันทึกการย้ายออก **</p>}

      {t.isManualOverride && t.overrideReason && (
        <p className="move-out-doc-note">หมายเหตุ: {t.overrideReason}</p>
      )}

      <div className="invoice-payment-info">
        <BillSignature label="ผู้รับเงิน / ผู้คืนเงิน" name={signedBy} />
      </div>
    </article>
  )
}

function MoneyTable({ title, rows }) {
  return (
    <>
      <h3 className="move-out-doc-group">{title}</h3>
      <table className="data-table invoice-items">
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.label}-${index}`} className={row.subtotal ? 'move-out-doc-sub' : undefined}>
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
    </>
  )
}
