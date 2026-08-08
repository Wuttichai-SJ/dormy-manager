import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import Modal from '../components/Modal.jsx'
import DateField from '../components/DateField.jsx'
import { showToast } from '../components/Toast.jsx'
import { INVOICE_STATUS_LABELS } from '../constants.js'
import { formatBaht } from '../format.js'
import InvoiceDetailPage from './InvoiceDetailPage.jsx'
import { listMeterBatches } from '../services/meterService.js'
import {
  createMonthlyInvoice,
  createMonthlyInvoicesForApartment,
  deleteInvoice,
  listInvoices,
  previewMonthlyBilling
} from '../services/invoiceService.js'

const EMPTY_FILTERS = { roomNumber: '', invoiceNumber: '', dateFrom: '', dateTo: '' }

// หน้าใบแจ้งหนี้ — รายการบิลที่ออกไปแล้ว + ทางเข้าไปออกบิลรอบใหม่
//
// โครงตามต้นแบบ (คู่มือ yeeraf หัวข้อ "ออกบิลรายเดือน"): กดปุ่มออกบิล → ตัวช่วย 2 ขั้น
// (เลือกใบจดมิเตอร์+เดือน → ตารางพรีวิวทุกห้องแล้วกดสร้าง) ไม่ใช่กรอกทีละห้องเอง
export default function InvoicesPage({ apartment, user }) {
  const [wizard, setWizard] = useState(false)
  // บิลที่กำลังเปิดดูอยู่ — null = อยู่ที่ตารางรายการ
  const [openInvoiceId, setOpenInvoiceId] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // บิลที่กำลังยืนยันจะลบอยู่ — null = ไม่มีหน้าต่างเปิดค้าง
  const [deleting, setDeleting] = useState(null)

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const hasFilters = Object.values(filters).some((v) => v !== '')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listInvoices(apartment.apartmentId, {
      roomNumber: filters.roomNumber.trim() || undefined,
      invoiceNumber: filters.invoiceNumber.trim() || undefined,
      // DateField คืน '' จนกว่าจะกรอกวันที่ครบและเป็นวันที่ที่มีอยู่จริง จึงส่งต่อได้เลย
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined
    })
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setInvoices(res.data)
  }, [apartment.apartmentId, filters])

  useEffect(() => {
    load()
  }, [load])

  if (openInvoiceId) {
    return (
      <InvoiceDetailPage
        invoiceId={openInvoiceId}
        signedBy={user?.fullName}
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
        onClose={() => {
          setWizard(false)
          load()
        }}
      />
    )
  }

  return (
    <>
      <div className="info-banner">
        <strong>ใบแจ้งหนี้</strong>
        <p>
          บิลรายเดือนออกจากใบจดมิเตอร์หนึ่งใบ ครั้งเดียวได้ทั้งหอ — หนึ่งสัญญาออกบิลได้เดือนละใบ
        </p>
      </div>

      <section className="panel">
        <Alert>{error}</Alert>

        <div className="panel-head-row">
          <h2 className="panel-title">รายการใบแจ้งหนี้</h2>
          <button type="button" className="btn" onClick={() => setWizard(true)}>
            <Icon name="plus" />
            <span>ออกบิลรายเดือน</span>
          </button>
        </div>

        {/* แถบค้นหาเรียงตามต้นแบบ: เลขที่ห้อง | เลขที่ใบแจ้งหนี้ | วันที่เริ่ม | วันที่สิ้นสุด | รีเซ็ต
            ช่วงวันที่ใส่ข้างเดียวก็ได้ — ระบุแต่วันเริ่มคือ "ตั้งแต่วันนั้นเป็นต้นไป" */}
        <div className="invoice-filters">
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

          <div className="field">
            <label htmlFor="filterFrom">วันที่ออกบิล ตั้งแต่</label>
            <DateField
              id="filterFrom"
              value={filters.dateFrom}
              onChange={(v) => setFilter('dateFrom', v)}
            />
          </div>

          <div className="field">
            <label htmlFor="filterTo">ถึง</label>
            <DateField
              id="filterTo"
              value={filters.dateTo}
              onChange={(v) => setFilter('dateTo', v)}
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

        {/* ช่วงวันที่กลับหัวไม่เจออะไรเลย ต้องบอกว่าเป็นเพราะอะไร ไม่ใช่ขึ้น "ไม่มีข้อมูล" เฉยๆ */}
        {filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo && (
          <Alert kind="warn">วันที่เริ่มอยู่หลังวันที่สิ้นสุด จึงไม่มีใบแจ้งหนี้ใดเข้าเงื่อนไข</Alert>
        )}

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : invoices.length === 0 ? (
          <p className="muted table-empty">
            {hasFilters ? 'ไม่พบใบแจ้งหนี้ตามเงื่อนไขที่ค้นหา' : 'ยังไม่มีใบแจ้งหนี้'}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>วันที่</th>
                <th>ห้อง</th>
                <th>รอบเดือน</th>
                <th>สถานะ</th>
                <th className="align-right">ยอดรวม</th>
                <th className="align-right">ค้างชำระ</th>
                <th className="align-right" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.invoiceId}>
                  <td>{inv.invoiceNumber}</td>
                  <td>{formatDate(inv.issueDate)}</td>
                  <td>{inv.roomNumber}</td>
                  <td>{formatBillingMonth(inv.billingMonth)}</td>
                  <td>
                    <span className={`invoice-status invoice-${inv.status}`}>
                      {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
                    {/* เกินกำหนดกี่วัน — หอต้องรู้ว่าใครค้างนานแค่ไหน ไม่ว่าจะเก็บค่าปรับหรือไม่ */}
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
                    {/* ลบได้เฉพาะใบที่ยกเลิกแล้ว — ใบที่ยังใช้งานอยู่ต้องยกเลิกก่อน
                        เป็นด่านที่บังคับให้ตัดสินใจสองครั้งก่อนเอกสารการเงินจะหายไป */}
                    {inv.status === 'cancelled' && (
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
          onError={setError}
        />
      )}
    </>
  )
}

