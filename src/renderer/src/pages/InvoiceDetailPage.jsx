import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { useConfirm } from '../components/ConfirmDialog.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from '../components/FieldError.jsx'
import DateField from '../components/DateField.jsx'
import Modal from '../components/Modal.jsx'
import { showToast } from '../components/Toast.jsx'
import { PAYMENT_METHODS, DEFAULT_VAT_RATE } from '../constants.js'
import { centsToInput, formatBaht } from '../format.js'
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
import InvoiceBill from '../components/InvoiceBill.jsx'
import { revealPdf, savePdf } from '../services/printService.js'

// สองคอลัมน์: เอกสาร + เพิ่มรายการ / ยอดค้าง + รับเงิน · signedBy = ชื่อในช่องลงชื่อ
export default function InvoiceDetailPage({ invoiceId, onBack, signedBy, canCancelReceipt }) {
  const [confirmDialog, ask] = useConfirm()
  const [invoice, setInvoice] = useState(null)
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cancellingReceipt, setCancellingReceipt] = useState(null)
  const [cancellingInvoice, setCancellingInvoice] = useState(false)

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
      {confirmDialog}
      <Alert>{error}</Alert>

      <div className="invoice-layout">
        <div className="invoice-main">
          <InvoiceDocument
            invoice={invoice}
            signedBy={signedBy}
            onError={setError}
            onRemoveItem={(item) =>
              ask({
                title: `ลบรายการ "${item.description}"?`,
                message: 'ยอดรวมของบิลนี้จะถูกคิดใหม่',
                confirmLabel: 'ลบรายการ',
                onConfirm: async () => {
                  const res = await removeInvoiceItem(invoice.invoiceId, item.invoiceItemId)
                  if (res.success) {
                    showToast('ลบรายการแล้ว')
                    load()
                  }
                  return res
                }
              })
            }
            onCancel={() => setCancellingInvoice(true)}
          />

          {!closed && (
            <AddItemPanel
              invoice={invoice}
              onDone={() => {
                showToast('เพิ่มรายการแล้ว')
                load()
              }}
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
            />
          )}

          {/* null = ไม่มีปุ่มยกเลิกใบเสร็จ (ไม่ใช่เจ้าของ) */}
          <PaymentHistory
            payments={payments}
            onCancelReceipt={canCancelReceipt ? setCancellingReceipt : null}
          />
        </aside>
      </div>

      {cancellingInvoice && (
        <CancelInvoiceDialog
          invoice={invoice}
          onClose={() => setCancellingInvoice(false)}
          onCancelled={() => {
            setCancellingInvoice(false)
            showToast(`ยกเลิกบิล ${invoice.invoiceNumber} แล้ว`)
            load()
          }}
        />
      )}

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

