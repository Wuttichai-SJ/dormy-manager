import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import InfoTip from '../components/InfoTip.jsx'
import CancelReceiptDialog from '../components/CancelReceiptDialog.jsx'
import DateField from '../components/DateField.jsx'
import PrintDialog from '../components/PrintDialog.jsx'
import ReceiptDocument from '../components/ReceiptDocument.jsx'
import { showToast } from '../components/Toast.jsx'
import { formatBaht } from '../format.js'
import { exportCsv, revealExport } from '../services/exportService.js'
import { getInvoice } from '../services/invoiceService.js'
import { listReceipts } from '../services/paymentService.js'

// รวมใบเสร็จของสัญญาด้วย (เงินประกัน/ล่วงหน้า)
const CSV_COLUMNS = [
  { key: 'receiptNumber', label: 'เลขใบเสร็จ' },
  { key: 'paymentDate', label: 'วันที่' },
  { key: 'roomNumber', label: 'ห้อง' },
  { key: 'tenantName', label: 'ผู้เช่า' },
  { key: 'paymentMethodLabel', label: 'ช่องทาง' },
  { key: 'amountBaht', label: 'ยอดรับเงิน' },
  { key: 'sourceLabel', label: 'ประเภท' },
  { key: 'createdByName', label: 'ผู้รับเงิน' },
  // ส่งออกใบที่ยกเลิกด้วย แต่มีคอลัมน์บอก
  { key: 'statusLabel', label: 'สถานะ' },
  { key: 'cancelReason', label: 'เหตุผลที่ยกเลิก' },
  { key: 'remark', label: 'หมายเหตุ' }
]

