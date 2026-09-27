import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from '../components/FieldError.jsx'
import InfoTip from '../components/InfoTip.jsx'
import { useConfirm } from '../components/ConfirmDialog.jsx'
import Modal from '../components/Modal.jsx'
import DateField from '../components/DateField.jsx'
import PeriodBar, {
  billingPeriodFilter,
  formatMonthName,
  groupByMonth,
  initialPeriod,
  periodLabel
} from '../components/PeriodBar.jsx'
import { showToast } from '../components/Toast.jsx'
import { INVOICE_STATUS_LABELS } from '../constants.js'
import { formatBaht } from '../format.js'
import InvoiceDetailPage from './InvoiceDetailPage.jsx'
import MultiPaymentPage from './MultiPaymentPage.jsx'
import InvoiceBill from '../components/InvoiceBill.jsx'
import PrintDialog from '../components/PrintDialog.jsx'
import { listMeterBatches } from '../services/meterService.js'
import { getImageDataUrl } from '../services/imageService.js'
import {
  createMonthlyInvoice,
  createMonthlyInvoicesForApartment,
  deleteInvoice,
  getInvoice,
  listInvoices,
  previewMonthlyBilling
} from '../services/invoiceService.js'

const EMPTY_FILTERS = { roomNumber: '', invoiceNumber: '' }

// settlement ต้องตรงกับ SETTLEMENT_STATUSES ใน main/db/invoices.js · "ทั้งหมด" รวมบิลที่ยกเลิก
const SETTLEMENT_TABS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'outstanding', label: 'ค้างชำระ' },
  { key: 'paid', label: 'ชำระแล้ว' },
  { key: 'cancelled', label: 'ยกเลิกแล้ว' }
]