function InvoiceDocument({ invoice, onRemoveItem, onCancel, onError, signedBy }) {
  const [busy, setBusy] = useState(false)
  const closed = invoice.status === 'cancelled'

  const [printing, setPrinting] = useState(false)

  async function onSavePdf() {
    onError('')
    setBusy(true)
    const res = await savePdf(`${invoice.invoiceNumber}-ห้อง${invoice.roomNumber}`)
    setBusy(false)
    if (!res.success) return onError(res.error)
    if (res.data.cancelled) return

    showToast('บันทึกไฟล์ PDF แล้ว')
    revealPdf(res.data.filePath)
  }

  return (
    <section className="panel invoice-doc">
      <div className="invoice-doc-tools">
        {!closed && (
          <button type="button" className="link-btn link-danger" onClick={onCancel}>
            <Icon name="trash" />
            <span>ยกเลิกบิล</span>
          </button>
        )}

        {/* บิลที่ยกเลิกพิมพ์ไม่ได้ · ปุ่มถูกซ่อนตอนพิมพ์ */}
        {!closed && (
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
        )}
      </div>

      {/* เหตุผลยกเลิกอยู่นอกตัวเอกสาร — ไม่ติดไปบนกระดาษ */}
      {closed && <CancelledNotice invoice={invoice} />}

      <InvoiceBill
        invoice={invoice}
        signedBy={signedBy}
        // บิลที่ยกเลิกไม่ส่ง onRemoveItem — ไม่มีปุ่มลบ
        onRemoveItem={closed ? undefined : onRemoveItem}
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

function CancelledNotice({ invoice }) {
  return (
    <Alert kind="warn">
      <strong>ยกเลิกแล้ว</strong> — พิมพ์ แก้ไข และรับชำระไม่ได้ · ออกบิลเดือนนี้ใหม่ได้
      <dl className="invoice-cancel-info">
        <div>
          <dt>เหตุผล</dt>
          <dd>
            {invoice.cancelReason ?? (
              <span className="muted">ไม่ได้บันทึกไว้</span>
            )}
          </dd>
        </div>
        <div>
          <dt>ยกเลิกโดย</dt>
          <dd>{invoice.cancelledByName ?? <span className="muted">ไม่ทราบ</span>}</dd>
        </div>
        <div>
          <dt>เมื่อ</dt>
          <dd>{formatDate(String(invoice.cancelledAt ?? '').slice(0, 10))}</dd>
        </div>
      </dl>
    </Alert>
  )
}

function CancelInvoiceDialog({ invoice, onClose, onCancelled }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = reason.trim().length > 0
  const { errors, formError, fromResult, clear, reset } = useFormErrors(['reason'])

  async function submit() {
    if (!ready) return
    reset()
    setBusy(true)
    const res = await cancelInvoice(invoice.invoiceId, reason)
    setBusy(false)
    if (!res.success) return fromResult(res)
    onCancelled()
  }

  return (
    <Modal
      title={`ยกเลิกใบแจ้งหนี้ ${invoice.invoiceNumber}`}
      icon="trash"
      submitLabel="ยืนยันยกเลิกบิล"
      busy={busy || !ready}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert kind="warn">
        <strong>พิมพ์และรับชำระไม่ได้อีก</strong> · ออกบิลเดือนนี้ใหม่ได้ (ได้เลขที่ใหม่)
      </Alert>

      <dl className="invoice-totals delete-summary">
        <div>
          <dt>ห้อง</dt>
          <dd>{invoice.roomNumber}</dd>
        </div>
        <div>
          <dt>ยอดรวม</dt>
          <dd>{formatBaht(invoice.totalAmountCents)}</dd>
        </div>
        <div>
          <dt>ค้างชำระ</dt>
          <dd>{formatBaht(Math.max(invoice.outstandingCents, 0))}</dd>
        </div>
      </dl>

      <div className={fieldClass('field field-required', errors.reason)}>
        <label htmlFor="cancelInvoiceReason">
          เหตุผลในการยกเลิก <span className="required">* จำเป็น</span>
        </label>
        <textarea
          id="cancelInvoiceReason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            clear('reason')
          }}
          {...invalidProps('cancelInvoiceReason', errors.reason)}
          placeholder="เช่น ออกบิลผิดห้อง / จดมิเตอร์ผิด / ผู้เช่าย้ายออกก่อนออกบิล"
        />
        {errors.reason ? (
          <FieldError id="cancelInvoiceReason-error" message={errors.reason} />
        ) : (
          !ready && <p className="field-hint">ต้องกรอกเหตุผลก่อนจึงจะยกเลิกได้</p>
        )}
      </div>
    </Modal>
  )
}

const ITEM_TABS = [
  { key: 'service', label: 'ค่าบริการ', itemType: 'other', hint: null },
  {
    key: 'discount',
    label: 'ส่วนลด / คืนเงิน',
    itemType: 'discount',
    hint: 'กรอกเป็นจำนวนบวก ระบบหักออกให้เอง'
  }
]

