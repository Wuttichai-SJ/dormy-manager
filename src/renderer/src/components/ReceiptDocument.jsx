import React from 'react'
import { formatPhone } from './TenantDialog.jsx'
import { formatBaht, formatDocumentDate } from '../format.js'

const quantity = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const reading = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })

const THAI_SHORT_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// บิลเก่าเก็บ "(เดือน 09-2569)" — แสดงเป็น "(ก.ย. 2569)" ให้ตรงกับบิลใหม่
function shortMonthLabel(text) {
  return String(text ?? '').replace(/\(เดือน (\d{2})-(\d{4})\)/g, (match, month, year) => {
    const name = THAI_SHORT_MONTHS[Number(month) - 1]
    return name ? `(${name} ${year})` : match
  })
}

// ขาวดำ ครึ่ง A4 — ผู้รับเงินเซ็นมือ
export default function ReceiptDocument({ receipt, invoice }) {
  const apartment = receipt.apartment ?? invoice?.apartment ?? {}
  const amountCents = Math.abs(receipt.amountCents)
  const rows = invoice ? invoiceRows(invoice) : [contractRow(receipt, amountCents)]
  const totalCents = invoice ? invoice.totalAmountCents : amountCents
  const showVat = Boolean(invoice?.isVatEnabled)

  const meta = [
    { label: 'เลขที่ใบเสร็จ', value: receipt.receiptNumber },
    { label: 'วันที่', value: formatDocumentDate(receipt.paymentDate) },
    { label: 'ออกโดย', value: receipt.createdByName ?? '-' },
    { label: 'ชำระโดย', value: receipt.paymentMethodLabel }
  ]
  const footRows = (showVat ? 2 : 0) + 1 + (invoice && amountCents !== totalCents ? 1 : 0)
  const size = printSize(rows.length + footRows)

  return (
    <article className={`receipt-doc ${size}`}>
      <h2 className="rc-title">ใบเสร็จรับเงิน</h2>

      {apartment.name && (
        <p className="rc-apartment">
          <strong>{apartment.name}</strong>
          {apartment.address && ` · ${apartment.address}`}
          {apartment.phone && ` · โทร ${apartment.phone}`}
        </p>
      )}

      <div className="rc-head">
        <dl className="rc-info">
          <InfoRow label="ชื่อ" value={receipt.tenantName ? `คุณ ${receipt.tenantName}` : '-'} />
          <InfoRow label="ที่อยู่" value={receipt.tenantAddress || '-'} />
          <InfoRow label="โทรศัพท์" value={receipt.tenantPhone ? formatPhone(receipt.tenantPhone) : '-'} />
          <InfoRow label="หมายเลขห้อง" value={receipt.roomNumber ?? '-'} />
        </dl>
        <dl className="rc-info rc-meta">
          {meta.map((row) => (
            <InfoRow key={row.label} label={row.label} value={row.value} />
          ))}
        </dl>
      </div>

      <table className="rc-items">
        <thead>
          <tr>
            <th>รายการ</th>
            <th className="align-right">จำนวน</th>
            <th className="align-right">รวม</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td className="align-right">{row.quantity ?? ''}</td>
              <td className="align-right">{row.amountCents == null ? '' : formatBaht(row.amountCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {showVat && (
            <tr>
              <td colSpan={2}>รวมก่อน VAT</td>
              <td className="align-right">{formatBaht(totalCents - invoice.vatAmountCents)}</td>
            </tr>
          )}
          {showVat && (
            <tr>
              <td colSpan={2}>VAT {invoice.vatRate}%</td>
              <td className="align-right">{formatBaht(invoice.vatAmountCents)}</td>
            </tr>
          )}
          <tr className="rc-total">
            <td colSpan={2}>{receipt.isRefund ? 'รวมเงินที่คืน' : 'รวมทั้งหมด'}</td>
            <td className="align-right">{formatBaht(totalCents)}</td>
          </tr>
          {/* จ่ายไม่เต็มบิล / จ่ายหลายครั้ง */}
          {invoice && amountCents !== totalCents && (
            <tr className="rc-total">
              <td colSpan={2}>รับชำระครั้งนี้</td>
              <td className="align-right">{formatBaht(amountCents)}</td>
            </tr>
          )}
        </tfoot>
      </table>

      <div className="rc-foot">
        <div className="rc-note">
          <span className="rc-note-label">หมายเหตุ</span>
        </div>
        <div className="rc-line rc-sign">
          <span>ผู้รับเงิน</span>
          <span className="rc-blank" />
        </div>
      </div>
    </article>
  )
}

function InfoRow({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

// ครึ่ง A4 สูงคงที่ — แถวเยอะเกินจะย่อตัวอักษรลงเป็นขั้น (ตัวเลขประมาณจากความสูงจริงตอนพิมพ์)
function printSize(tableRows) {
  if (tableRows <= 8) return 'rc-size-l'
  if (tableRows <= 11) return 'rc-size-m'
  return 'rc-size-s'
}

// ค่าน้ำ/ไฟที่มีเลขมิเตอร์ = แถวเดียว: รายการ + หน่วยที่ใช้ · จำนวน = เลขเก่า - เลขใหม่
function invoiceRows(invoice) {
  const rows = []
  for (const item of invoice.items) {
    const side = item.itemType === 'water' ? 'water' : item.itemType === 'electricity' ? 'electric' : null
    const meter = side ? invoice.meterReadings?.[side] : null
    // ใบที่มี VAT แสดงยอดก่อน VAT แล้วบวก VAT ท้ายตาราง
    const amountCents = invoice.isVatEnabled ? item.totalAmountCents : item.totalAmountCents + item.vatAmountCents

    if (!meter) {
      rows.push({
        key: item.invoiceItemId,
        label: shortMonthLabel(item.description),
        quantity: quantity.format(item.quantity),
        amountCents
      })
      continue
    }

    rows.push({
      key: item.invoiceItemId,
      label: `${shortMonthLabel(item.description.split(' : ')[0])} · เปลี่ยนแปลง ${reading.format(meter.units)} หน่วย`,
      quantity: `${reading.format(meter.previous)} - ${reading.format(meter.current)}`,
      amountCents
    })
  }
  return rows
}

// ใบเสร็จของสัญญา — ชื่อรายการมาจาก remark ที่บันทึกตอนรับเงิน
function contractRow(receipt, amountCents) {
  return {
    key: `contract-${receipt.paymentId}`,
    label:
      shortMonthLabel(receipt.remark?.trim()) || (receipt.isRefund ? 'คืนเงินประกันตามสัญญาเช่า' : 'เงินตามสัญญาเช่า'),
    quantity: quantity.format(1),
    amountCents
  }
}
