import React from 'react'
import BillDocument, { BillSignature } from './BillDocument.jsx'
import { formatBaht } from '../format.js'

// ใบเสร็จรับเงินหนึ่งใบ — **หน้าตาเดียวกับใบแจ้งหนี้ทุกอย่าง** (ผู้ใช้สั่ง 2026-08-09)
// ต่างกันแค่:
//   หัวเอกสารเป็น "ใบเสร็จรับเงิน"
//   มุมขวาบนเป็นเลขที่ใบเสร็จ/วันที่รับเงิน แทนเลขที่บิล/ครบกำหนด
//   **ไม่มีช่องทางการชำระเงินและไม่มี QR** — เงินรับไปแล้ว ไม่ต้องบอกวิธีจ่ายอีก
//   ท้ายเอกสารเป็นช่อง "ผู้รับเงิน"
//
// ตัวเอกสารมาจาก BillDocument ตัวเดียวกับใบแจ้งหนี้ ไม่ได้ลอกมาวางใหม่ — สองไฟล์ที่
// ลอกกันจะค่อยๆ เพี้ยนจากกันทุกครั้งที่แก้ข้างเดียว
export default function ReceiptDocument({ receipt, invoice }) {
  const meta = [
    { label: 'เลขที่ใบเสร็จ', value: receipt.receiptNumber },
    { label: 'วันที่รับเงิน', value: formatDate(receipt.paymentDate) },
    { label: 'ห้อง', value: receipt.roomNumber ?? '-' },
    { label: 'ชำระโดย', value: receipt.paymentMethodLabel }
  ]

  const footer = (
    <>
      {/* ยอดที่รับจริงในครั้งนี้ — ต่างจาก "รวม" ของบิลได้ เพราะจ่ายบางส่วนก็ได้
          ผู้เช่าต้องเห็นว่าใบนี้เป็นหลักฐานว่าจ่ายไปเท่าไหร่ ไม่ใช่ว่าบิลเท่าไหร่ */}
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

  // ใบเสร็จของบิล — แสดงรายการของบิลใบนั้นเหมือนใบแจ้งหนี้เป๊ะ
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

  // ใบเสร็จของสัญญา (เงินประกัน/เงินล่วงหน้า) — ไม่มีบิลอยู่เบื้องหลัง จึงประกอบเอกสาร
  // ที่มีรายการเดียวขึ้นมาเอง แล้วส่งเข้า BillDocument ตัวเดิม หน้าตาจึงยังเหมือนกัน
  const standalone = {
    apartment: receipt.apartment ?? {},
    isVatEnabled: false,
    items: [
      {
        invoiceItemId: `contract-${receipt.paymentId}`,
        description: receipt.isRefund
          ? 'คืนเงินประกันตามสัญญาเช่า'
          : 'เงินประกัน / เงินล่วงหน้าตามสัญญาเช่า',
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

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}
