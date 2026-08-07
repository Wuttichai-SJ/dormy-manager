import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import DateField from '../components/DateField.jsx'
import { showToast } from '../components/Toast.jsx'
import { INVOICE_STATUS_LABELS, PAYMENT_METHODS, VAT_RATE } from '../constants.js'
import { centsToInput, formatBaht } from '../format.js'
import {
  addInvoiceItem,
  cancelInvoice,
  getInvoice,
  removeInvoiceItem
} from '../services/invoiceService.js'
import { listPaymentsForInvoice, receivePayment, refundPayment } from '../services/paymentService.js'

// หน้าใบแจ้งหนี้ — โครงตามต้นแบบ (คู่มือ yeeraf หัวข้อ "บิลค้างชำระ"): สองคอลัมน์
// ซ้ายเป็นตัวเอกสาร ขวาเป็นยอดค้างกับการ์ดรับเงิน แล้วมี "เพิ่มรายการ" อยู่ใต้เอกสาร
//
// ต้นแบบทำเป็นหน้าต่างซ้อน แต่ที่นี่เป็นหน้าเต็ม เพราะเนื้อหายาวกว่าหน้าต่างซ้อนจะรับไหว
// (เอกสาร + ฟอร์มรับเงิน + ประวัติการรับเงิน + ฟอร์มเพิ่มรายการ) และแอปนี้เดินด้วยหน้า
// ไม่ได้เดินด้วย URL แบบเว็บ การเปิดซ้อนจึงไม่ได้ประโยชน์เรื่องปุ่มย้อนกลับของเบราว์เซอร์
export default function InvoiceDetailPage({ invoiceId, onBack }) {
  const [invoice, setInvoice] = useState(null)
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

          <PaymentHistory payments={payments} />
        </aside>
      </div>
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
function InvoiceDocument({ invoice, onRemoveItem, onCancel }) {
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const closed = invoice.status === 'cancelled'

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
      </div>

      <h2 className="invoice-doc-title">ใบแจ้งหนี้ / Invoice</h2>

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

      <div className="invoice-doc-head">
        <div>
          <strong className="invoice-apartment">{invoice.apartment.name}</strong>
          <p className="muted">{invoice.apartment.address}</p>
          {invoice.apartment.phone && <p className="muted">โทร: {invoice.apartment.phone}</p>}
        </div>

        <dl className="invoice-doc-meta">
          <div>
            <dt>สถานะ</dt>
            <dd>
              <span className={`invoice-status invoice-${invoice.status}`}>
                {INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
              </span>
            </dd>
          </div>
          <div>
            <dt>เลขที่</dt>
            <dd>{invoice.invoiceNumber}</dd>
          </div>
          <div>
            <dt>ห้อง</dt>
            <dd>{invoice.roomNumber}</dd>
          </div>
          <div>
            <dt>วันที่</dt>
            <dd>{formatDate(invoice.issueDate)}</dd>
          </div>
          <div>
            <dt>ครบกำหนด</dt>
            <dd>{formatDate(invoice.dueDate)}</dd>
          </div>
        </dl>
      </div>

      <table className="data-table invoice-items">
        <thead>
          <tr>
            <th className="invoice-col-no">#</th>
            <th>รายการ</th>
            <th className="align-right">ราคาต่อหน่วย</th>
            <th className="align-right">ยอดเงิน</th>
            {!closed && <th className="align-right" />}
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, index) => (
            <tr key={item.invoiceItemId}>
              <td className="invoice-col-no">{index + 1}</td>
              <td>{item.description}</td>
              <td className="align-right">{formatBaht(item.unitPriceCents)}</td>
              <td className="align-right">
                <span className={item.totalAmountCents < 0 ? 'negative' : undefined}>
                  {formatBaht(item.totalAmountCents)}
                </span>
              </td>
              {!closed && (
                <td className="align-right">
                  <button
                    type="button"
                    className="link-btn link-danger table-action icon-only"
                    onClick={() => onRemoveItem(item.invoiceItemId)}
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
        {/* แถว VAT ขึ้นก็ต่อเมื่อหอจดทะเบียน VAT — ดูจากธงของหอ ไม่ใช่ดูว่ายอดเป็น 0
            หอที่จด VAT แต่เดือนนี้ไม่มีรายการที่เสียภาษี ยังต้องเห็น VAT 0.00 บนบิล */}
        {invoice.isVatEnabled && (
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
              <dt>VAT {VAT_RATE}%</dt>
              <dd>{formatBaht(invoice.vatAmountCents)}</dd>
            </div>
          </>
        )}
        <div className="invoice-total-row">
          <dt>รวม</dt>
          <dd>{formatBaht(invoice.totalAmountCents)}</dd>
        </div>
      </dl>
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

function PaymentCard({ invoice, onDone, onError }) {
  const [mode, setMode] = useState('receive')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentDate, setPaymentDate] = useState(today())
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)

  const receiving = mode === 'receive'

  // เติมยอดที่ค้างอยู่ให้เป็นค่าตั้งต้น — คนส่วนใหญ่จ่ายเต็มจำนวน จะได้กดบันทึกได้เลย
  // แต่ยังแก้เป็นยอดบางส่วนได้ (ต้นแบบก็เติมมาให้เหมือนกัน)
  useEffect(() => {
    if (receiving) setAmount(centsToInput(Math.max(invoice.outstandingCents, 0)))
    else setAmount('')
  }, [receiving, invoice.outstandingCents])

  async function submit(e) {
    e.preventDefault()
    onError('')
    setBusy(true)
    const payload = { invoiceId: invoice.invoiceId, amount, paymentMethod, paymentDate, remark }
    const res = receiving ? await receivePayment(payload) : await refundPayment(payload)
    setBusy(false)
    if (!res.success) return onError(res.error)
    setRemark('')
    onDone(
      receiving
        ? `รับชำระแล้ว ใบเสร็จ ${res.data.receiptNumber}`
        : `คืนเงินแล้ว ใบเสร็จ ${res.data.receiptNumber}`
    )
  }

  const settled = invoice.outstandingCents <= 0
  const nothingPaid = invoice.paidAmountCents <= 0

  return (
    <section className="panel payment-card">
      <div className="mode-tabs">
        <button
          type="button"
          className={'mode-tab' + (receiving ? ' active' : '')}
          onClick={() => setMode('receive')}
          disabled={settled}
        >
          รับเงิน
        </button>
        {/* คืนเงินซ่อนไม่ได้ แต่กดไม่ได้ถ้ายังไม่เคยรับเงินเข้ามาเลย —
            ไม่งั้นผู้ใช้จะกดแล้วเจอ error ที่ป้องกันได้ตั้งแต่หน้าจอ */}
        <button
          type="button"
          className={'mode-tab' + (!receiving ? ' active' : '')}
          onClick={() => setMode('refund')}
          disabled={nothingPaid}
        >
          คืนเงิน
        </button>
      </div>

      {settled && receiving ? (
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
              {receiving
                ? `รับได้ไม่เกิน ${formatBaht(invoice.outstandingCents)} บาท`
                : `คืนได้ไม่เกิน ${formatBaht(invoice.paidAmountCents)} บาท`}
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
              วันที่{receiving ? 'รับเงิน' : 'คืนเงิน'} <span className="required">* จำเป็น</span>
            </label>
            <DateField id="paymentDate" value={paymentDate} onChange={setPaymentDate} />
          </div>

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

function PaymentHistory({ payments }) {
  return (
    <section className="panel">
      <h2 className="panel-title">รายการรับเงิน</h2>

      {payments.length === 0 ? (
        <p className="muted">ยังไม่มีรายการรับเงิน</p>
      ) : (
        <ul className="receipt-list">
          {payments.map((p) => (
            <li key={p.paymentId} className={p.isRefund ? 'receipt refund' : 'receipt'}>
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
