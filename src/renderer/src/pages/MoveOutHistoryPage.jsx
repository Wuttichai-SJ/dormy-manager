import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import DateField from '../components/DateField.jsx'
import Modal from '../components/Modal.jsx'
import MoveOutDocument from '../components/MoveOutDocument.jsx'
import PrintDialog from '../components/PrintDialog.jsx'
import { showToast } from '../components/Toast.jsx'
import { PAYMENT_METHODS } from '../constants.js'
import { centsToInput, formatBaht } from '../format.js'
import { revealPdf, savePdf } from '../services/printService.js'
import {
  collectShortfall,
  getTermination,
  listTerminations
} from '../services/terminationService.js'

// ประวัติการย้ายออก — ผู้เช่าที่ย้ายออกไปแล้วทั้งหมดของหอ
//
// ต้นแบบเก็บผู้เช่าเก่าไว้ให้เปิดดูย้อนหลังได้เสมอ ส่วนของเราพอกดยืนยันย้ายออกแล้ว
// ห้องกลับไปเป็นห้องว่าง และคนที่เพิ่งออกไปก็หายจากทุกหน้าจอ ทั้งที่ข้อมูลยังอยู่ครบ —
// เจ้าของหอไม่มีทางกลับไปดูว่าคืนเงินประกันไปเท่าไหร่ หรือริบเพราะอะไร
//
// **หน้านี้ยังเป็นที่เดียวที่จะไปถึงยอด "ยังเก็บไม่ได้" ของการย้ายออกเก่าๆ ด้วย** —
// ตอนย้ายออกถ้าติ๊กว่ายังเก็บเงินส่วนต่างไม่ได้ เดิมไม่มีที่ให้บันทึกตอนผู้เช่าเอาเงินมาให้
// ทีหลังเลย ยอดค้างจึงค้างอยู่อย่างนั้นตลอดไปทั้งที่เก็บได้แล้ว
export default function MoveOutHistoryPage({ apartment, user }) {
  const [filters, setFilters] = useState({ search: '', from: '', to: '' })
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // สัญญาที่กำลังเปิดดูรายละเอียด — null = อยู่ที่ตารางประวัติ
  const [openContractId, setOpenContractId] = useState(null)

  // ช่วงวันที่กลับหัว = ผลลัพธ์ว่างเสมอ ต้องบอกว่าทำไม ไม่ใช่ปล่อยให้คิดว่าไม่มีข้อมูล
  const rangeReversed = Boolean(filters.from && filters.to && filters.from > filters.to)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listTerminations(apartment.apartmentId, {
      search: filters.search || undefined,
      dateFrom: filters.from || undefined,
      dateTo: filters.to || undefined
    })
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setReport(res.data)
  }, [apartment.apartmentId, filters])

  useEffect(() => {
    load()
  }, [load])

  if (openContractId) {
    return (
      <MoveOutRecord
        contractId={openContractId}
        signedBy={user?.fullName}
        onBack={() => setOpenContractId(null)}
        // เก็บเงินส่วนต่างแล้วยอดค้างในตารางต้องเปลี่ยนตาม ไม่ใช่รอให้ผู้ใช้กดรีเฟรชเอง
        onChanged={load}
      />
    )
  }

  const rows = report?.terminations ?? []

  return (
    <>

      <section className="panel">
        <Alert>{error}</Alert>
        {rangeReversed && (
          <Alert kind="warn">วันที่เริ่มต้นอยู่หลังวันที่สิ้นสุด</Alert>
        )}
        {/* ปกติต้องไม่ขึ้นเลย — ขึ้นเมื่อไหร่แปลว่ามีใบที่ตัดสินไว้ด้วยสูตรคนละรุ่นกับที่ใช้อยู่
            ต้องเห็นตั้งแต่หน้ารายการ ไม่ใช่รอให้บังเอิญเปิดใบนั้นเจอ */}
        {(report?.mismatchCount ?? 0) > 0 && (
          <Alert kind="warn">
            มี {report.mismatchCount} ใบ (⚠) ที่ยอดสุทธิไม่ตรงกับสูตรปัจจุบัน — เปิดดูเพื่อเทียบตัวเลข
          </Alert>
        )}

        <div className="invoice-filters">
          <div className="field">
            <label htmlFor="moveOutSearch">เลขห้อง หรือชื่อผู้เช่า</label>
            <input
              id="moveOutSearch"
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="เช่น 101 หรือ สมชาย"
            />
          </div>
          <div className="field">
            <label htmlFor="moveOutFrom">วันที่ย้ายออก ตั้งแต่</label>
            <DateField
              id="moveOutFrom"
              value={filters.from}
              onChange={(v) => setFilters((f) => ({ ...f, from: v }))}
            />
          </div>
          <div className="field">
            <label htmlFor="moveOutTo">ถึง</label>
            <DateField
              id="moveOutTo"
              value={filters.to}
              onChange={(v) => setFilters((f) => ({ ...f, to: v }))}
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setFilters({ search: '', from: '', to: '' })}
            >
              รีเซ็ต
            </button>
          </div>
        </div>

        <div className="room-stats">
          <div className="stat-card">
            <div className="stat-card-value">{report?.count ?? 0}</div>
            <div className="stat-card-label">ย้ายออกแล้ว (ราย)</div>
          </div>
          {(report?.forfeitedCount ?? 0) > 0 && (
            <div className="stat-card">
              <div className="stat-card-value">{report.forfeitedCount}</div>
              <div className="stat-card-label">ริบเงินประกัน (ราย)</div>
            </div>
          )}
          {/* การ์ดนี้ขึ้นเฉพาะตอนมีของค้างจริง — ช่องที่เขียน 0 ค้างไว้ตลอดจะถูกมองข้าม
              จนถึงวันที่มันขึ้นเป็นเลขจริง (กติกาเดียวกับการ์ด "ยกเลิกแล้ว" ของรายงานใบเสร็จ) */}
          {(report?.unpaidCount ?? 0) > 0 && (
            <div className="stat-card highlight">
              <div className="stat-card-value">{formatBaht(report.unpaidTotalCents)}</div>
              <div className="stat-card-label">ยังเก็บไม่ได้ ({report.unpaidCount} ราย)</div>
            </div>
          )}
        </div>

        <div className="panel-head-row">
          <h2 className="panel-title">รายการย้ายออก</h2>
        </div>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <p className="muted table-empty">
            {filters.search || filters.from || filters.to
              ? 'ไม่พบรายการย้ายออกตามเงื่อนไขที่ค้นหา'
              : 'ยังไม่มีผู้เช่าย้ายออกจากหอนี้'}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="invoice-col-no">#</th>
                <th>วันที่ย้ายออก</th>
                <th>ห้อง</th>
                <th>ผู้เช่า</th>
                <th className="align-right">อยู่มา (เดือน)</th>
                <th className="align-right">เงินประกัน</th>
                <th>ผลการตัดสิน</th>
                <th className="align-right">ยอดสุทธิ</th>
                <th className="align-right">ยังเก็บไม่ได้</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, index) => (
                <tr key={t.terminationId}>
                  <td className="invoice-col-no">{index + 1}</td>
                  <td>{formatDate(t.moveOutDate)}</td>
                  <td>{t.roomNumber}</td>
                  <td>{t.tenantName ?? '-'}</td>
                  <td className="align-right">{t.monthsStayed}</td>
                  <td className="align-right">{formatBaht(t.depositSnapshotCents)}</td>
                  <td>
                    {t.isDepositRefundable ? (
                      'คืนเงินประกัน'
                    ) : (
                      // เหตุผลอยู่ใน title — คอลัมน์แคบ และคนที่เปิดหน้านี้ส่วนใหญ่มาหายอด
                      <span className="negative" title={t.forfeitReasonLabel ?? ''}>
                        ริบเงินประกัน
                      </span>
                    )}
                    {t.isManualOverride && <span className="room-badge">ตัดสินเอง</span>}
                  </td>
                  <td className="align-right">
                    {/* บวก = หอคืนให้ผู้เช่า · ลบ = ผู้เช่าจ่ายเพิ่มให้หอ (ทิศเดียวกับใบสรุป) */}
                    <span className={t.netRefundCents < 0 ? 'negative' : undefined}>
                      {formatBaht(t.netRefundCents)}
                    </span>
                    {t.hasNetRefundMismatch && (
                      <span
                        className="negative"
                        title={`คิดด้วยกติกาปัจจุบันจะได้ ${formatBaht(t.recomputedNetRefundCents)}`}
                      >
                        {' '}
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="align-right">
                    {t.unpaidBalanceCents > 0 ? (
                      <span className="negative">{formatBaht(t.unpaidBalanceCents)}</span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td className="align-right">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setOpenContractId(t.contractId)}
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
// ใบสรุปการย้ายออกย้อนหลัง (+ ตามเก็บเงินส่วนต่าง)
// ------------------------------------------------------------------
// ใช้ MoveOutDocument ตัวเดียวกับที่พิมพ์ตอนย้ายออก — ใบที่เปิดดูย้อนหลังกับใบที่ยื่นให้
// ผู้เช่าในวันนั้นจึงเป็นเอกสารเดียวกันเสมอ (ตัวเลขมาจาก summariseMoney ตัวเดียวกันด้วย)
function MoveOutRecord({ contractId, signedBy, onBack, onChanged }) {
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [collecting, setCollecting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getTermination(contractId)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setRecord(res.data)
  }, [contractId])

  useEffect(() => {
    load()
  }, [load])

  async function onSavePdf() {
    setError('')
    setBusy(true)
    const res = await savePdf(`ใบสรุปการย้ายออก-ห้อง${record.roomNumber}-${record.moveOutDate}`)
    setBusy(false)
    if (!res.success) return setError(res.error)
    if (res.data.cancelled) return
    showToast('บันทึกไฟล์ PDF แล้ว')
    revealPdf(res.data.filePath)
  }

  // ระหว่างพิมพ์ หน้าจอเหลือแต่ตัวเอกสาร เพราะ printToPDF จับภาพหน้าที่กำลังแสดงอยู่
  if (printing && record) {
    return (
      <>
        <MoveOutDocument termination={record} signedBy={signedBy} />
        <PrintDialog
          title="พิมพ์ใบสรุปการย้ายออก"
          onClose={() => setPrinting(false)}
          onPrinted={() => {
            setPrinting(false)
            showToast('ส่งเอกสารเข้าเครื่องพิมพ์แล้ว')
          }}
        />
      </>
    )
  }

  return (
    <>
      <button type="button" className="link-btn" onClick={onBack}>
        <Icon name="back" />
        <span>กลับไปประวัติการย้ายออก</span>
      </button>

      <Alert>{error}</Alert>

      {loading ? (
        <p className="muted">กำลังโหลด...</p>
      ) : !record ? (
        <section className="panel">
          <div className="empty-state">
            <p>ไม่พบบันทึกการย้ายออกของสัญญานี้</p>
          </div>
        </section>
      ) : (
        <>
          <h2 className="room-detail-title">
            รายละเอียดการย้ายออก — ห้อง {record.roomNumber}
          </h2>

          {/* ใบที่ตัดสินด้วยสูตรคนละรุ่น — ต้องกางตัวเลขทั้งสองชุดให้เห็น ไม่ใช่บอกแค่ว่า
              "ไม่ตรงกัน" เพราะคนอ่านต้องตัดสินใจได้ว่าจะยึดอันไหน */}
          {record.hasNetRefundMismatch && (
            <section className="panel">
              <Alert kind="warn">
                ใบนี้บันทึกยอดสุทธิไว้{' '}
                <strong>
                  {record.netRefundCents >= 0 ? 'คืนให้ผู้เช่า' : 'ผู้เช่าต้องชำระเพิ่ม'}{' '}
                  {formatBaht(Math.abs(record.netRefundCents))} บาท
                </strong>{' '}
                แต่คำนวณด้วยกติกาปัจจุบันได้{' '}
                <strong>
                  {record.recomputedNetRefundCents >= 0 ? 'คืนให้ผู้เช่า' : 'ผู้เช่าต้องชำระเพิ่ม'}{' '}
                  {formatBaht(Math.abs(record.recomputedNetRefundCents))} บาท
                </strong>{' '}
                — ยืนยันไว้ตอนใช้สูตรรุ่นเก่า ระบบใช้ยอดที่บันทึกไว้
              </Alert>
            </section>
          )}

          {record.unpaidBalanceCents > 0 && (
            <section className="panel">
              <Alert kind="warn">
                ยังค้างเงินส่วนต่าง {formatBaht(record.unpaidBalanceCents)} บาท
              </Alert>
              <div className="card-foot">
                <button type="button" className="btn" onClick={() => setCollecting(true)}>
                  <Icon name="payments" />
                  <span>รับเงินส่วนต่าง</span>
                </button>
              </div>
            </section>
          )}

          <section className="panel invoice-doc">
            {/* ปุ่มถูกซ่อนตอนพิมพ์ด้วย @media print (คลาส invoice-doc-tools) */}
            <div className="invoice-doc-tools">
              <div className="invoice-doc-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setPrinting(true)}
                  disabled={busy}
                >
                  <Icon name="printer" />
                  <span>พิมพ์ใบสรุปการย้ายออก</span>
                </button>
                <button type="button" className="btn btn-sm" onClick={onSavePdf} disabled={busy}>
                  <Icon name="download" />
                  <span>{busy ? 'กำลังบันทึก...' : 'บันทึก PDF'}</span>
                </button>
              </div>
            </div>

            <MoveOutDocument termination={record} signedBy={signedBy} />
          </section>
        </>
      )}

      {collecting && record && (
        <CollectShortfallDialog
          record={record}
          onClose={() => setCollecting(false)}
          onCollected={(result) => {
            setCollecting(false)
            showToast(`รับเงินส่วนต่างแล้ว ใบเสร็จ ${result.receipt.receiptNumber}`)
            setRecord(result)
            onChanged?.()
          }}
          onError={setError}
        />
      )}
    </>
  )
}

// ------------------------------------------------------------------
function CollectShortfallDialog({ record, onClose, onCollected, onError }) {
  // เติมยอดค้างทั้งก้อนเป็นค่าตั้งต้น (เหมือนการ์ดรับเงินของใบแจ้งหนี้) แต่แก้ได้
  // เพราะผู้เช่าทยอยจ่ายบางส่วนได้
  const [amount, setAmount] = useState(() => centsToInput(record.unpaidBalanceCents))
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentDate, setPaymentDate] = useState(todayIso)
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    onError('')
    setBusy(true)
    const res = await collectShortfall({
      contractId: record.contractId,
      amount,
      paymentMethod,
      paymentDate,
      remark
    })
    setBusy(false)
    if (!res.success) return onError(res.error)
    onCollected(res.data)
  }

  return (
    <Modal
      title={`รับเงินส่วนต่างตอนย้ายออก — ห้อง ${record.roomNumber}`}
      icon="payments"
      submitLabel="รับเงินและออกใบเสร็จ"
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
    >
      <dl className="invoice-totals delete-summary">
        <div>
          <dt>ผู้เช่า</dt>
          <dd>{record.tenantName ?? '-'}</dd>
        </div>
        <div>
          <dt>วันที่ย้ายออก</dt>
          <dd>{formatDate(record.moveOutDate)}</dd>
        </div>
        <div>
          <dt>ยอดที่ยังค้าง</dt>
          <dd>{formatBaht(record.unpaidBalanceCents)}</dd>
        </div>
      </dl>

      <div className="field field-required">
        <label htmlFor="shortfallAmount">
          จำนวนเงินที่รับ <span className="required">* จำเป็น</span>
        </label>
        <input
          id="shortfallAmount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <p className="field-hint">รับเกินยอดที่ค้างอยู่ไม่ได้ · จ่ายบางส่วนก่อนได้</p>
      </div>

      <div className="field">
        <label htmlFor="shortfallMethod">ชำระเงินโดย</label>
        <select
          id="shortfallMethod"
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

      <div className="field">
        <label htmlFor="shortfallDate">วันที่รับเงิน</label>
        <DateField id="shortfallDate" value={paymentDate} onChange={setPaymentDate} />
      </div>

      <div className="field">
        <label htmlFor="shortfallRemark">หมายเหตุ</label>
        <input
          id="shortfallRemark"
          type="text"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="เว้นว่างได้"
        />
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// วันที่ในตารางบนหน้าจอเป็น ค.ศ. เหมือนทุกหน้าในแอป — ปี พ.ศ. ใช้เฉพาะบนเอกสาร
// ที่ยื่นให้ผู้เช่า (ดู format.js) ซึ่ง MoveOutDocument จัดการเองอยู่แล้ว
function formatDate(value) {
  if (!value) return '-'
  const [y, m, d] = String(value).split('-')
  return `${d}/${m}/${y}`
}

function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
