import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import DateField from '../components/DateField.jsx'
import { showToast } from '../components/Toast.jsx'
import { INVOICE_STATUS_LABELS, PAYMENT_METHODS, VAT_RATE } from '../constants.js'
import { centsToInput, formatBaht, formatDocumentDate } from '../format.js'
import {
  addInvoiceItem,
  cancelInvoice,
  getInvoice,
  getLateFee,
  removeInvoiceItem
} from '../services/invoiceService.js'
import { listPaymentsForInvoice, receivePayment } from '../services/paymentService.js'
import CancelReceiptDialog from '../components/CancelReceiptDialog.jsx'
import PrintDialog from '../components/PrintDialog.jsx'
import BillDocument, { BillSignature } from '../components/BillDocument.jsx'
import { revealPdf, savePdf } from '../services/printService.js'
import { getImageDataUrl } from '../services/imageService.js'

// หน้าใบแจ้งหนี้ — โครงตามต้นแบบ (คู่มือ yeeraf หัวข้อ "บิลค้างชำระ"): สองคอลัมน์
// ซ้ายเป็นตัวเอกสาร ขวาเป็นยอดค้างกับการ์ดรับเงิน แล้วมี "เพิ่มรายการ" อยู่ใต้เอกสาร
//
// ต้นแบบทำเป็นหน้าต่างซ้อน แต่ที่นี่เป็นหน้าเต็ม เพราะเนื้อหายาวกว่าหน้าต่างซ้อนจะรับไหว
// (เอกสาร + ฟอร์มรับเงิน + ประวัติการรับเงิน + ฟอร์มเพิ่มรายการ) และแอปนี้เดินด้วยหน้า
// ไม่ได้เดินด้วย URL แบบเว็บ การเปิดซ้อนจึงไม่ได้ประโยชน์เรื่องปุ่มย้อนกลับของเบราว์เซอร์
// signedBy = ชื่อผู้ที่กำลังออก/พิมพ์เอกสารใบนี้ ไปขึ้นในช่อง "ลงชื่อ" ท้ายบิล
export default function InvoiceDetailPage({ invoiceId, onBack, signedBy }) {
  const [invoice, setInvoice] = useState(null)
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // ใบเสร็จที่กำลังจะยกเลิก (null = ไม่ได้เปิดหน้าต่าง)
  const [cancellingReceipt, setCancellingReceipt] = useState(null)

  const load = useCallback(async () => {
    const [inv, pays] = await Promise.all([
      getInvoice(invoiceId),
      listPaymentsForInvoice(invoiceId)
    ])
    setLoading(false)
    if (!inv.success) return setError(inv.error)
    if (!pays.success) return setError(pays.error)
    setError('')
    setInvoice(inv.data)
    setPayments(pays.data)
  }, [invoiceId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <p className="muted">กำลังโหลด...</p>
  if (!invoice) {
    return (
      <>
        <BackLink onBack={onBack} />
        <Alert>{error || 'ไม่พบใบแจ้งหนี้'}</Alert>
      </>
    )
  }

  const closed = invoice.status === 'cancelled'

  return (
    <>
      <BackLink onBack={onBack} />
      <Alert>{error}</Alert>

      <div className="invoice-layout">
        <div className="invoice-main">
          <InvoiceDocument
            invoice={invoice}
            signedBy={signedBy}
            onError={setError}
            onRemoveItem={async (itemId) => {
              setError('')
              const res = await removeInvoiceItem(invoice.invoiceId, itemId)
              if (!res.success) return setError(res.error)
              showToast('ลบรายการแล้ว')
              load()
            }}
            onCancel={async () => {
              setError('')
              const res = await cancelInvoice(invoice.invoiceId)
              if (!res.success) return setError(res.error)
              showToast(`ยกเลิกบิล ${invoice.invoiceNumber} แล้ว`)
              load()
            }}
          />

          {!closed && (
            <AddItemPanel
              invoice={invoice}
              onDone={() => {
                showToast('เพิ่มรายการแล้ว')
                load()
              }}
              onError={setError}
            />
          )}
        </div>

        <aside className="invoice-side">
          <OutstandingBox invoice={invoice} />

          {!closed && (
            <PaymentCard
              invoice={invoice}
              onDone={(message) => {
                showToast(message)
                load()
              }}
              onError={setError}
            />
          )}

          <PaymentHistory payments={payments} onCancelReceipt={setCancellingReceipt} />
        </aside>
      </div>

      {cancellingReceipt && (
        <CancelReceiptDialog
          receipt={cancellingReceipt}
          onClose={() => setCancellingReceipt(null)}
          onCancelled={(result) => {
            setCancellingReceipt(null)
            showToast(
              `ยกเลิกใบเสร็จ ${result.payment.receiptNumber} แล้ว` +
                (result.lateFeeItemsRemoved > 0 ? ' และถอดรายการค่าปรับออกจากบิลแล้ว' : '')
            )
            load()
          }}
          onError={setError}
        />
      )}
    </>
  )
}

function BackLink({ onBack }) {
  return (
    <div className="page-back">
      <button type="button" className="link-btn" onClick={onBack}>
        <Icon name="back" />
        <span>กลับไปรายการใบแจ้งหนี้</span>
      </button>
    </div>
  )
}

// ------------------------------------------------------------------
// ตัวเอกสาร
// ------------------------------------------------------------------
function InvoiceDocument({ invoice, onRemoveItem, onCancel, onError, signedBy }) {
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const closed = invoice.status === 'cancelled'

  // กล่องเลือกเครื่องพิมพ์ต้องเปิด "นอก" ตัวเอกสาร ไม่งั้นมันจะถูกซ่อนไปพร้อมกันตอนพิมพ์
  // (แต่ Modal เรนเดอร์ทับทั้งหน้าอยู่แล้ว จึงไม่มีปัญหา)
  const [printing, setPrinting] = useState(false)

  // ตั้งชื่อไฟล์เป็น "เลขที่บิล-ห้อง" เพื่อให้ผู้เช่าที่ได้รับทางแชตรู้ทันทีว่าเป็นบิลใบไหน
  // ห้องไหน โดยไม่ต้องเปิดไฟล์ก่อน
  async function onSavePdf() {
    onError('')
    setBusy(true)
    const res = await savePdf(`${invoice.invoiceNumber}-ห้อง${invoice.roomNumber}`)
    setBusy(false)
    if (!res.success) return onError(res.error)
    if (res.data.cancelled) return

    showToast('บันทึกไฟล์ PDF แล้ว')
    // เปิดโฟลเดอร์ค้างไว้ให้ลากไฟล์ไปแนบส่งต่อได้เลย ไม่ต้องไปหาเอง
    revealPdf(res.data.filePath)
  }

  return (
    <section className="panel invoice-doc">
      <div className="invoice-doc-tools">
        {!closed && (
          <button
            type="button"
            className="link-btn link-danger"
            onClick={() => setConfirmingCancel(true)}
          >
            <Icon name="trash" />
            <span>ยกเลิกบิล</span>
          </button>
        )}

        {/* ปุ่มพิมพ์/บันทึก PDF อยู่ขวาตามต้นแบบ — และถูกซ่อนตอนพิมพ์ด้วย @media print
            ไม่งั้นตัวปุ่มจะติดไปบนกระดาษด้วย */}
        <div className="invoice-doc-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setPrinting(true)}
            disabled={busy}
          >
            <Icon name="printer" />
            <span>พิมพ์</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={onSavePdf} disabled={busy}>
            <Icon name="download" />
            <span>{busy ? 'กำลังบันทึก...' : 'บันทึก PDF'}</span>
          </button>
        </div>
      </div>

      {confirmingCancel && (
        <Alert kind="warn">
          ยกเลิกบิล {invoice.invoiceNumber} ใช่ไหม? บิลจะยังอยู่ในระบบแต่ถูกทำเครื่องหมายว่ายกเลิก
          และออกบิลของเดือนนี้ใหม่ได้
          <div className="invoice-confirm-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setConfirmingCancel(false)
                onCancel()
              }}
            >
              ยืนยันยกเลิกบิล
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setConfirmingCancel(false)}
            >
              ไม่ใช่
            </button>
          </div>
        </Alert>
      )}

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
        // บิลที่ยกเลิกแล้วแก้ไม่ได้ ไม่ส่ง onRemoveItem ไป คอลัมน์ปุ่มลบจึงหายไปเอง
        onRemoveItem={closed ? undefined : onRemoveItem}
        footer={<InvoicePaymentInfo invoice={invoice} signedBy={signedBy} />}
      />

      {printing && (
        <PrintDialog
          onClose={() => setPrinting(false)}
          onPrinted={() => {
            setPrinting(false)
            showToast('ส่งเอกสารเข้าเครื่องพิมพ์แล้ว')
          }}
        />
      )}
    </section>
  )
}