// initialInvoiceId = เปิดพร้อมกางบิลใบนั้น — ผู้เรียกต้องใส่ key ที่เปลี่ยนตามค่านี้
export default function InvoicesPage({ apartment, user, initialInvoiceId = null }) {
  const [wizard, setWizard] = useState(false)
  const [multiPay, setMultiPay] = useState(false)
  const [openInvoiceId, setOpenInvoiceId] = useState(initialInvoiceId)
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // '' = ทั้งหมด · แยกจาก filters (รีเซ็ตไม่เด้งแท็บ)
  const [settlement, setSettlement] = useState('')
  // เปิดมาเป็นเดือนนี้
  const [period, setPeriod] = useState(initialPeriod)
  // เดือนที่ผู้ใช้พับ/กางเอง — ล้างเมื่อเปลี่ยนช่วงเวลา
  const [toggled, setToggled] = useState(() => new Set())
  const [deleting, setDeleting] = useState(null)
  const [printSet, setPrintSet] = useState(null)
  const [busy, setBusy] = useState(false)

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const hasFilters = Object.values(filters).some((v) => v !== '')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listInvoices(apartment.apartmentId, {
      settlement: settlement || undefined,
      roomNumber: filters.roomNumber.trim() || undefined,
      invoiceNumber: filters.invoiceNumber.trim() || undefined,
      ...billingPeriodFilter(period)
    })
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setInvoices(res.data)
  }, [apartment.apartmentId, settlement, filters, period])

  function changePeriod(next) {
    setPeriod(next)
    setToggled(new Set())
  }

  // ดูหลายเดือน: เดือนล่าสุดกาง เดือนเก่าพับ · ค้นหาอยู่ = กางหมด
  const groups = groupByMonth(invoices, (inv) => inv.billingMonth)
  const multiMonth = period.mode !== 'month'
  const isOpen = (month, index) => {
    const byDefault = !multiMonth || hasFilters || index === 0
    return toggled.has(month) ? !byDefault : byDefault
  }
  const toggleMonth = (month) =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })

  useEffect(() => {
    load()
  }, [load])

  // พิมพ์ทุกใบในตารางยกเว้นใบที่ยกเลิก
  const printable = invoices.filter((inv) => inv.status !== 'cancelled')

  // เตรียมเอกสารก่อนเปิดกล่องพิมพ์
  async function startBulkPrint() {
    setError('')
    setBusy(true)

    const results = await Promise.all(printable.map((inv) => getInvoice(inv.invoiceId)))
    const failed = results.find((res) => !res.success)
    if (failed) {
      setBusy(false)
      return setError(failed.error)
    }
    const bills = results.map((res) => res.data)

    // โหลด QR ครั้งเดียวแล้วใช้ทุกใบ
    const qrImageId = bills[0]?.apartment?.qrCodeImageId
    let qrDataUrl = null
    if (qrImageId) {
      const res = await getImageDataUrl(qrImageId)
      if (res.success) qrDataUrl = res.data.dataUrl
    }

    setBusy(false)
    setPrintSet({ bills, qrDataUrl })
  }

  if (openInvoiceId) {
    return (
      <InvoiceDetailPage
        invoiceId={openInvoiceId}
        signedBy={user?.fullName}
        canCancelReceipt={Boolean(user?.isOwner)}
        onBack={() => {
          setOpenInvoiceId(null)
          load()
        }}
      />
    )
  }

  if (wizard) {
    return (
      <BillingWizard
        apartment={apartment}
        onClose={(createdMonth) => {
          setWizard(false)
          // ออกบิลเสร็จ — ไปที่รอบเดือนของบิลชุดนั้น
          if (createdMonth) changePeriod({ mode: 'month', month: createdMonth })
          else load()
        }}
      />
    )
  }

  if (multiPay) {
    return (
      <MultiPaymentPage
        apartment={apartment}
        onBack={() => {
          setMultiPay(false)
          load()
        }}
      />
    )
  }

  // ระหว่างพิมพ์แสดงแค่เอกสาร — printToPDF จับภาพหน้าที่แสดงอยู่
  if (printSet) {
    return (
      <>
        <div className="invoice-sheets">
          {printSet.bills.map((bill) => (
            <article key={bill.invoiceId} className="invoice-sheet">
              <InvoiceBill
                invoice={bill}
                signedBy={user?.fullName}
                qrDataUrl={printSet.qrDataUrl}
              />
            </article>
          ))}
        </div>

        <PrintDialog
          title={`พิมพ์ใบแจ้งหนี้ ${printSet.bills.length} ใบ`}
          maxPages={printSet.bills.length}
          onClose={() => setPrintSet(null)}
          onPrinted={() => {
            setPrintSet(null)
            showToast(`ส่งใบแจ้งหนี้ ${printSet.bills.length} ใบเข้าเครื่องพิมพ์แล้ว`)
          }}
        />
      </>
    )
  }

  return (
    <>
      <section className="panel">
        <Alert>{error}</Alert>

        <div className="panel-head-row">
          <h2 className="panel-title">
            รายการใบแจ้งหนี้
            <InfoTip
              title="พิมพ์ใบแจ้งหนี้ทุกห้อง"
              points={[
                'พิมพ์ทุกใบในช่วงเวลาและแท็บที่เลือก ใบละหนึ่งแผ่น',
                'ต้องการเฉพาะบางชุด ให้เลือกเดือนหรือแท็บก่อน',
                'ใบที่ยกเลิกแล้วจะไม่ถูกพิมพ์'
              ]}
            />
          </h2>
          <div className="panel-head-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={startBulkPrint}
              disabled={busy || printable.length === 0}
            >
              <Icon name="printer" />
              <span>
                {busy ? 'กำลังเตรียมเอกสาร...' : `พิมพ์ใบแจ้งหนี้ทุกห้อง (${printable.length})`}
              </span>
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setMultiPay(true)}>
              <Icon name="payments" />
              <span>รับเงินหลายห้อง</span>
            </button>
            <button type="button" className="btn" onClick={() => setWizard(true)}>
              <Icon name="plus" />
              <span>ออกบิลรายเดือน</span>
            </button>
          </div>
        </div>

        <div className="settlement-tabs" role="tablist">
          {SETTLEMENT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={settlement === tab.key}
              className={
                settlement === tab.key ? 'settlement-tab settlement-tab-active' : 'settlement-tab'
              }
              onClick={() => setSettlement(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {settlement === 'cancelled' && (
          <p className="field-hint">ใบที่ยกเลิกพิมพ์ไม่ได้ · ลบถาวรต้องกรอกเหตุผล</p>
        )}

        <div className="invoice-filters">
          <PeriodBar period={period} onChange={changePeriod} />

          <div className="field">
            <label htmlFor="filterRoom">เลขที่ห้อง</label>
            <input
              id="filterRoom"
              value={filters.roomNumber}
              onChange={(e) => setFilter('roomNumber', e.target.value)}
              placeholder="เช่น 101"
            />
          </div>

          <div className="field">
            <label htmlFor="filterNumber">เลขที่ใบแจ้งหนี้</label>
            <input
              id="filterNumber"
              value={filters.invoiceNumber}
              onChange={(e) => setFilter('invoiceNumber', e.target.value)}
              placeholder="เช่น I2026080001"
            />
          </div>

          <button
            type="button"
            className="link-btn invoice-filter-reset"
            onClick={() => setFilters(EMPTY_FILTERS)}
            disabled={!hasFilters}
          >
            รีเซ็ต
          </button>
        </div>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : invoices.length === 0 ? (
          <p className="muted table-empty">
            {hasFilters
              ? 'ไม่พบใบแจ้งหนี้ตามเงื่อนไขที่ค้นหา'
              : settlement === 'outstanding'
                ? 'ไม่มีใบแจ้งหนี้ที่ค้างชำระ'
                : settlement === 'paid'
                  ? 'ไม่มีใบแจ้งหนี้ที่ชำระครบแล้ว'
                  : settlement === 'cancelled'
                    ? 'ไม่มีใบแจ้งหนี้ที่ถูกยกเลิก'
                    : 'ไม่มีใบแจ้งหนี้'}
            {period.mode !== 'all' && ` ของ${periodLabel(period)}`}
            {period.mode !== 'all' && (
              <>
                {' · '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => changePeriod({ ...period, mode: 'all' })}
                >
                  ดูทุกช่วงเวลา
                </button>
              </>
            )}
          </p>
        ) : (
          <table className="data-table grouped-table">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>วันที่</th>
                <th>ห้อง</th>
                <th>สถานะ</th>
                <th className="align-right">ยอดรวม</th>
                <th className="align-right">ค้างชำระ</th>
                <th className="align-right" />
              </tr>
            </thead>
            {groups.map((group, index) => {
              const open = isOpen(group.month, index)
              return (
                <tbody key={group.month}>
                  <MonthGroupRow
                    group={group}
                    open={open}
                    collapsible={multiMonth}
                    onToggle={() => toggleMonth(group.month)}
                  />
                  {open &&
                    group.items.map((inv) => (
                      <tr key={inv.invoiceId}>
                        <td>{inv.invoiceNumber}</td>
                        <td>{formatDate(inv.issueDate)}</td>
                        <td>{inv.roomNumber}</td>
                        <td>
                          <span className={`invoice-status invoice-${inv.status}`}>
                            {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
                          </span>
                          {inv.overdueDays > 0 && (
                            <span className="invoice-overdue">เกิน {inv.overdueDays} วัน</span>
                          )}
                        </td>
                        <td className="align-right">{formatBaht(inv.totalAmountCents)}</td>
                        <td className="align-right">
                          {inv.outstandingCents > 0 ? (
                            <strong className="negative">{formatBaht(inv.outstandingCents)}</strong>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="align-right">
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setOpenInvoiceId(inv.invoiceId)}
                          >
                            รายละเอียด
                          </button>
                          {/* ลบได้เฉพาะใบที่ยกเลิกแล้ว และเจ้าของหอเท่านั้น */}
                          {inv.status === 'cancelled' && user?.isOwner && (
                            <button
                              type="button"
                              className="link-btn link-danger table-action icon-only"
                              onClick={() => setDeleting(inv)}
                              aria-label={`ลบใบแจ้งหนี้ ${inv.invoiceNumber}`}
                            >
                              <Icon name="trash" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              )
            })}
          </table>
        )}
      </section>

      {deleting && (
        <DeleteInvoiceDialog
          invoice={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            showToast(`ลบใบแจ้งหนี้ ${deleting.invoiceNumber} แล้ว`)
            setDeleting(null)
            load()
          }}
        />
      )}
    </>
  )
}

// หัวกลุ่มเดือน (ค้างจอตอนเลื่อน) — ยอดไม่นับใบที่ยกเลิก
const INVOICE_COLUMNS = 7

function MonthGroupRow({ group, open, collapsible, onToggle }) {
  const live = group.items.filter((inv) => inv.status !== 'cancelled')
  const total = live.reduce((sum, inv) => sum + inv.totalAmountCents, 0)
  const outstanding = live.reduce((sum, inv) => sum + inv.outstandingCents, 0)

  const content = (
    <>
      {collapsible && (
        <span className={open ? 'month-group-chevron month-group-chevron-open' : 'month-group-chevron'}>
          <Icon name="chevronRight" />
        </span>
      )}
      <span className="month-group-name">รอบ{formatMonthName(group.month)}</span>
      <span className="month-group-meta">
        {group.items.length} ใบ · ยอดรวม {formatBaht(total)}
        {outstanding > 0 && (
          <>
            {' · '}
            <span className="negative">ค้าง {formatBaht(outstanding)}</span>
          </>
        )}
      </span>
    </>
  )

  return (
    <tr className="month-group-row">
      <th colSpan={INVOICE_COLUMNS} scope="colgroup">
        {collapsible ? (
          <button type="button" className="month-group-toggle" aria-expanded={open} onClick={onToggle}>
            {content}
          </button>
        ) : (
          <div className="month-group-toggle">{content}</div>
        )}
      </th>
    </tr>
  )
}

// ต้องกรอกเหตุผลก่อนลบ
function DeleteInvoiceDialog({ invoice, onClose, onDeleted }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = reason.trim().length > 0
  const { errors, formError, fromResult, clear, reset } = useFormErrors(['reason'])

  async function submit() {
    if (!ready) return
    reset()
    setBusy(true)
    const res = await deleteInvoice(invoice.invoiceId, reason)
    setBusy(false)
    if (!res.success) return fromResult(res)
    onDeleted()
  }

  return (
    <Modal
      title={`ลบใบแจ้งหนี้ ${invoice.invoiceNumber}`}
      icon="trash"
      submitLabel="ลบถาวร"
      busy={busy || !ready}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert kind="warn">
        ลบถาวร กู้คืนไม่ได้ · เลขที่ {invoice.invoiceNumber} จะไม่ถูกนำไปใช้ซ้ำ
      </Alert>

      <dl className="invoice-totals delete-summary">
        <div>
          <dt>ห้อง</dt>
          <dd>{invoice.roomNumber}</dd>
        </div>
        <div>
          <dt>รอบเดือน</dt>
          <dd>{formatBillingMonth(invoice.billingMonth)}</dd>
        </div>
        <div>
          <dt>ยอดรวม</dt>
          <dd>{formatBaht(invoice.totalAmountCents)}</dd>
        </div>
      </dl>

      <div className={fieldClass('field field-required', errors.reason)}>
        <label htmlFor="deleteReason">
          เหตุผลในการลบ <span className="required">* จำเป็น</span>
        </label>
        <textarea
          id="deleteReason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            clear('reason')
          }}
          {...invalidProps('deleteReason', errors.reason)}
          placeholder="เช่น ออกบิลผิดห้อง / ออกซ้ำ / ทดลองใช้งาน"
        />
        {errors.reason ? (
          <FieldError id="deleteReason-error" message={errors.reason} />
        ) : (
          !ready && <p className="field-hint">ต้องกรอกเหตุผลก่อนจึงจะลบได้</p>
        )}
      </div>
    </Modal>
  )
}

const STEPS = [
  { key: 'pick', label: 'เลือกวันจดมิเตอร์' },
  { key: 'create', label: 'สร้างใบแจ้งหนี้' }
]

function BillingWizard({ apartment, onClose }) {
  const [step, setStep] = useState(0)
  const [batches, setBatches] = useState([])
  const [batchId, setBatchId] = useState('')
  const [billingMonth, setBillingMonth] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const [preview, setPreview] = useState([])
  const [confirmDialog, ask] = useConfirm()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const res = await listMeterBatches(apartment.apartmentId)
      setLoading(false)
      if (!res.success) return setError(res.error)
      setBatches(res.data)
      if (res.data.length > 0) applyBatch(res.data[0])
    })()
  }, [apartment.apartmentId])

  const batch = batches.find((b) => String(b.batchId) === String(batchId))

  // วันออกบิลตั้งต้น = วันจดมิเตอร์ (หอจดและออกบิลวันเดียวกัน)
  function applyBatch(nextBatch) {
    setBatchId(String(nextBatch.batchId))
    setIssueDate(nextBatch.readingDate)
    setBillingMonth(billingMonthOf(nextBatch.readingDate))
  }

  // เดือนค่าเช่าเดินตามวันที่ออกบิล
  function changeIssueDate(next) {
    setIssueDate(next)
    if (next) setBillingMonth(billingMonthOf(next))
  }

  async function goToPreview() {
    if (!batch) return setError('กรุณาเลือกใบจดมิเตอร์')
    if (!billingMonth) return setError('กรุณาเลือกเดือนที่ต้องการออกบิล')
    if (!issueDate) return setError('กรุณาระบุวันที่ออกบิลให้ถูกต้อง')

    setError('')
    setBusy(true)
    const res = await previewMonthlyBilling({
      apartmentId: apartment.apartmentId,
      meterBatchId: batch.batchId,
      billingMonth
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    setPreview(res.data)
    setStep(1)
  }

  async function refreshPreview() {
    const res = await previewMonthlyBilling({
      apartmentId: apartment.apartmentId,
      meterBatchId: batch.batchId,
      billingMonth
    })
    if (res.success) setPreview(res.data)
  }

  async function createOne(row) {
    setError('')
    setBusy(true)
    const res = await createMonthlyInvoice({
      contractId: row.contractId,
      billingMonth,
      meterBatchId: batch.batchId,
      issueDate
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    showToast(`ออกบิลห้อง ${row.roomNumber} แล้ว (${res.data.invoiceNumber})`)
    refreshPreview()
  }

  // ถามยืนยันก่อนออกบิลทั้งหอ
  function confirmCreateAll() {
    ask({
      tone: 'primary',
      icon: 'invoices',
      title: `ออกใบแจ้งหนี้ ${pending.length} ห้อง?`,
      message: `ค่าเช่าเดือน ${formatBillingMonth(billingMonth)} · ออกบิลวันที่ ${formatDate(issueDate)} — ออกแล้วต้องยกเลิกทีละใบ`,
      confirmLabel: 'ออกใบแจ้งหนี้',
      busyLabel: 'กำลังออกบิล...',
      dismissLabel: 'ยังไม่ออก',
      onConfirm: createAll
    })
  }

  async function createAll() {
    setError('')
    setBusy(true)
    const res = await createMonthlyInvoicesForApartment({
      apartmentId: apartment.apartmentId,
      meterBatchId: batch.batchId,
      billingMonth,
      issueDate
    })
    setBusy(false)
    if (!res.success) return res

    const { created, skipped, failed } = res.data
    // รายงานทั้ง created / skipped / failed
    if (failed.length > 0) {
      setError(
        `ออกบิลไม่สำเร็จ ${failed.length} ห้อง:\n` +
          failed.map((f) => `ห้อง ${f.roomNumber}: ${f.message}`).join('\n')
      )
    }
    showToast(
      `ออกบิลแล้ว ${created.length} ห้อง` + (skipped.length > 0 ? ` · ข้าม ${skipped.length} ห้องที่ออกไปแล้ว` : ''),
      failed.length > 0 ? 'error' : 'success'
    )
    // สำเร็จครบ → กลับหน้ารายการ · มีห้องพัง → อยู่ต่อ
    if (failed.length > 0) refreshPreview()
    else onClose(billingMonth)
    return { success: true }
  }

  // ไม่นับห้องที่จ่ายค่าเช่าเดือนแรกแล้ว
  const pending = preview.filter((row) => !row.existingInvoiceId && !row.startsThisMonth)
  const unpriced = preview.filter((row) => row.unpricedSides?.length > 0 && !row.existingInvoiceId)

  return (
    <>
      {confirmDialog}
      <div className="page-back">
        <button type="button" className="link-btn" onClick={() => onClose()}>
          <Icon name="back" />
          <span>กลับไปรายการใบแจ้งหนี้</span>
        </button>
      </div>

      <div className="billing-steps">
        {STEPS.map((s, index) => (
          <button
            key={s.key}
            type="button"
            className={
              'billing-step' +
              (index === step ? ' current' : '') +
              (index < step ? ' done' : '') +
              (index > step ? ' future' : '')
            }
            onClick={() => index < step && setStep(index)}
            disabled={index > step}
          >
            <span className="wizard-step-number">{index + 1}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <section className="panel">
        <Alert>{error}</Alert>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : step === 0 ? (
          batches.length === 0 ? (
            <div className="empty-state">
              <p>ยังไม่มีใบจดมิเตอร์ · จดมิเตอร์ก่อนออกบิล</p>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="batchId">
                  วันที่จดมิเตอร์ <span className="required">* จำเป็น</span>
                  <InfoTip
                    title="ใบจดมิเตอร์ที่ใช้คิดเงิน"
                    points={[
                      'ค่าน้ำ/ค่าไฟคิดจากหน่วยที่จดในใบนี้',
                      'ห้องที่ยังไม่ได้จด คิดเป็น 0 หน่วย'
                    ]}
                  />
                </label>
                <select
                  id="batchId"
                  value={batchId}
                  onChange={(e) => {
                    const next = batches.find((b) => String(b.batchId) === e.target.value)
                    if (next) applyBatch(next)
                  }}
                >
                  {batches.map((b) => (
                    <option key={b.batchId} value={b.batchId}>
                      {formatDate(b.readingDate)} (จดแล้ว {b.roomCount} ห้อง)
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="issueDate">
                  วันที่ออกบิล <span className="required">* จำเป็น</span>
                  <InfoTip
                    title="วันที่ออกบิลมีผลกับ"
                    points={['เลขที่บิล', 'วันครบกำหนดชำระ', 'เดือนค่าเช่า']}
                  />
                </label>
                <DateField id="issueDate" value={issueDate} onChange={changeIssueDate} />
              </div>

              <div className="field">
                <label htmlFor="billingMonth">
                  ออกบิลค่าห้องของเดือน <span className="required">* จำเป็น</span>
                  <InfoTip
                    title="เดือนค่าเช่า"
                    points={[
                      'ระบบเลือกตามวันที่ออกบิลให้แล้ว',
                      'เปลี่ยนเฉพาะตอนออกบิลย้อนหลัง'
                    ]}
                  />
                </label>
                <select
                  id="billingMonth"
                  value={billingMonth}
                  onChange={(e) => setBillingMonth(e.target.value)}
                >
                  {monthOptions(issueDate).map((m) => (
                    <option key={m} value={m}>
                      {formatBillingMonth(m)}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  ค่าน้ำ-ค่าไฟเป็นของเดือน{' '}
                  <strong>{formatBillingMonth(utilityMonthOf(billingMonth))}</strong>
                </p>
              </div>

              <div className="card-foot">
                <button type="button" className="btn" onClick={goToPreview} disabled={busy}>
                  {busy ? 'กำลังคำนวณ...' : 'ต่อไป'}
                </button>
              </div>
            </>
          )
        ) : (
          <>
            <div className="panel-head-row">
              <h2 className="panel-title">
                ค่าเช่าเดือน {formatBillingMonth(billingMonth)} · ค่าน้ำ-ค่าไฟเดือน{' '}
                {formatBillingMonth(utilityMonthOf(billingMonth))} · ออกบิล{' '}
                {formatDate(issueDate)}
              </h2>
              <button
                type="button"
                className="btn"
                onClick={confirmCreateAll}
                disabled={busy || pending.length === 0}
              >
                {busy ? 'กำลังออกบิล...' : `สร้างใบแจ้งหนี้ทุกห้อง (${pending.length})`}
              </button>
            </div>

            {unpriced.length > 0 && (
              <Alert kind="warn">
                <strong>
                  ห้อง {unpriced.map((r) => r.roomNumber).join(', ')} ใช้น้ำ/ไฟจริงแต่คิดเงินไม่ได้
                </strong>
                <p>
                  ห้องเหล่านี้ยังไม่มีราคาค่าน้ำ/ค่าไฟของตัวเอง (ถูกสร้างไว้ก่อนตั้งราคา)
                  ออกบิลตอนนี้จะได้ 0 บาท — ไปที่ ตั้งค่า › ค่าน้ำ-ค่าไฟ แล้วกด
                  “นำไปใช้กับทุกห้อง” ก่อน แล้วกลับมาออกบิลใหม่
                </p>
              </Alert>
            )}

            {preview.length === 0 ? (
              <div className="empty-state">
                <p>ไม่มีห้องที่มีสัญญาใช้งานอยู่ในหอนี้ — ยังออกบิลไม่ได้</p>
              </div>
            ) : (
              <table className="data-table billing-table">
                <thead>
                  <tr>
                    <th>ห้อง</th>
                    <th>ค่าน้ำ</th>
                    <th>ค่าไฟ</th>
                    <th className="align-right">ยอดรวม</th>
                    <th className="align-right">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr key={row.contractId}>
                      <td>{row.roomNumber}</td>
                      <td>
                        <strong>{row.waterUnits}</strong> หน่วย
                        <span className="muted billing-charge">
                          {formatBaht(row.waterChargeCents)}
                        </span>
                      </td>
                      <td>
                        <strong>{row.electricUnits}</strong> หน่วย
                        <span className="muted billing-charge">
                          {formatBaht(row.electricChargeCents)}
                        </span>
                      </td>
                      {/* ไม่ออกบิลรอบนี้ — ไม่แสดงยอด */}
                      <td className="align-right">
                        {row.startsThisMonth && !row.existingInvoiceId ? (
                          <span className="muted">—</span>
                        ) : (
                          formatBaht(row.totalAmountCents)
                        )}
                      </td>
                      <td className="align-right">
                        {row.existingInvoiceId ? (
                          <span className="billing-done">
                            <Icon name="check" />
                            <span>{row.existingInvoiceNumber}</span>
                          </span>
                        ) : row.startsThisMonth ? (
                          <span className="muted billing-skip">ย้ายเข้าเดือนนี้ · จ่ายค่าเช่าแล้ว</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => createOne(row)}
                            disabled={busy}
                          >
                            สร้างใบแจ้งหนี้
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </>
  )
}

// เดือนค่าเช่า = เดือนของวันที่ออกบิล (บิล 1 ก.พ. = ค่าเช่า ก.พ. + น้ำไฟ ม.ค.)
function billingMonthOf(issueDate) {
  return String(issueDate ?? '').slice(0, 7)
}

// ต้องตรงกับ utilityMonthOf ใน main/db/invoices.js (ใช้แสดงผลเท่านั้น)
function utilityMonthOf(billingMonth) {
  if (!billingMonth) return ''
  const [year, month] = String(billingMonth).split('-').map(Number)
  if (!year || !month) return ''
  const previous = new Date(Date.UTC(year, month - 2, 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthOptions(issueDate) {
  const anchor = billingMonthOf(issueDate)
  if (!anchor) return []
  const [year, month] = anchor.split('-').map(Number)

  const list = []
  for (let offset = 1; offset >= -5; offset -= 1) {
    const date = new Date(year, month - 1 + offset, 1)
    list.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  }
  return list
}

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

// '2026-08' -> '08-2026'
function formatBillingMonth(month) {
  if (!month) return '-'
  const [y, m] = String(month).split('-')
  return `${m}-${y}`
}
