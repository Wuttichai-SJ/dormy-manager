import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import DateField from '../components/DateField.jsx'
import PrintDialog from '../components/PrintDialog.jsx'
import ReceiptDocument from '../components/ReceiptDocument.jsx'
import { showToast } from '../components/Toast.jsx'
import { formatBaht } from '../format.js'
import { exportCsv, revealExport } from '../services/exportService.js'
import { listReceipts } from '../services/paymentService.js'

// รายงานใบเสร็จรับเงิน — โครงตามหน้า "รายงาน › ใบเสร็จรับเงิน" ของต้นแบบ:
// ช่วงวันที่รับเงิน + ตัวเลือกด่วน · การ์ดสรุป · ตารางที่ติ๊กเลือกเพื่อพิมพ์ได้ · ปุ่มส่งออก
//
// รายงานนี้ตอบคำถามเดียว: "ช่วงนี้หอได้เงินเข้ามาเท่าไหร่ จากใครบ้าง"
// จึงรวมใบเสร็จของ *สัญญา* (เงินประกัน/เงินล่วงหน้า) ไว้ด้วย ไม่ใช่เฉพาะที่มาจากบิล
// — เงินก้อนนั้นก็เข้าหอจริงเหมือนกัน ถ้าตัดออกรายงานจะไม่ตรงกับยอดในบัญชีธนาคาร
const CSV_COLUMNS = [
  { key: 'receiptNumber', label: 'เลขใบเสร็จ' },
  { key: 'paymentDate', label: 'วันที่' },
  { key: 'roomNumber', label: 'ห้อง' },
  { key: 'tenantName', label: 'ผู้เช่า' },
  { key: 'paymentMethodLabel', label: 'ช่องทาง' },
  { key: 'amountBaht', label: 'ยอดรับเงิน' },
  { key: 'sourceLabel', label: 'ประเภท' },
  { key: 'createdByName', label: 'ผู้รับเงิน' },
  { key: 'remark', label: 'หมายเหตุ' }
]

export default function ReceiptsPage({ apartment }) {
  const [range, setRange] = useState(currentMonthRange)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // paymentId ที่ติ๊กไว้ — Set เพื่อให้เช็ค/สลับได้เร็วโดยไม่ต้องไล่อาร์เรย์
  const [selected, setSelected] = useState(() => new Set())
  const [printing, setPrinting] = useState(false)

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
    // เปลี่ยนช่วงวันที่แล้วรายการที่ติ๊กไว้อาจไม่อยู่ในผลลัพธ์ใหม่ ล้างทิ้งเสมอ
    // ไม่งั้นปุ่ม "พิมพ์ (3)" จะนับใบที่มองไม่เห็นอยู่บนจอ
    setSelected(new Set())
  }, [apartment.apartmentId, range])

  useEffect(() => {
    load()
  }, [load])

  const receipts = report?.receipts ?? []
  const chosen = receipts.filter((r) => selected.has(r.paymentId))
  const allChecked = receipts.length > 0 && chosen.length === receipts.length

  function toggle(paymentId) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(paymentId)) next.delete(paymentId)
      else next.add(paymentId)
      return next
    })
  }

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(receipts.map((r) => r.paymentId)))
  }

  async function exportToExcel() {
    setError('')
    setBusy(true)
    const res = await exportCsv({
      fileName: `ใบเสร็จรับเงิน ${range.from || 'ทั้งหมด'} ถึง ${range.to || 'ปัจจุบัน'}`,
      columns: CSV_COLUMNS,
      // แปลงสตางค์เป็นบาทก่อนส่งออก เพื่อให้ Excel บวกลบในไฟล์ได้ตรงกับที่เห็นบนจอ
      rows: receipts.map((r) => ({ ...r, amountBaht: (r.amountCents / 100).toFixed(2) }))
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    if (res.data.cancelled) return

    showToast(`ส่งออก ${res.data.rowCount} รายการแล้ว`)
    revealExport(res.data.filePath)
  }

  // ระหว่างพิมพ์ หน้าจอแสดงเฉพาะใบเสร็จที่เลือก เพราะ printToPDF จับภาพหน้าที่กำลังแสดงอยู่
  // (กล่องพิมพ์เองถูกซ่อนด้วย @media print อยู่แล้ว)
  if (printing) {
    return (
      <>
        <div className="receipt-sheets">
          {chosen.map((r) => (
            <ReceiptDocument key={r.paymentId} receipt={r} />
          ))}
        </div>

        <PrintDialog
          title={`พิมพ์ใบเสร็จ ${chosen.length} ใบ`}
          maxPages={chosen.length}
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
      <div className="info-banner">
        <strong>รายงานใบเสร็จรับเงิน</strong>
        <p>
          เงินที่รับเข้ามาทั้งหมดของหอ ทั้งจากใบแจ้งหนี้และจากสัญญา (เงินประกัน/เงินล่วงหน้า) ·
          ใบคืนเงินแสดงเป็นยอดติดลบและถูกหักออกจากยอดรวมแล้ว
        </p>
      </div>

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

          {/* ตัวเลือกด่วนตามต้นแบบ — ช่วงที่ถูกถามบ่อยที่สุดไม่ควรต้องกรอกวันที่เอง */}
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

        {/* ยอดรวมคือ "เงินที่เข้าหอจริง" — หักใบคืนเงินออกแล้ว ไม่ใช่ผลบวกของใบที่ออก */}
        <div className="room-stats">
          <div className="stat-card">
            <div className="stat-card-value">{report?.receiptCount ?? 0}</div>
            <div className="stat-card-label">จำนวนใบเสร็จ</div>
          </div>
          <div className="stat-card highlight">
            <div className="stat-card-value">{formatBaht(report?.totalAmountCents ?? 0)}</div>
            <div className="stat-card-label">ยอดรับเงินสุทธิ (บาท)</div>
          </div>
        </div>

        <div className="panel-head-row">
          <h2 className="panel-title">ใบเสร็จรับเงิน</h2>
          <div className="receipt-actions">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setPrinting(true)}
              disabled={chosen.length === 0}
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
              </tr>
            </thead>
            <tbody>
              {receipts.map((r, index) => (
                <tr key={r.paymentId} className={r.isRefund ? 'receipt-row-refund' : undefined}>
                  <td className="receipt-check">
                    <input
                      type="checkbox"
                      checked={selected.has(r.paymentId)}
                      onChange={() => toggle(r.paymentId)}
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
