import React from 'react'
import BillDocument, { BillSignature } from './BillDocument.jsx'
import { formatBaht, formatDocumentDate } from '../format.js'

// หน้าตาเหมือนใบแจ้งหนี้ (BillDocument) แต่ไม่มีช่องทางชำระและ QR
export default function ReceiptDocument({ receipt, invoice }) {
  const meta = [
    { label: 'เลขที่ใบเสร็จ', value: receipt.receiptNumber },
    { label: 'วันที่รับเงิน', value: formatDocumentDate(receipt.paymentDate) },
    { label: 'ห้อง', value: receipt.roomNumber ?? '-' },
    { label: 'ชำระโดย', value: receipt.paymentMethodLabel }
  ]

  const footer = (
    <>
      <dl className="invoice-totals receipt-received">
        <div className="invoice-total-row">
          <dt>{receipt.isRefund ? 'จำนวนเงินที่คืน' : 'จำนวนเงินที่ได้รับ'}</dt>
          <dd>{formatBaht(Math.abs(receipt.amountCents))}</dd>
        </div>
      </dl>

      <div className="invoice-payment-info">
        <BillSignature label="ผู้รับเงิน" name={receipt.createdByName} />
      </div>
    </>
  )

  if (invoice) {
    return (
      <article className="receipt-doc">
        <BillDocument
          invoice={invoice}
          title="ใบเสร็จรับเงิน"
          tenants={invoice.tenants}
          meta={[...meta, { label: 'อ้างอิง', value: invoice.invoiceNumber }]}
          footer={footer}
        />
      </article>
    )
  }

  // ใบเสร็จของสัญญา — ชื่อรายการมาจาก remark ที่บันทึกตอนรับเงิน
  const standalone = {
    apartment: receipt.apartment ?? {},
    isVatEnabled: false,
    items: [
      {
        invoiceItemId: `contract-${receipt.paymentId}`,
        description:
          receipt.remark?.trim() ||
          (receipt.isRefund ? 'คืนเงินประกันตามสัญญาเช่า' : 'เงินตามสัญญาเช่า'),
        unitPriceCents: Math.abs(receipt.amountCents),
        vatRate: 0,
        vatAmountCents: 0,
        totalAmountCents: Math.abs(receipt.amountCents)
      }
    ],
    exemptAmountCents: Math.abs(receipt.amountCents),
    taxableAmountCents: 0,
    vatAmountCents: 0,
    totalAmountCents: Math.abs(receipt.amountCents)
  }

  return (
    <article className="receipt-doc">
      <BillDocument
        invoice={standalone}
        title="ใบเสร็จรับเงิน"
        tenants={receipt.tenantName ? [{ fullName: receipt.tenantName }] : []}
        meta={meta}
        footer={footer}
      />
    </article>
  )
}
