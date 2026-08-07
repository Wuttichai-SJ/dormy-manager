import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { showToast } from '../components/Toast.jsx'
import { INVOICE_STATUS_LABELS } from '../constants.js'
import { formatBaht } from '../format.js'
import InvoiceDetailPage from './InvoiceDetailPage.jsx'
import { listMeterBatches } from '../services/meterService.js'
import {
  createMonthlyInvoice,
  createMonthlyInvoicesForApartment,
  listInvoices,
  previewMonthlyBilling
} from '../services/invoiceService.js'

// หน้าใบแจ้งหนี้ — รายการบิลที่ออกไปแล้ว + ทางเข้าไปออกบิลรอบใหม่
//
// โครงตามต้นแบบ (คู่มือ yeeraf หัวข้อ "ออกบิลรายเดือน"): กดปุ่มออกบิล → ตัวช่วย 2 ขั้น
// (เลือกใบจดมิเตอร์+เดือน → ตารางพรีวิวทุกห้องแล้วกดสร้าง) ไม่ใช่กรอกทีละห้องเอง
export default function InvoicesPage({ apartment }) {
  const [wizard, setWizard] = useState(false)
  // บิลที่กำลังเปิดดูอยู่ — null = อยู่ที่ตารางรายการ
  const [openInvoiceId, setOpenInvoiceId] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [roomFilter, setRoomFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listInvoices(apartment.apartmentId, {
      roomNumber: roomFilter.trim() || undefined
    })
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setInvoices(res.data)
  }, [apartment.apartmentId, roomFilter])

  useEffect(() => {
    load()
  }, [load])

  if (openInvoiceId) {
    return (
      <InvoiceDetailPage
        invoiceId={openInvoiceId}
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

        <div className="field invoice-filter">
          <label htmlFor="invoiceRoomFilter">ค้นหาเลขห้อง</label>
          <input
            id="invoiceRoomFilter"
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
            placeholder="เช่น 101"
          />
        </div>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : invoices.length === 0 ? (
          <p className="muted table-empty">ยังไม่มีใบแจ้งหนี้</p>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
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