function AddItemPanel({ invoice, onDone }) {
  const [tab, setTab] = useState(ITEM_TABS[0])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [isTaxable, setIsTaxable] = useState(false)
  const [busy, setBusy] = useState(false)
  const { errors, formError, fromResult, clear, reset } = useFormErrors(['description', 'amount'])

  async function submit(e) {
    e.preventDefault()
    reset()
    setBusy(true)
    const res = await addInvoiceItem(invoice.invoiceId, {
      itemType: tab.itemType,
      description,
      amount,
      isTaxable: tab.key === 'service' && isTaxable
    })
    setBusy(false)
    if (!res.success) return fromResult(res)
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
        {tab.hint && <p className="field-hint invoice-tab-hint">{tab.hint}</p>}
        <Alert>{formError}</Alert>

        <div className="field-row">
          <div className={fieldClass('field field-required', errors.description)}>
            <label htmlFor="itemDescription">
              ชื่อรายการ <span className="required">* จำเป็น</span>
            </label>
            <input
              id="itemDescription"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                clear('description')
              }}
              placeholder={tab.key === 'discount' ? 'เช่น ส่วนลดจ่ายตรงเวลา' : 'เช่น ค่าซ่อมประตู'}
              {...invalidProps('itemDescription', errors.description)}
            />
            <FieldError id="itemDescription-error" message={errors.description} />
          </div>

          <div className={fieldClass('field field-required', errors.amount)}>
            <label htmlFor="itemAmount">
              จำนวนเงิน <span className="required">* จำเป็น</span>
            </label>
            <input
              id="itemAmount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                clear('amount')
              }}
              {...invalidProps('itemAmount', errors.amount)}
            />
            <FieldError id="itemAmount-error" message={errors.amount} />
          </div>
        </div>

        {invoice.isVatEnabled && tab.key === 'service' && (
          <div className="field checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={isTaxable}
                onChange={(e) => setIsTaxable(e.target.checked)}
              />
              <span>คำนวณ VAT {invoice.vatRate ?? DEFAULT_VAT_RATE}% ของรายการนี้</span>
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

// รับเงินอย่างเดียว — ไม่มีการคืนเงินค่าบิล
function PaymentCard({ invoice, onDone }) {
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentDate, setPaymentDate] = useState(today())
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [lateFee, setLateFee] = useState(null)
  const [chargeLateFee, setChargeLateFee] = useState(true)
  const [lateFeeAmount, setLateFeeAmount] = useState('')
  // พิมพ์ยอดเองแล้ว ห้ามเติมทับ
  const [amountTouched, setAmountTouched] = useState(false)
  // ชื่อช่องตรงกับ recordInvoicePayment
  const { errors, formError, fromResult, clear, reset } = useFormErrors([
    'amount',
    'paymentMethod',
    'paymentDate',
    'lateFee'
  ])

  // ถามค่าปรับใหม่เมื่อยอดบิลเปลี่ยนด้วย ไม่ใช่แค่วันที่
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
  }, [invoice.invoiceId, invoice.totalAmountCents, invoice.outstandingCents, paymentDate])

  const feeDue = Boolean(lateFee?.enabled) && lateFee.suggestedCents > 0
  const feeCents = feeDue && chargeLateFee ? Math.round(Number(lateFeeAmount || 0) * 100) : 0

  // เติมยอดค้าง + ค่าปรับให้ก่อน — เฉพาะตอนผู้ใช้ยังไม่พิมพ์เอง
  useEffect(() => {
    if (amountTouched) return
    setAmount(centsToInput(Math.max(invoice.outstandingCents, 0) + feeCents))
  }, [invoice.outstandingCents, feeCents, amountTouched])

  async function submit(e) {
    e.preventDefault()
    reset()
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
    if (!res.success) return fromResult(res)
    setRemark('')
    setAmountTouched(false)
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
          <Alert>{formError}</Alert>

          <div className={fieldClass('field field-required', errors.amount)}>
            <label htmlFor="paymentAmount">
              จำนวนเงิน <span className="required">* จำเป็น</span>
            </label>
            <input
              id="paymentAmount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setAmountTouched(true)
                clear('amount')
              }}
              {...invalidProps('paymentAmount', errors.amount)}
            />
            {errors.amount ? (
              <FieldError id="paymentAmount-error" message={errors.amount} />
            ) : (
              <p className="field-hint">
                รับได้ไม่เกิน {formatBaht(Math.max(invoice.outstandingCents, 0) + feeCents)} บาท
              </p>
            )}
          </div>

          <div className={fieldClass('field field-required', errors.paymentMethod)}>
            <label htmlFor="paymentMethod">
              ชำระเงินโดย <span className="required">* จำเป็น</span>
            </label>
            <select
              id="paymentMethod"
              value={paymentMethod}
              onChange={(e) => {
                setPaymentMethod(e.target.value)
                clear('paymentMethod')
              }}
              {...invalidProps('paymentMethod', errors.paymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <FieldError id="paymentMethod-error" message={errors.paymentMethod} />
          </div>

          <div className={fieldClass('field field-required', errors.paymentDate)}>
            <label htmlFor="paymentDate">
              วันที่รับเงิน <span className="required">* จำเป็น</span>
            </label>
            <DateField
              id="paymentDate"
              value={paymentDate}
              onChange={(v) => {
                setPaymentDate(v)
                clear('paymentDate')
              }}
            />
            <FieldError id="paymentDate-error" message={errors.paymentDate} />
          </div>

          {/* ค่าปรับติ๊กไว้ให้ ติ๊กออกหรือลดได้ — เพดานบังคับที่ main */}
          {lateFee?.misconfigured && lateFee.overdueDays > 0 && (
            <Alert kind="warn">
              เกินกำหนด {lateFee.overdueDays} วัน แต่ค่าปรับต่อวันตั้งไว้ 0 บาท — แก้ที่ ตั้งค่า ›
              ข้อมูลหอพัก
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
                  onChange={(e) => {
                    setChargeLateFee(e.target.checked)
                    // ติ๊กเปลี่ยน = เติมยอดใหม่
                    setAmountTouched(false)
                  }}
                />
                <span>เรียกเก็บค่าปรับ</span>
              </label>

              {chargeLateFee && (
                <input
                  id="lateFeeAmount"
                  className="late-fee-amount"
                  inputMode="decimal"
                  value={lateFeeAmount}
                  onChange={(e) => {
                    setLateFeeAmount(e.target.value)
                    clear('lateFee')
                  }}
                  aria-label="ยอดค่าปรับที่เรียกเก็บ"
                  {...invalidProps('lateFeeAmount', errors.lateFee)}
                />
              )}
              <FieldError id="lateFeeAmount-error" message={errors.lateFee} />

              {lateFee.alreadyChargedCents > 0 && (
                <p className="field-hint">
                  เก็บไปแล้ว {formatBaht(lateFee.alreadyChargedCents)} บาท (หักออกให้แล้ว)
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
                onCancelReceipt && (
                  <button
                    type="button"
                    className="link-btn link-danger"
                    onClick={() => onCancelReceipt(p)}
                  >
                    <Icon name="close" />
                    <span>ยกเลิกใบเสร็จ</span>
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

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
