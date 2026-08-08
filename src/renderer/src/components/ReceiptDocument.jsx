import React from 'react'
import { formatBaht } from '../format.js'

// ใบเสร็จรับเงินหนึ่งใบ — เอกสารที่ยื่นให้ผู้เช่าเมื่อรับเงินสด
//
// โครงเดียวกับใบแจ้งหนี้โดยตั้งใจ (หัวหอซ้าย เลขที่/วันที่ขวา แล้วค่อยเนื้อหา แล้วช่องลงชื่อ)
// เพื่อให้ผู้เช่าที่ได้รับทั้งสองใบเห็นว่าเป็นเอกสารจากที่เดียวกัน และเราดูแลสไตล์ชุดเดียว
//
// ใบละหนึ่งหน้ากระดาษ — พิมพ์หลายใบพร้อมกันแล้วแต่ละคนได้ใบของตัวเองแยกแผ่น
export default function ReceiptDocument({ receipt }) {
  const apartment = receipt.apartment ?? {}

  return (
    <article className="receipt-doc">
      <h2 className="invoice-doc-title">ใบเสร็จรับเงิน</h2>

      <div className="invoice-doc-head">
        <div>
          <strong className="invoice-apartment">{apartment.name}</strong>
          {apartment.address && <p className="muted">{apartment.address}</p>}
          {apartment.phone && <p className="muted">โทร: {apartment.phone}</p>}
        </div>

        <dl className="invoice-doc-meta">
          <div>
            <dt>เลขที่</dt>
            <dd>{receipt.receiptNumber}</dd>
          </div>
          <div>
            <dt>วันที่</dt>
            <dd>{formatDate(receipt.paymentDate)}</dd>
          </div>
          <div>
            <dt>ห้อง</dt>
            <dd>{receipt.roomNumber ?? '-'}</dd>
          </div>
        </dl>
      </div>

      <dl className="invoice-tenant">
        <div>
          <dt>ได้รับเงินจาก</dt>
          <dd>{receipt.tenantName ?? '-'}</dd>
        </div>
        <div>
          <dt>ชำระโดย</dt>
          <dd>{receipt.paymentMethodLabel}</dd>
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
          <tr>
            {/* อ้างว่าเงินก้อนนี้เป็นค่าอะไร — ใบแจ้งหนี้เลขไหน หรือเป็นเงินก้อนของสัญญา
                (เงินประกัน/เงินล่วงหน้า) ซึ่งไม่มีใบแจ้งหนี้อยู่เบื้องหลัง */}
            <td>
              {receipt.isRefund ? 'คืนเงิน — ' : ''}
              {receipt.sourceType === 'invoice'
                ? `ชำระตาม${receipt.sourceLabel}`
                : 'เงินประกัน / เงินล่วงหน้าตามสัญญาเช่า'}
              {receipt.remark && <span className="receipt-doc-remark">{receipt.remark}</span>}
            </td>
            <td className="align-right">
              <span className={receipt.isRefund ? 'negative' : undefined}>
                {formatBaht(receipt.amountCents)}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <dl className="invoice-totals">
        <div className="invoice-total-row">
          <dt>{receipt.isRefund ? 'รวมเงินที่คืน' : 'รวมเงินที่ได้รับ'}</dt>
          <dd>{formatBaht(Math.abs(receipt.amountCents))}</dd>
        </div>
      </dl>

      <div className="invoice-payment-info">
        <div className="invoice-signature">
          <span>ผู้รับเงิน</span>
          <strong>{receipt.createdByName ?? '-'}</strong>
        </div>
      </div>
    </article>
  )
}

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}
