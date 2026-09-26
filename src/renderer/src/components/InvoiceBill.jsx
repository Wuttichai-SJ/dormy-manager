import React from 'react'
import BillDocument from './BillDocument.jsx'
import InvoicePaymentInfo from './InvoicePaymentInfo.jsx'
import { INVOICE_STATUS_LABELS } from '../constants.js'
import { formatDocumentDate } from '../format.js'

// ใช้ทั้งพิมพ์ทีละใบและพิมพ์ทั้งหอ — หน้าตาต้องเหมือนกัน
export default function InvoiceBill({ invoice, signedBy, qrDataUrl, onRemoveItem }) {
  return (
    <BillDocument
      invoice={invoice}
      title="ใบแจ้งหนี้ / Invoice"
      tenants={invoice.tenants}
      meta={[
        {
          label: 'สถานะ',
          value: (
            <span className={`invoice-status invoice-${invoice.status}`}>
              {INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
            </span>
          )
        },
        { label: 'เลขที่', value: invoice.invoiceNumber },
        { label: 'ห้อง', value: invoice.roomNumber },
        { label: 'วันที่', value: formatDocumentDate(invoice.issueDate) },
        { label: 'ครบกำหนด', value: formatDocumentDate(invoice.dueDate) }
      ]}
      onRemoveItem={onRemoveItem}
      footer={
        <InvoicePaymentInfo invoice={invoice} signedBy={signedBy} qrDataUrl={qrDataUrl} />
      }
    />
  )
}