// ท้ายบิล — ลอกโครงจากใบเสร็จ PDF ของต้นแบบ:
//   กล่องลงชื่อชิดขวา
//   ตารางบัญชี 2 คอลัมน์ (ชื่อบัญชีตัวหนา ธนาคารตัวเล็กใต้ | เลขบัญชี)
//   การแจ้งชำระเงิน:
//   Note:
//
// แต่ละบล็อกหายไปเองถ้าไม่มีข้อมูล ไม่ทิ้งหัวข้อว่างไว้บนกระดาษ
function InvoicePaymentInfo({ invoice, signedBy }) {
  const banks = invoice.bankAccounts ?? []
  const instructions = invoice.apartment.paymentInstructions
  const note = invoice.apartment.invoiceNote
  const qrImageId = invoice.apartment.qrCodeImageId

  // QR ดึงแยกจากตัวบิล เพราะเป็นรูปที่ใหญ่กว่าข้อมูลบิลทั้งใบรวมกัน — ไม่ควรติดมากับ
  // ทุกครั้งที่โหลดบิล และรายการบิลก็ไม่ได้ใช้
  const [qrDataUrl, setQrDataUrl] = useState(null)
  useEffect(() => {
    if (!qrImageId) return setQrDataUrl(null)
    let cancelled = false
    getImageDataUrl(qrImageId).then((res) => {
      if (!cancelled && res.success) setQrDataUrl(res.data.dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [qrImageId])

  if (banks.length === 0 && !instructions && !note && !qrDataUrl) return null

  return (
    <section className="invoice-payment-info">
      {/* ช่องลงชื่อผู้ออกบิล — เว้นที่ไว้เซ็นด้วยมือบนกระดาษ ชื่อที่พิมพ์คือคนที่กำลัง
          ออก/พิมพ์เอกสารใบนี้ */}
      <BillSignature name={signedBy} />

      {/* QR อยู่ข้างกล่องบัญชี — ผู้เช่าสแกนได้ทันทีจากไฟล์ที่ได้รับทางแชต
          โดยไม่ต้องพิมพ์เลขบัญชีทีละหลัก */}
      <div className={'invoice-footer-layout' + (qrDataUrl ? ' has-qr' : '')}>
        <div className="invoice-footer-box">
        {banks.length > 0 && (
          <table className="invoice-banks">
            <thead>
              <tr>
                <th>บัญชี</th>
                <th>เลขบัญชี</th>
              </tr>
            </thead>
            <tbody>
              {banks.map((bank) => (
                <tr key={`${bank.bankName}-${bank.accountNumber}`}>
                  <td>
                    <strong>{bank.accountName}</strong>
                    <span className="invoice-bank-name">{bank.bankName}</span>
                  </td>
                  {/* เลขบัญชีเป็นตัวเลขที่คนต้องคัดลอกทีละหลัก จึงใช้ฟอนต์ความกว้างเท่ากัน
                      เพื่อให้ตาไล่ตัวเลขได้ไม่หลง */}
                  <td className="invoice-account-number">{bank.accountNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {instructions && (
          <div className="invoice-footer-note">
            <strong>การแจ้งชำระเงิน:</strong>
            <p>{instructions}</p>
          </div>
        )}

        {note && (
          <div className="invoice-footer-note">
            <strong>Note:</strong>
            <p>{note}</p>
          </div>
        )}
        </div>

        {qrDataUrl && (
          <figure className="invoice-qr">
            <img src={qrDataUrl} alt="QR Code สำหรับชำระเงิน" />
            <figcaption>สแกนเพื่อชำระเงิน</figcaption>
          </figure>
        )}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------
// เพิ่มรายการเข้าบิลที่ออกไปแล้ว
// ------------------------------------------------------------------
const ITEM_TABS = [
  { key: 'service', label: 'ค่าบริการ', itemType: 'other', hint: 'ค่าบริการที่เก็บเพิ่มกับผู้เช่า' },
  {
    key: 'discount',
    label: 'ส่วนลด / คืนเงิน',
    itemType: 'discount',
    hint: 'กรอกเป็นจำนวนบวก ระบบจะหักออกจากยอดรวมให้เอง'
  }
]

function AddItemPanel({ invoice, onDone, onError }) {
  const [tab, setTab] = useState(ITEM_TABS[0])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [isTaxable, setIsTaxable] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    onError('')
    setBusy(true)
    const res = await addInvoiceItem(invoice.invoiceId, {
      itemType: tab.itemType,
      description,
      amount,
      isTaxable: tab.key === 'service' && isTaxable
    })
    setBusy(false)
    if (!res.success) return onError(res.error)
    setDescription('')
    setAmount('')
    setIsTaxable(false)
    onDone()
  }

  return (
    <section className="panel">
      <h2 className="panel-title">เพิ่มรายการ</h2>

      <div className="mode-tabs">
        {ITEM_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={'mode-tab' + (t.key === tab.key ? ' active' : '')}
            onClick={() => {
              setTab(t)
              setIsTaxable(false)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit}>
        <p className="field-hint invoice-tab-hint">{tab.hint}</p>

        <div className="field-row">
          <div className="field field-required">
            <label htmlFor="itemDescription">
              ชื่อรายการ <span className="required">* จำเป็น</span>
            </label>
            <input
              id="itemDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tab.key === 'discount' ? 'เช่น ส่วนลดจ่ายตรงเวลา' : 'เช่น ค่าซ่อมประตู'}
            />
          </div>

          <div className="field field-required">
            <label htmlFor="itemAmount">
              จำนวนเงิน <span className="required">* จำเป็น</span>
            </label>
            <input
              id="itemAmount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        {/* ช่องคิด VAT โผล่เฉพาะหอที่จดทะเบียน VAT และเฉพาะแท็บค่าบริการ
            ส่วนลดไม่คิดภาษีต่อ (ฝั่ง main บังคับไว้อีกชั้นหนึ่งด้วย) */}
        {invoice.isVatEnabled && tab.key === 'service' && (
          <div className="field checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={isTaxable}
                onChange={(e) => setIsTaxable(e.target.checked)}
              />
              <span>คำนวณ VAT {VAT_RATE}% ของรายการนี้</span>
            </label>
          </div>
        )}

        <div className="card-foot">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'กำลังเพิ่ม...' : 'เพิ่มรายการ'}
          </button>
        </div>
      </form>
    </section>
  )
}

// ------------------------------------------------------------------
// ยอดค้าง + รับเงิน + ประวัติ
// ------------------------------------------------------------------
function OutstandingBox({ invoice }) {
  const settled = invoice.outstandingCents <= 0
  return (
    <div className={'outstanding-box' + (settled ? ' settled' : '')}>
      <span>{settled ? 'ชำระครบแล้ว' : 'ค้างชำระ'}</span>
      <strong>{formatBaht(Math.max(invoice.outstandingCents, 0))}</strong>
      <span className="outstanding-unit">บาท</span>
    </div>
  )
}

// การ์ดนี้รับเงินอย่างเดียว — **ไม่มีปุ่มคืนเงิน** (ผู้ใช้สั่งเอาออก 2026-08-08)
// เหตุผล: หอพักไม่มีสถานการณ์ที่ต้องคืนเงินค่าบิลให้ผู้เช่า
//
// การคืนเงินประกันตอนย้ายออกเป็นคนละเรื่อง — ผูกกับสัญญาไม่ใช่กับบิล และยังอยู่ที่
// recordContractPayment(isRefund) รอ Phase 4 ใช้
function PaymentCard({ invoice, onDone, onError }) {
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentDate, setPaymentDate] = useState(today())
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  // ค่าปรับ ณ วันที่รับเงินที่เลือกอยู่ — ถามฝั่ง main ใหม่ทุกครั้งที่เปลี่ยนวันที่
  const [lateFee, setLateFee] = useState(null)
  const [chargeLateFee, setChargeLateFee] = useState(true)
  const [lateFeeAmount, setLateFeeAmount] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await getLateFee(invoice.invoiceId, paymentDate)
      if (cancelled) return
      const data = res.success ? res.data : null
      setLateFee(data)
      setLateFeeAmount(centsToInput(data?.suggestedCents ?? 0))
    })()
    return () => {
      cancelled = true
    }
  }, [invoice.invoiceId, paymentDate])

  const feeDue = Boolean(lateFee?.enabled) && lateFee.suggestedCents > 0
  const feeCents = feeDue && chargeLateFee ? Math.round(Number(lateFeeAmount || 0) * 100) : 0

  // เติมยอดที่ค้างอยู่ให้เป็นค่าตั้งต้น — คนส่วนใหญ่จ่ายเต็มจำนวน จะได้กดบันทึกได้เลย
  // แต่ยังแก้เป็นยอดบางส่วนได้ (ต้นแบบก็เติมมาให้เหมือนกัน)
  //
  // ค่าปรับที่จะเก็บต้องบวกเข้าไปด้วย เพราะมันจะกลายเป็นรายการบนบิลตอนกดบันทึก
  // ถ้าไม่บวก ผู้ใช้จะกดบันทึกแล้วเหลือยอดค้างเท่าค่าปรับพอดีโดยไม่ได้ตั้งใจ
  useEffect(() => {
    setAmount(centsToInput(Math.max(invoice.outstandingCents, 0) + feeCents))
  }, [invoice.outstandingCents, feeCents])

  async function submit(e) {
    e.preventDefault()
    onError('')
    setBusy(true)
    const res = await receivePayment({
      invoiceId: invoice.invoiceId,
      amount,
      paymentMethod,
      paymentDate,
      remark,
      lateFee: feeCents > 0 ? lateFeeAmount : undefined
    })
    setBusy(false)
    if (!res.success) return onError(res.error)
    setRemark('')
    onDone(`รับชำระแล้ว ใบเสร็จ ${res.data.receiptNumber}`)
  }

  const settled = invoice.outstandingCents <= 0

  return (
    <section className="panel payment-card">
      <h2 className="panel-title">รับเงิน</h2>

      {settled ? (
        <p className="muted">บิลนี้ชำระครบแล้ว</p>
      ) : (
        <form onSubmit={submit}>
          <div className="field field-required">
            <label htmlFor="paymentAmount">
              จำนวนเงิน <span className="required">* จำเป็น</span>
            </label>
            <input
              id="paymentAmount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="field-hint">
              รับได้ไม่เกิน {formatBaht(invoice.outstandingCents)} บาท
            </p>
          </div>

          <div className="field field-required">
            <label htmlFor="paymentMethod">
              ชำระเงินโดย <span className="required">* จำเป็น</span>
            </label>
            <select
              id="paymentMethod"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field field-required">
            <label htmlFor="paymentDate">
              วันที่รับเงิน <span className="required">* จำเป็น</span>
            </label>
            <DateField id="paymentDate" value={paymentDate} onChange={setPaymentDate} />
          </div>

          {/* ค่าปรับชำระล่าช้า — ระบบคำนวณให้และติ๊กไว้ให้ แต่ติ๊กออกได้และลดยอดได้
              เจ้าของหอลดหย่อนให้ผู้เช่าที่ดีได้ ส่วนเพดานบังคับที่ฝั่ง main */}
          {/* เปิดสวิตช์เก็บค่าปรับไว้แต่ยังไม่ได้ตั้งอัตรา — บอกตรงๆ ว่าทำไมไม่มีค่าปรับ
              ไม่ปล่อยให้เงียบจนดูเหมือนระบบไม่ทำงาน */}
          {lateFee?.misconfigured && lateFee.overdueDays > 0 && (
            <Alert kind="warn">
              บิลนี้เกินกำหนด {lateFee.overdueDays} วัน แต่ยังคิดค่าปรับไม่ได้ เพราะหอพักตั้ง
              “ค่าปรับชำระล่าช้าต่อวัน” ไว้เป็น 0 บาท — แก้ได้ที่ ตั้งค่า › ข้อมูลหอพัก
            </Alert>
          )}

          {feeDue && (
            <div className="late-fee-box">
              <p className="late-fee-head">
                เกินกำหนดชำระ {lateFee.overdueDays} วัน · ค่าปรับวันละ{' '}
                {formatBaht(lateFee.ratePerDayCents)} บาท
                {lateFee.graceDays > 0 && ` (ผ่อนผัน ${lateFee.graceDays} วัน)`}
              </p>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={chargeLateFee}
                  onChange={(e) => setChargeLateFee(e.target.checked)}
                />
                <span>เรียกเก็บค่าปรับ</span>
              </label>

              {chargeLateFee && (
                <input
                  className="late-fee-amount"
                  inputMode="decimal"
                  value={lateFeeAmount}
                  onChange={(e) => setLateFeeAmount(e.target.value)}
                  aria-label="ยอดค่าปรับที่เรียกเก็บ"
                />
              )}

              {lateFee.alreadyChargedCents > 0 && (
                <p className="field-hint">
                  บิลนี้เคยเก็บค่าปรับไปแล้ว {formatBaht(lateFee.alreadyChargedCents)} บาท
                  ยอดข้างบนหักส่วนนั้นออกให้แล้ว
                </p>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="paymentRemark">หมายเหตุ</label>
            <textarea
              id="paymentRemark"
              rows={2}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-block" disabled={busy}>
            {busy ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </form>
      )}
    </section>
  )
}

// ใบที่ยกเลิกแล้วยังอยู่ในรายการ ไม่ได้หายไป — เจ้าของหอที่ถือกระดาษใบนั้นอยู่ในมือ
// ต้องหาเจอว่าเลขที่นี้เป็นอะไรและถูกยกเลิกเพราะอะไร
function PaymentHistory({ payments, onCancelReceipt }) {
  return (
    <section className="panel">
      <h2 className="panel-title">รายการรับเงิน</h2>

      {payments.length === 0 ? (
        <p className="muted">ยังไม่มีรายการรับเงิน</p>
      ) : (
        <ul className="receipt-list">
          {payments.map((p) => (
            <li
              key={p.paymentId}
              className={
                'receipt' + (p.isRefund ? ' refund' : '') + (p.isCancelled ? ' cancelled' : '')
              }
            >
              <div className="receipt-head">
                <strong>{p.receiptNumber}</strong>
                <span className={p.isRefund ? 'negative' : undefined}>
                  {formatBaht(p.amountCents)}
                </span>
              </div>
              <p className="muted">
                {formatDate(p.paymentDate)} · {p.paymentMethodLabel} · {p.createdByName ?? '-'}
              </p>
              {p.remark && <p className="receipt-remark">{p.remark}</p>}

              {p.isCancelled ? (
                <p className="receipt-cancelled-note">
                  <strong>ยกเลิกแล้ว</strong> — {p.cancelReason}
                  <span className="muted">
                    {' '}
                    ({p.cancelledByName ?? '-'} · {formatDate(String(p.cancelledAt).slice(0, 10))})
                  </span>
                </p>
              ) : (
                <button
                  type="button"
                  className="link-btn link-danger"
                  onClick={() => onCancelReceipt(p)}
                >
                  <Icon name="close" />
                  <span>ยกเลิกใบเสร็จ</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ------------------------------------------------------------------
function today() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}
