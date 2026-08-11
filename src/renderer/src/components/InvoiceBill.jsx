import React from 'react'
import BillDocument from './BillDocument.jsx'
import InvoicePaymentInfo from './InvoicePaymentInfo.jsx'
import { INVOICE_STATUS_LABELS } from '../constants.js'
import { formatDocumentDate } from '../format.js'

// ตัวใบแจ้งหนี้ที่ยื่นให้ผู้เช่า — หัวเรื่อง/มุมขวาบน/ท้ายบิล ประกอบไว้ครบในที่เดียว
//
// มีสองทางที่พิมพ์ใบแจ้งหนี้: เปิดทีละใบจากหน้ารายละเอียด กับพิมพ์ทีเดียวทั้งหอ
// **ทั้งสองทางต้องได้กระดาษหน้าตาเดียวกันเป๊ะ** จึงต้องเป็นคอมโพเนนต์เดียว ไม่ใช่สองชุด
// ที่ลอกกันมา (ผู้ใช้ยืนยันรูปแบบนี้ไว้แล้ว 2026-08-08 ว่า "ตรงตามที่ต้องการ" — สองชุด
// ที่ลอกกันจะเพี้ยนจากกันในการแก้ครั้งถัดไป แล้วเอกสารที่ยืนยันไว้จะเหลือแค่ทางเดียว)
//
// onRemoveItem มีเฉพาะตอนแก้บิลอยู่บนหน้าจอ — ตอนพิมพ์ไม่ส่งมา คอลัมน์ปุ่มลบจึงหายไปเอง
// qrDataUrl ส่งเข้ามาได้เมื่อโหลด QR ไว้แล้ว (ดู InvoicePaymentInfo)
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
        // เอกสารที่ยื่นให้ผู้เช่าใช้ พ.ศ. ส่วนวันที่บนหน้าจอทำงาน (ประวัติรับเงิน ฯลฯ)
        // ยังเป็น ค.ศ. — ดู formatDocumentDate ใน format.js
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
