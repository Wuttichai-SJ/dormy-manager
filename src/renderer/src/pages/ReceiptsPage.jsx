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
  // ใบที่ยกเลิกออกไปในไฟล์ด้วย แต่ต้องมีคอลัมน์บอก ไม่งั้นคนที่เปิดไฟล์ใน Excel
  // จะรวมยอดทั้งคอลัมน์แล้วได้ตัวเลขที่ไม่ตรงกับที่หอรับมาจริง
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
  // paymentId ที่ติ๊กไว้ — Set เพื่อให้เช็ค/สลับได้เร็วโดยไม่ต้องไล่อาร์เรย์
  const [selected, setSelected] = useState(() => new Set())
  const [printing, setPrinting] = useState(false)
  // บิลของใบเสร็จที่เลือกไว้ ดึงมาตอนกดพิมพ์เท่านั้น — ตารางรายงานไม่ได้ใช้
  const [invoicesById, setInvoicesById] = useState({})
  // ใบเสร็จที่กำลังจะยกเลิก (null = ไม่ได้เปิดหน้าต่าง)
  const [cancelling, setCancelling] = useState(null)

  // เตรียมเอกสารก่อนเปิดกล่องพิมพ์ ไม่ใช่ระหว่างที่กล่องเปิดอยู่ — ถ้าดึงทีหลัง
  // printToPDF อาจจับภาพตอนที่เอกสารยังไม่มีรายการ แล้วได้ใบเสร็จเปล่า
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
    // เปลี่ยนช่วงวันที่แล้วรายการที่ติ๊กไว้อาจไม่อยู่ในผลลัพธ์ใหม่ ล้างทิ้งเสมอ
    // ไม่งั้นปุ่ม "พิมพ์ (3)" จะนับใบที่มองไม่เห็นอยู่บนจอ
    setSelected(new Set())
  }, [apartment.apartmentId, range])

  useEffect(() => {
    load()
  }, [load])

  const receipts = report?.receipts ?? []
  const chosen = receipts.filter((r) => selected.has(r.paymentId))
  // ใบที่ยกเลิกแล้วติ๊กเพื่อพิมพ์ไม่ได้ — พิมพ์ออกมาก็เป็นเอกสารที่ไม่มีผลแล้ว
  // ถ้ายื่นให้ผู้เช่าจะกลายเป็นหลักฐานการรับเงินที่ไม่เคยเกิดขึ้น
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
      // แปลงสตางค์เป็นบาทก่อนส่งออก เพื่อให้ Excel บวกลบในไฟล์ได้ตรงกับที่เห็นบนจอ
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

  // ระหว่างพิมพ์ หน้าจอแสดงเฉพาะใบเสร็จที่เลือก เพราะ printToPDF จับภาพหน้าที่กำลังแสดงอยู่
  // (กล่องพิมพ์เองถูกซ่อนด้วย @media print อยู่แล้ว)
  if (printing) {
    return (
      <>
        <div className="receipt-sheets">
          {chosen.map((r) => (
            <ReceiptDocument
              key={r.paymentId}
              receipt={r}
              // ใบเสร็จของบิลแสดงรายการของบิลใบนั้น จึงต้องดึงบิลมาด้วย
              // ใบเสร็จของสัญญาไม่มีบิล ส่ง null ไป ReceiptDocument ประกอบเอกสารเอง
              invoice={invoicesById[r.invoiceId] ?? null}
            />
          ))}
        </div>

        {/* ใบเสร็จเป็น A5 แนวนอน **สองใบต่อกระดาษหนึ่งแผ่น** จำนวนหน้าที่เอกสารควรมี
            จึงเป็นครึ่งหนึ่งของจำนวนใบ ไม่ใช่เท่ากัน — ถ้าส่งจำนวนใบไปตรงๆ ตัวย่อ
            ฝั่ง main จะคิดว่ายังไม่ล้น ทั้งที่ล้นไปแผ่นละใบแล้ว */}
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

        {/* ยอดรวมคือ "เงินที่เข้าหอจริง" — หักใบคืนเงินออกแล้ว ไม่นับใบที่ยกเลิก
            ไม่ใช่ผลบวกของใบที่ออก */}
        <div className="room-stats">
          <div className="stat-card">
            <div className="stat-card-value">{report?.receiptCount ?? 0}</div>
            <div className="stat-card-label">จำนวนใบเสร็จ</div>
          </div>
          {/* การ์ดนี้โผล่เฉพาะตอนมีใบที่ยกเลิกจริง — ช่องว่างที่เขียน 0 ค้างไว้ทุกเดือน
              ทำให้คนอ่านชินตาจนไม่เห็นตอนที่มันขึ้นเป็นเลขจริง */}
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
                      // เหตุผลอยู่ใน title ไม่ได้กางบนตาราง — คอลัมน์นี้แคบ และคนที่เข้ามา
                      // อ่านรายงานส่วนใหญ่มาดูยอด ไม่ได้มาสอบสวนใบที่ยกเลิก
                      <span className="receipt-cancelled-tag" title={r.cancelReason ?? ''}>
                        ยกเลิกแล้ว
                      </span>
                    ) : (
                      // ยกเลิกใบเสร็จ = เจ้าของหอเท่านั้น (main บังคับที่ payment:cancel)
                      // พนักงานไม่เห็นปุ่มนี้เลย ดีกว่าให้กดแล้วเจอข้อความปฏิเสธ
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
