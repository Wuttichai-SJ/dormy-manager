import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Alert from '../components/Alert.jsx'
import { formatBaht } from '../format.js'
import { listReceipts } from '../services/paymentService.js'

// รายงานใบเสร็จรับเงิน — โครงตามต้นแบบ: กรองตามเดือน + การ์ดสรุป + ตาราง
//
// รายงานนี้ตอบคำถามเดียว: "เดือนนี้หอได้เงินเข้ามาเท่าไหร่ จากใครบ้าง"
// จึงรวมใบเสร็จของ *สัญญา* (เงินประกัน/เงินล่วงหน้า) ไว้ด้วย ไม่ใช่เฉพาะที่มาจากบิล
// — เงินก้อนนั้นก็เข้าหอจริงเหมือนกัน
export default function ReceiptsPage({ apartment }) {
  const [month, setMonth] = useState(currentMonth())
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listReceipts(apartment.apartmentId, month || undefined)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setReport(res.data)
  }, [apartment.apartmentId, month])

  useEffect(() => {
    load()
  }, [load])

  // ตัวเลือกเดือน 12 เดือนล่าสุด — พอสำหรับงานประจำวัน และยังเลือก "ทุกเดือน" เพื่อดูทั้งหมดได้
  const months = useMemo(() => recentMonths(12), [])
  const receipts = report?.receipts ?? []

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
            <label htmlFor="receiptMonth">เดือน</label>
            <select id="receiptMonth" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">ทุกเดือน</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
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

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : receipts.length === 0 ? (
          <p className="muted table-empty">
            {month ? `ไม่มีใบเสร็จในเดือน ${formatMonth(month)}` : 'ยังไม่มีใบเสร็จ'}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
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
function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function recentMonths(count) {
  const now = new Date()
  const list = []
  for (let i = 0; i < count; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    list.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  }
  return list
}

// '2026-08' -> '08-2026' ให้ตรงกับรูปแบบที่ใช้บนใบแจ้งหนี้
function formatMonth(month) {
  const [y, m] = String(month).split('-')
  return `${m}-${y}`
}

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}
