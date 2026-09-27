import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from '../components/FieldError.jsx'
import DateField from '../components/DateField.jsx'
import Modal from '../components/Modal.jsx'
import PeriodBar, {
  MonthGroupRow,
  currentMonth,
  formatMonthName,
  periodDateRange,
  periodLabel,
  useMonthGroups
} from '../components/PeriodBar.jsx'
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

export default function MoveOutHistoryPage({ apartment, user }) {
  const [search, setSearch] = useState('')
  // เปิดมาที่ "ทั้งหมด" — การ์ดยังเก็บไม่ได้นับตามช่วงที่เลือก ห้ามซ่อนยอดค้างของเดือนเก่า
  const [period, setPeriod] = useState(() => ({ mode: 'all', month: currentMonth() }))
  const range = periodDateRange(period)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openContractId, setOpenContractId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listTerminations(apartment.apartmentId, {
      search: search || undefined,
      dateFrom: range.from || undefined,
      dateTo: range.to || undefined
    })
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setReport(res.data)
  }, [apartment.apartmentId, search, range.from, range.to])

  useEffect(() => {
    load()
  }, [load])

  const rows = report?.terminations ?? []
  const { groups, collapsible, isOpen, toggle, resetToggles } = useMonthGroups(
    rows,
    (t) => String(t.moveOutDate ?? '').slice(0, 7),
    period,
    Boolean(search)
  )

  function changePeriod(next) {
    setPeriod(next)
    resetToggles()
  }

  if (openContractId) {
    return (
      <MoveOutRecord
        contractId={openContractId}
        signedBy={user?.fullName}
        onBack={() => setOpenContractId(null)}
        onChanged={load}
      />
    )
  }

  return (
    <>
      <section className="panel">
        <Alert>{error}</Alert>
        {(report?.mismatchCount ?? 0) > 0 && (
          <Alert kind="warn">
            มี {report.mismatchCount} ใบ (⚠) ที่ยอดสุทธิไม่ตรงกับสูตรปัจจุบัน — เปิดดูเพื่อเทียบตัวเลข
          </Alert>
        )}

        <div className="invoice-filters">
          <PeriodBar period={period} onChange={changePeriod} />
          <div className="field">
            <label htmlFor="moveOutSearch">เลขห้อง หรือชื่อผู้เช่า</label>
            <input
              id="moveOutSearch"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="เช่น 101 หรือ สมชาย"
            />
          </div>
          <button
            type="button"
            className="link-btn invoice-filter-reset"
            onClick={() => {
              setSearch('')
              changePeriod({ mode: 'all', month: currentMonth() })
            }}
            disabled={!search && period.mode === 'all'}
          >
            รีเซ็ต
          </button>
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
            {search
              ? 'ไม่พบรายการย้ายออกตามเงื่อนไขที่ค้นหา'
              : period.mode === 'all'
                ? 'ยังไม่มีผู้เช่าย้ายออกจากหอนี้'
                : `ไม่มีผู้เช่าย้ายออกใน${periodLabel(period)}`}
          </p>
        ) : (
          <table className="data-table grouped-table">
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
            {groups.map((group, groupIndex) => {
              const open = isOpen(group.month, groupIndex)
              return (
                <tbody key={group.month}>
                  <MonthGroupRow
                    label={`ย้ายออก${formatMonthName(group.month)}`}
                    meta={<MoveOutMonthMeta items={group.items} />}
                    colSpan={10}
                    open={open}
                    collapsible={collapsible}
                    onToggle={() => toggle(group.month)}
                  />
                  {open &&
                    group.items.map((t, index) => (
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
                            <span className="negative" title={t.forfeitReasonLabel ?? ''}>
                              ริบเงินประกัน
                            </span>
                          )}
                          {t.isManualOverride && <span className="room-badge">ตัดสินเอง</span>}
                        </td>
                        <td className="align-right">
                          {/* บวก = หอคืนให้ผู้เช่า · ลบ = ผู้เช่าจ่ายเพิ่ม */}
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
              )
            })}
          </table>
        )}
      </section>
    </>
  )
}

// สรุปของเดือน — ยอดค้างเก็บต้องเห็นแม้กลุ่มถูกพับ
function MoveOutMonthMeta({ items }) {
  const unpaid = items.reduce((sum, t) => sum + (t.unpaidBalanceCents > 0 ? t.unpaidBalanceCents : 0), 0)
  return (
    <>
      {items.length} ราย
      {unpaid > 0 && (
        <>
          {' · '}
          <span className="negative">ยังเก็บไม่ได้ {formatBaht(unpaid)}</span>
        </>
      )}
    </>
  )
}

// ใช้ MoveOutDocument ตัวเดียวกับตอนย้ายออก
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

  // ระหว่างพิมพ์แสดงแค่เอกสาร — printToPDF จับภาพหน้าที่แสดงอยู่
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
      <button type="button" className="link-btn link-back-inline" onClick={onBack}>
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
        />
      )}
    </>
  )
}

// ชื่อช่องตรงกับ collectTerminationShortfall
const SHORTFALL_FIELDS = ['amount', 'paymentDate']

function CollectShortfallDialog({ record, onClose, onCollected }) {
  const [amount, setAmount] = useState(() => centsToInput(record.unpaidBalanceCents))
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentDate, setPaymentDate] = useState(todayIso)
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const { errors, formError, fromResult, clear, reset } = useFormErrors(SHORTFALL_FIELDS)

  async function submit() {
    reset()
    setBusy(true)
    const res = await collectShortfall({
      contractId: record.contractId,
      amount,
      paymentMethod,
      paymentDate,
      remark
    })
    setBusy(false)
    if (!res.success) return fromResult(res)
    onCollected(res.data)
  }

  return (
    <Modal
      title={`รับเงินส่วนต่างตอนย้ายออก — ห้อง ${record.roomNumber}`}
      icon="payments"
      submitLabel="รับเงินและออกใบเสร็จ"
      busy={busy}
      error={formError}
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

      <div className={fieldClass('field field-required', errors.amount)}>
        <label htmlFor="shortfallAmount">
          จำนวนเงินที่รับ <span className="required">* จำเป็น</span>
        </label>
        <input
          id="shortfallAmount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            clear('amount')
          }}
          {...invalidProps('shortfallAmount', errors.amount)}
        />
        {errors.amount ? (
          <FieldError id="shortfallAmount-error" message={errors.amount} />
        ) : (
          <p className="field-hint">รับเกินยอดที่ค้างอยู่ไม่ได้ · จ่ายบางส่วนก่อนได้</p>
        )}
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

      <div className={fieldClass('field', errors.paymentDate)}>
        <label htmlFor="shortfallDate">วันที่รับเงิน</label>
        <DateField
          id="shortfallDate"
          value={paymentDate}
          onChange={(v) => {
            setPaymentDate(v)
            clear('paymentDate')
          }}
        />
        <FieldError id="shortfallDate-error" message={errors.paymentDate} />
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