export default function ReceiptsPage({ apartment, user }) {
  const [range, setRange] = useState(currentMonthRange)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [printing, setPrinting] = useState(false)
  const [invoicesById, setInvoicesById] = useState({})
  const [cancelling, setCancelling] = useState(null)

  // เตรียมเอกสารก่อนเปิดกล่องพิมพ์
  async function startPrinting() {
    setError('')
    setBusy(true)
    const ids = [...new Set(chosen.map((r) => r.invoiceId).filter(Boolean))]
    const results = await Promise.all(ids.map((id) => getInvoice(id)))
    setBusy(false)

    const failed = results.find((res) => !res.success)
    if (failed) return setError(failed.error)

    const map = {}
    results.forEach((res, index) => {
      map[ids[index]] = res.data
    })
    setInvoicesById(map)
    setPrinting(true)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listReceipts(apartment.apartmentId, {
      dateFrom: range.from || undefined,
      dateTo: range.to || undefined
    })
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setReport(res.data)
    // เปลี่ยนช่วงวันที่แล้วล้างรายการที่ติ๊กไว้
    setSelected(new Set())
  }, [apartment.apartmentId, range])

  useEffect(() => {
    load()
  }, [load])

  const receipts = report?.receipts ?? []
  const chosen = receipts.filter((r) => selected.has(r.paymentId))
  // ใบที่ยกเลิกติ๊กพิมพ์ไม่ได้
  const printable = receipts.filter((r) => !r.isCancelled)
  const allChecked = printable.length > 0 && chosen.length === printable.length

  function toggle(paymentId) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(paymentId)) next.delete(paymentId)
      else next.add(paymentId)
      return next
    })
  }

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(printable.map((r) => r.paymentId)))
  }

  async function exportToExcel() {
    setError('')
    setBusy(true)
    const res = await exportCsv({
      fileName: `ใบเสร็จรับเงิน ${range.from || 'ทั้งหมด'} ถึง ${range.to || 'ปัจจุบัน'}`,
      columns: CSV_COLUMNS,
      rows: receipts.map((r) => ({
        ...r,
        amountBaht: (r.amountCents / 100).toFixed(2),
        statusLabel: r.isCancelled ? 'ยกเลิกแล้ว' : 'ปกติ'
      }))
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    if (res.data.cancelled) return

    showToast(`ส่งออก ${res.data.rowCount} รายการแล้ว`)
    revealExport(res.data.filePath)
  }

  // ระหว่างพิมพ์แสดงแค่เอกสาร — printToPDF จับภาพหน้าที่แสดงอยู่
  if (printing) {
    return (
      <>
        <div className="receipt-sheets">
          {chosen.map((r) => (
            <ReceiptDocument
              key={r.paymentId}
              receipt={r}
              invoice={invoicesById[r.invoiceId] ?? null}
            />
          ))}
        </div>

        {/* ใบเสร็จ 2 ใบต่อแผ่น — maxPages = ครึ่งของจำนวนใบ */}
        <PrintDialog
          title={`พิมพ์ใบเสร็จ ${chosen.length} ใบ (${Math.ceil(chosen.length / 2)} แผ่น)`}
          maxPages={Math.ceil(chosen.length / 2)}
          onClose={() => setPrinting(false)}
          onPrinted={() => {
            setPrinting(false)
            showToast('ส่งใบเสร็จเข้าเครื่องพิมพ์แล้ว')
          }}
        />
      </>
    )
  }

  return (
    <>
      <section className="panel">
        <Alert>{error}</Alert>

        <div className="invoice-filters">
          <div className="field">
            <label htmlFor="receiptFrom">วันที่รับเงิน ตั้งแต่</label>
            <DateField
              id="receiptFrom"
              value={range.from}
              onChange={(v) => setRange((r) => ({ ...r, from: v }))}
            />
          </div>
          <div className="field">
            <label htmlFor="receiptTo">ถึง</label>
            <DateField
              id="receiptTo"
              value={range.to}
              onChange={(v) => setRange((r) => ({ ...r, to: v }))}
            />
          </div>

          <div className="field quick-ranges">
            <label>ตัวเลือกด่วน</label>
            <div className="quick-range-buttons">
              <button type="button" className="link-btn" onClick={() => setRange(lastDaysRange(7))}>
                7 วันล่าสุด
              </button>
              <button type="button" className="link-btn" onClick={() => setRange(currentMonthRange())}>
                เดือนปัจจุบัน
              </button>
              <button type="button" className="link-btn" onClick={() => setRange({ from: '', to: '' })}>
                ทั้งหมด
              </button>
            </div>
          </div>
        </div>

        {/* ยอดรวม = เงินที่เข้าหอจริง (หักใบคืนเงิน ไม่นับใบที่ยกเลิก) */}
        <div className="room-stats">
          <div className="stat-card">
            <div className="stat-card-value">{report?.receiptCount ?? 0}</div>
            <div className="stat-card-label">จำนวนใบเสร็จ</div>
          </div>
          {(report?.cancelledCount ?? 0) > 0 && (
            <div className="stat-card">
              <div className="stat-card-value">{report.cancelledCount}</div>
              <div className="stat-card-label">ยกเลิกแล้ว (ไม่นับในยอด)</div>
            </div>
          )}
          <div className="stat-card highlight">
            <div className="stat-card-value">{formatBaht(report?.totalAmountCents ?? 0)}</div>
            <div className="stat-card-label">ยอดรับเงินสุทธิ (บาท)</div>
          </div>
        </div>

        <div className="panel-head-row">
          <h2 className="panel-title">
            ใบเสร็จรับเงิน
            <InfoTip
              title="รายงานใบเสร็จ"
              points={[
                'รวมเงินจากใบแจ้งหนี้และจากสัญญา (เงินประกัน/เงินล่วงหน้า)',
                'ใบคืนเงินเป็นยอดติดลบ หักออกจากยอดรวมแล้ว'
              ]}
            />
          </h2>
          <div className="receipt-actions">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={startPrinting}
              disabled={busy || chosen.length === 0}
            >
              <Icon name="printer" />
              <span>พิมพ์ ({chosen.length})</span>
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={exportToExcel}
              disabled={busy || receipts.length === 0}
            >
              <Icon name="download" />
              <span>{busy ? 'กำลังส่งออก...' : 'Excel'}</span>
            </button>
          </div>
        </div>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : receipts.length === 0 ? (
          <p className="muted table-empty">ไม่มีใบเสร็จในช่วงวันที่ที่เลือก</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="receipt-check">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="เลือกทั้งหมด"
                  />
                </th>
                <th className="invoice-col-no">#</th>
                <th>เลขใบเสร็จ</th>
                <th>วันที่</th>
                <th>ห้อง</th>
                <th>ช่องทาง</th>
                <th className="align-right">ยอดรับเงิน</th>
                <th>ประเภท</th>
                <th>ผู้รับเงิน</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r, index) => (
                <tr
                  key={r.paymentId}
                  className={
                    (r.isRefund ? 'receipt-row-refund ' : '') +
                    (r.isCancelled ? 'receipt-row-cancelled' : '')
                  }
                >
                  <td className="receipt-check">
                    <input
                      type="checkbox"
                      checked={selected.has(r.paymentId)}
                      onChange={() => toggle(r.paymentId)}
                      disabled={r.isCancelled}
                      aria-label={`เลือกใบเสร็จ ${r.receiptNumber}`}
                    />
                  </td>
                  <td className="invoice-col-no">{index + 1}</td>
                  <td>{r.receiptNumber}</td>
                  <td>{formatDate(r.paymentDate)}</td>
                  <td>{r.roomNumber ?? '-'}</td>
                  <td>{r.paymentMethodLabel}</td>
                  <td className="align-right">
                    <span className={r.isRefund ? 'negative' : undefined}>
                      {formatBaht(r.amountCents)}
                    </span>
                  </td>
                  <td>{r.sourceLabel}</td>
                  <td>{r.createdByName ?? '-'}</td>
                  <td className="align-right">
                    {r.isCancelled ? (
                      <span className="receipt-cancelled-tag" title={r.cancelReason ?? ''}>
                        ยกเลิกแล้ว
                      </span>
                    ) : (
                      // เฉพาะเจ้าของหอ
                      user?.isOwner && (
                        <button
                          type="button"
                          className="link-btn link-danger"
                          onClick={() => setCancelling(r)}
                        >
                          ยกเลิก
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {cancelling && (
        <CancelReceiptDialog
          receipt={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={(result) => {
            setCancelling(null)
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

function iso(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function currentMonthRange() {
  const now = new Date()
  return {
    from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  }
}

function lastDaysRange(days) {
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - (days - 1))
  return { from: iso(start), to: iso(now) }
}

function formatDate(value) {
  if (!value) return '-'
  const [y, m, d] = String(value).split('-')
  return `${d}/${m}/${y}`
}