// หน้าต่างยืนยันการลบ — เหตุผลบังคับกรอกเสมอ (ผู้ใช้สั่ง 2026-08-07)
//
// ปุ่มลบถูกปิดไว้จนกว่าจะพิมพ์เหตุผล ไม่ใช่ปล่อยให้กดแล้วค่อยขึ้น error — คนที่ตั้งใจ
// จะลบจริงจะได้รู้ตั้งแต่เห็นหน้าต่างว่าต้องเขียนอะไรสักอย่างก่อน
function DeleteInvoiceDialog({ invoice, onClose, onDeleted, onError }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = reason.trim().length > 0

  async function submit() {
    if (!ready) return
    onError('')
    setBusy(true)
    const res = await deleteInvoice(invoice.invoiceId, reason)
    setBusy(false)
    if (!res.success) return onError(res.error)
    onDeleted()
  }

  return (
    <Modal
      title={`ลบใบแจ้งหนี้ ${invoice.invoiceNumber}`}
      icon="trash"
      submitLabel="ลบถาวร"
      busy={busy || !ready}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert kind="warn">
        ใบแจ้งหนี้และรายการทั้งหมดในใบจะถูกลบออกจากระบบถาวร กู้คืนไม่ได้ —
        เลขที่ {invoice.invoiceNumber} จะไม่ถูกนำไปใช้ซ้ำ และเหตุผลที่กรอกจะถูกเก็บไว้ในประวัติการลบ
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

      <div className="field field-required">
        <label htmlFor="deleteReason">
          เหตุผลในการลบ <span className="required">* จำเป็น</span>
        </label>
        <textarea
          id="deleteReason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เช่น ออกบิลผิดห้อง / ออกซ้ำ / ทดลองใช้งาน"
        />
        {!ready && <p className="field-hint">ต้องกรอกเหตุผลก่อนจึงจะลบได้</p>}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// ตัวช่วยออกบิล 2 ขั้น
// ------------------------------------------------------------------
const STEPS = [
  { key: 'pick', label: 'เลือกวันจดมิเตอร์' },
  { key: 'create', label: 'สร้างใบแจ้งหนี้' }
]

function BillingWizard({ apartment, onClose }) {
  const [step, setStep] = useState(0)
  const [batches, setBatches] = useState([])
  const [batchId, setBatchId] = useState('')
  const [billingMonth, setBillingMonth] = useState('')
  const [preview, setPreview] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const res = await listMeterBatches(apartment.apartmentId)
      setLoading(false)
      if (!res.success) return setError(res.error)
      setBatches(res.data)
      // ใบจดล่าสุดคือใบที่จะออกบิลเกือบทุกครั้ง เลือกให้เลยจะได้ไม่ต้องกดซ้ำ
      if (res.data.length > 0) {
        setBatchId(String(res.data[0].batchId))
        setBillingMonth(res.data[0].readingDate.slice(0, 7))
      }
    })()
  }, [apartment.apartmentId])

  const batch = batches.find((b) => String(b.batchId) === String(batchId))

  async function goToPreview() {
    if (!batch) return setError('กรุณาเลือกใบจดมิเตอร์')
    if (!billingMonth) return setError('กรุณาเลือกเดือนที่ต้องการออกบิล')

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
      issueDate: batch.readingDate
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    showToast(`ออกบิลห้อง ${row.roomNumber} แล้ว (${res.data.invoiceNumber})`)
    refreshPreview()
  }

  async function createAll() {
    setError('')
    setBusy(true)
    const res = await createMonthlyInvoicesForApartment({
      apartmentId: apartment.apartmentId,
      meterBatchId: batch.batchId,
      billingMonth,
      issueDate: batch.readingDate
    })
    setBusy(false)
    if (!res.success) return setError(res.error)

    const { created, skipped, failed } = res.data
    // ต้องรายงานทั้งสามกอง ไม่ใช่บอกแค่ "สำเร็จ" — ห้องที่ข้ามกับห้องที่พังคนละเรื่องกัน
    // และห้องที่พังต้องเห็นว่าเป็นห้องไหนเพราะอีกสี่สิบห้องออกไปแล้ว
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
    refreshPreview()
  }

  const pending = preview.filter((row) => !row.existingInvoiceId)
  const unpriced = preview.filter((row) => row.unpricedSides?.length > 0 && !row.existingInvoiceId)

  return (
    <>
      <div className="page-back">
        <button type="button" className="link-btn" onClick={onClose}>
          <Icon name="back" />
          <span>กลับไปรายการใบแจ้งหนี้</span>
        </button>
      </div>

      {/* แถบขั้นตอนแนวนอนตามต้นแบบ — ขั้นที่ผ่านแล้วกดย้อนกลับได้ ขั้นที่ยังไม่ถึงกดไม่ได้ */}
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
              <p>ยังไม่มีใบจดมิเตอร์ — ต้องจดมิเตอร์ก่อนจึงจะออกบิลรายเดือนได้</p>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="batchId">
                  วันที่จดมิเตอร์ <span className="required">* จำเป็น</span>
                </label>
                <select id="batchId" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                  {batches.map((b) => (
                    <option key={b.batchId} value={b.batchId}>
                      {formatDate(b.readingDate)} (จดแล้ว {b.roomCount} ห้อง)
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  ค่าน้ำ/ค่าไฟในบิลจะคิดจากหน่วยที่จดไว้ในใบนี้ · ห้องที่ยังไม่ได้จดจะคิดเป็น 0 หน่วย
                </p>
              </div>

              <div className="field">
                <label htmlFor="billingMonth">
                  ออกบิลค่าห้องของเดือน <span className="required">* จำเป็น</span>
                </label>
                <select
                  id="billingMonth"
                  value={billingMonth}
                  onChange={(e) => setBillingMonth(e.target.value)}
                >
                  {monthOptions(batch?.readingDate).map((m) => (
                    <option key={m} value={m}>
                      {formatBillingMonth(m)}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  ค่าเช่าห้องที่จะขึ้นบนบิลเป็นของเดือนนี้ ไม่จำเป็นต้องตรงกับเดือนที่จดมิเตอร์
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
                รอบเดือน {formatBillingMonth(billingMonth)} · จดมิเตอร์ {formatDate(batch?.readingDate)}
              </h2>
              <button
                type="button"
                className="btn"
                onClick={createAll}
                disabled={busy || pending.length === 0}
              >
                {busy ? 'กำลังออกบิล...' : `สร้างใบแจ้งหนี้ทุกห้อง (${pending.length})`}
              </button>
            </div>

            {/* ห้องที่ใช้น้ำ/ไฟจริงแต่ไม่มีราคาให้คิด — ถ้าไม่บอกตรงนี้ บิล 0 บาทจะหลุดไปถึง
                มือผู้เช่าโดยไม่มีใครสังเกต (เกิดกับห้องที่ถูกสร้างก่อนหอจะตั้งราคาค่าน้ำ/ค่าไฟ) */}
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
                      <td className="align-right">{formatBaht(row.totalAmountCents)}</td>
                      <td className="align-right">
                        {row.existingInvoiceId ? (
                          <span className="billing-done">
                            <Icon name="check" />
                            <span>{row.existingInvoiceNumber}</span>
                          </span>
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

            <div className="card-foot">
              <button type="button" className="btn btn-outline" onClick={onClose}>
                เสร็จสิ้น
              </button>
            </div>
          </>
        )}
      </section>
    </>
  )
}

// ------------------------------------------------------------------
// ตัวเลือกเดือนที่ออกบิล — เดือนของใบจดเป็นหลัก แล้วให้เลือกย้อนหลังได้อีก 5 เดือน
// กับล่วงหน้า 1 เดือน (หอที่เก็บค่าเช่าล่วงหน้าจะออกบิลของเดือนถัดไป)
function monthOptions(readingDate) {
  if (!readingDate) return []
  const [year, month] = readingDate.split('-').map(Number)

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

// '2026-08' -> '08-2026' ตามที่ต้นแบบขึ้นบนบิลและในตัวเลือก
function formatBillingMonth(month) {
  if (!month) return '-'
  const [y, m] = String(month).split('-')
  return `${m}-${y}`
}
