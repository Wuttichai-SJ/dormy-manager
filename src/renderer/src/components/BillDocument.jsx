import React from 'react'
import Icon from '../Icon.jsx'
import { DEFAULT_VAT_RATE } from '../constants.js'
import { formatBaht } from '../format.js'

// ใช้ร่วมกันทั้งใบแจ้งหนี้และใบเสร็จ — onRemoveItem มีเฉพาะตอนแก้บนจอ
export default function BillDocument({ invoice, title, meta, tenants, footer, onRemoveItem }) {
  const apartment = invoice.apartment ?? {}
  // หอที่ไม่จด VAT ไม่แสดงคำว่า VAT เลย
  const showVat = invoice.isVatEnabled

  return (
    <>
      <h2 className="invoice-doc-title">{title}</h2>

      <div className="invoice-doc-head">
        <div>
          <strong className="invoice-apartment">{apartment.name}</strong>
          {apartment.address && <p className="muted">{apartment.address}</p>}
          {apartment.phone && <p className="muted">โทร: {apartment.phone}</p>}
        </div>

        <dl className="invoice-doc-meta">
          {meta.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <BillTenantInfo tenants={tenants} />

      <table className="data-table invoice-items">
        <thead>
          <tr>
            <th className="invoice-col-no">#</th>
            <th>รายการ</th>
            <th className="align-right">
              ราคาต่อหน่วย
              {showVat && <span className="invoice-col-sub">(ก่อน VAT)</span>}
            </th>
            <th className="align-right">
              ยอดเงิน
              {showVat && <span className="invoice-col-sub">(รวม VAT)</span>}
            </th>
            {/* คอลัมน์ปุ่มลบมีคลาสของตัวเอง — ไม่ใช้ :last-child */}
            {onRemoveItem && <th className="align-right invoice-col-actions" />}
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, index) => (
            <tr key={item.invoiceItemId}>
              <td className="invoice-col-no">{index + 1}</td>
              <td>{item.description}</td>
              <td className="align-right">
                {formatBaht(item.unitPriceCents)}
                {showVat && (
                  <span className="invoice-line-vat">
                    vat: {item.vatRate > 0 ? `${item.vatRate}%` : 'ไม่มี'}
                  </span>
                )}
              </td>
              <td className="align-right">
                <span className={item.totalAmountCents < 0 ? 'negative' : undefined}>
                  {formatBaht(item.totalAmountCents + item.vatAmountCents)}
                </span>
                {showVat && (
                  <span className="invoice-line-vat">
                    ยอด VAT: {item.vatAmountCents > 0 ? formatBaht(item.vatAmountCents) : '-'}
                  </span>
                )}
              </td>
              {onRemoveItem && (
                <td className="align-right invoice-col-actions">
                  <button
                    type="button"
                    className="link-btn link-danger table-action icon-only"
                    onClick={() => onRemoveItem(item)}
                    aria-label={`ลบรายการ ${item.description}`}
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="invoice-totals">
        {/* แสดงแถว VAT ตามธงของหอ ไม่ใช่ตามยอด */}
        {showVat && (
          <>
            <div>
              <dt>ยอดยกเว้นภาษี</dt>
              <dd>{formatBaht(invoice.exemptAmountCents)}</dd>
            </div>
            <div>
              <dt>ยอดก่อนภาษี</dt>
              <dd>{formatBaht(invoice.taxableAmountCents)}</dd>
            </div>
            <div>
              <dt>VAT {invoice.vatRate ?? DEFAULT_VAT_RATE}%</dt>
              <dd>{formatBaht(invoice.vatAmountCents)}</dd>
            </div>
          </>
        )}
        <div className="invoice-total-row">
          <dt>รวม</dt>
          <dd>{formatBaht(invoice.totalAmountCents)}</dd>
        </div>
      </dl>

      {footer}
    </>
  )
}

// ไม่พิมพ์เลขบัตรประชาชน
export function BillTenantInfo({ tenants }) {
  const list = tenants ?? []
  if (list.length === 0) return null

  const primary = list[0]
  const others = list.slice(1)

  return (
    <dl className="invoice-tenant">
      <div>
        <dt>ผู้เช่า</dt>
        <dd>
          {primary.fullName}
          {others.length > 0 && (
            <span className="invoice-cotenants">
              {' '}
              · ร่วมสัญญา: {others.map((t) => t.fullName).join(', ')}
            </span>
          )}
        </dd>
      </div>

      {primary.phone && (
        <div>
          <dt>เบอร์โทรศัพท์</dt>
          <dd>{primary.phone}</dd>
        </div>
      )}

      {primary.address && (
        <div className="invoice-tenant-address">
          <dt>ที่อยู่</dt>
          <dd>{primary.address}</dd>
        </div>
      )}
    </dl>
  )
}

export function BillSignature({ label = 'ลงชื่อ', name }) {
  if (!name) return null
  return (
    <div className="invoice-signature">
      <span>{label}</span>
      <strong>{name}</strong>
    </div>
  )
}
