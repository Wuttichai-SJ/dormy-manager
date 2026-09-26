import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import InfoTip from '../components/InfoTip.jsx'
import DateField from '../components/DateField.jsx'
import { showToast } from '../components/Toast.jsx'
import { INVOICE_STATUS_LABELS, PAYMENT_METHODS } from '../constants.js'
import { centsToInput, formatBaht } from '../format.js'
import {
  getMultiPaymentSheet,
  listBillingMonths,
  receiveManyPayments
} from '../services/paymentService.js'

// ช่องทาง/วันที่/หมายเหตุ ใช้ร่วมกันทั้งหน้า
export default function MultiPaymentPage({ apartment, onBack }) {
  const [months, setMonths] = useState([])
  const [billingMonth, setBillingMonth] = useState('')
  const [paymentDate, setPaymentDate] = useState(today())
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [remark, setRemark] = useState('')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const res = await listBillingMonths(apartment.apartmentId)
      if (!res.success) {
        setLoading(false)
        return setError(res.error)
      }
      setMonths(res.data)
      setBillingMonth(res.data[0] ?? '')
      if (res.data.length === 0) setLoading(false)
    })()
  }, [apartment.apartmentId])

  // reset = เปลี่ยนรอบเดือน/รับเงินเสร็จ · merge = เปลี่ยนวันที่ (เอาแค่ค่าปรับ/วันเกินกำหนด) · วันที่อ่านผ่าน ref
  const paymentDateRef = useRef(paymentDate)
  paymentDateRef.current = paymentDate
  // ทิ้งคำตอบของคำขอเก่า
  const requestSeq = useRef(0)

  const fetchSheet = useCallback(
    async (mode) => {
      if (!billingMonth) return
      const date = paymentDateRef.current
      const seq = ++requestSeq.current
      if (mode === 'reset') setLoading(true)
      const res = await getMultiPaymentSheet({
        apartmentId: apartment.apartmentId,
        billingMonth,
        paymentDate: date || today()
      })
      if (seq !== requestSeq.current) return
      setLoading(false)
      if (!res.success) return setError(res.error)
      setError('')
      setRows((previous) => {
        const before = new Map(previous.map((row) => [row.invoiceId, row]))
        return res.data.map((invoice) => {
          const kept = mode === 'merge' ? before.get(invoice.invoiceId) : null
          if (!kept) return freshRow(invoice)

          // ค่าปรับของวันใหม่อาจไม่มีแล้ว
          const chargeLateFee = kept.chargeLateFee && (invoice.lateFee?.suggestedCents ?? 0) > 0
          const next = {
            ...invoice,
            selected: kept.selected,
            amountInput: kept.amountInput,
            amountTouched: kept.amountTouched,
            chargeLateFee
          }
          // ยอดที่ระบบเติมตามค่าปรับใหม่ · ยอดที่ผู้ใช้พิมพ์เองห้ามแตะ
          if (!kept.amountTouched) {
            next.amountInput = centsToInput(invoice.outstandingCents + feeCentsOf(next))
          }
          return next
        })
      })
    },
    [apartment.apartmentId, billingMonth]
  )

  useEffect(() => {
    fetchSheet('reset')
  }, [fetchSheet])

  // รอให้วันที่ครบก่อน
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return
    fetchSheet('merge')
    // fetchSheet ไม่อยู่ใน deps โดยตั้งใจ
  }, [paymentDate])

  function setRow(invoiceId, patch) {
    setRows((list) =>
      list.map((row) => (row.invoiceId === invoiceId ? { ...row, ...patch } : row))
    )
  }

  const payable = useMemo(
    () => rows.filter((row) => row.outstandingCents > 0 && row.status !== 'cancelled'),
    [rows]
  )
  const chosen = useMemo(() => payable.filter((row) => row.selected), [payable])

  // ยอดรับเงินรวมค่าปรับแล้ว — ห้ามบวกซ้ำ
  const totalCents = useMemo(
    () => chosen.reduce((sum, row) => sum + inputToCents(row.amountInput), 0),
    [chosen]
  )

  const allChosen = payable.length > 0 && chosen.length === payable.length

  async function submit() {
    if (chosen.length === 0) return setError('ยังไม่ได้เลือกห้องที่จะรับเงิน')
    if (!paymentDate) return setError('กรุณาระบุวันที่รับเงินให้ถูกต้อง')

    setError('')
    setBusy(true)
    const res = await receiveManyPayments({
      paymentMethod,
      paymentDate,
      remark,
      rows: chosen.map((row) => ({
        invoiceId: row.invoiceId,
        roomNumber: row.roomNumber,
        amount: row.amountInput,
        lateFee: row.chargeLateFee ? centsToInput(row.lateFee.suggestedCents) : undefined
      }))
    })
    setBusy(false)
    if (!res.success) return setError(res.error)

    showToast(`รับเงินแล้ว ${res.data.length} ห้อง · ออกใบเสร็จ ${res.data.length} ใบ`)
    fetchSheet('reset')
  }

  return (
    <>
      <div className="page-back">
        <button type="button" className="link-btn" onClick={onBack}>
          <Icon name="back" />
          <span>กลับไปรายการใบแจ้งหนี้</span>
        </button>
      </div>

      <section className="panel">
        <h2 className="panel-title">
          รับเงินหลายห้อง
          <InfoTip
            title="รับเงินหลายห้องพร้อมกัน"
            points={[
              'วันที่ ช่องทาง และหมายเหตุ ใช้ร่วมกันทั้งชุด',
              'ออกใบเสร็จแยกใบต่อห้อง',
              'ถ้ามีห้องใดกรอกผิด จะไม่บันทึกเลยสักห้อง'
            ]}
          />
        </h2>
        <Alert>{error}</Alert>

        <div className="multi-pay-head">
          <div className="field">
            <label htmlFor="billingMonth">รอบเดือน</label>
            <select
              id="billingMonth"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
              disabled={months.length === 0}
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {formatBillingMonth(month)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="paymentDate">
              วันที่รับเงิน <span className="required">* จำเป็น</span>
            </label>
            <DateField id="paymentDate" value={paymentDate} onChange={setPaymentDate} />
          </div>

          <div className="field">
            <label htmlFor="paymentMethod">ชำระเงินโดย</label>
            <select
              id="paymentMethod"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method.key} value={method.key}>
                  {method.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field multi-pay-remark">
            <label htmlFor="remark">หมายเหตุ</label>
            <input
              id="remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="ขึ้นบนใบเสร็จทุกใบในชุดนี้"
            />
          </div>
        </div>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : months.length === 0 ? (
          <p className="muted table-empty">ยังไม่มีใบแจ้งหนี้ให้รับเงิน</p>
        ) : (
          <>
            {payable.length > 0 && (
              <label className="multi-pay-selectall">
                <input
                  type="checkbox"
                  checked={allChosen}
                  onChange={(e) =>
                    setRows((list) =>
                      list.map((row) =>
                        row.outstandingCents > 0 && row.status !== 'cancelled'
                          ? { ...row, selected: e.target.checked }
                          : row
                      )
                    )
                  }
                />
                <span>เลือกทุกห้องที่ยังค้างชำระ ({payable.length} ห้อง)</span>
              </label>
            )}

            {rows.length === 0 ? (
              <p className="muted table-empty">รอบเดือนนี้ยังไม่มีใบแจ้งหนี้</p>
            ) : (
              <ul className="multi-pay-list">
                {rows.map((row) => (
                  <MultiPaymentCard key={row.invoiceId} row={row} onChange={setRow} />
                ))}
              </ul>
            )}

            <div className="card-foot multi-pay-foot">
              <div className="multi-pay-total">
                <span className="muted">เลือกไว้ {chosen.length} ห้อง · รวมเป็นเงิน</span>
                <strong>{formatBaht(totalCents)} บาท</strong>
              </div>
              <button
                type="button"
                className="btn"
                onClick={submit}
                disabled={busy || chosen.length === 0}
              >
                {busy ? 'กำลังบันทึก...' : `รับเงิน ${chosen.length} ห้อง`}
              </button>
            </div>
          </>
        )}
      </section>
    </>
  )
}

function freshRow(invoice) {
  return {
    ...invoice,
    // ห้องที่ค้างติ๊กไว้ให้ก่อน
    selected: invoice.outstandingCents > 0 && invoice.status !== 'cancelled',
    amountInput: centsToInput(invoice.outstandingCents),
    amountTouched: false,
    // ค่าปรับต้องติ๊กเอง ไม่ติ๊กให้
    chargeLateFee: false
  }
}

// สตางค์ จาก main
function feeCentsOf(row) {
  return row.chargeLateFee ? (row.lateFee?.suggestedCents ?? 0) : 0
}

function MultiPaymentCard({ row, onChange }) {
  const settled = row.outstandingCents <= 0
  const cancelled = row.status === 'cancelled'
  const locked = settled || cancelled

  const amountCents = inputToCents(row.amountInput)
  // ค่าปรับที่ติ๊กเข้าบิลก่อนรับเงิน — ยอดรับได้เพิ่มตาม
  const maxCents = row.outstandingCents + feeCentsOf(row)
  const overpaid = !locked && amountCents > maxCents
  const emptyAmount = !locked && row.selected && amountCents === 0

  return (
    <li className={locked ? 'multi-pay-card is-locked' : 'multi-pay-card'}>
      <div className="multi-pay-info">
        <div className="multi-pay-room">
          {!locked && (
            <input
              type="checkbox"
              checked={row.selected}
              onChange={(e) => onChange(row.invoiceId, { selected: e.target.checked })}
              aria-label={`เลือกห้อง ${row.roomNumber}`}
            />
          )}
          <strong>ห้อง {row.roomNumber}</strong>
          <span className={`invoice-status invoice-${row.status}`}>
            {INVOICE_STATUS_LABELS[row.status] ?? row.status}
          </span>
          {row.overdueDays > 0 && <span className="invoice-overdue">เกิน {row.overdueDays} วัน</span>}
        </div>
        <span className="muted">
          {row.invoiceNumber} · ยอดรวม {formatBaht(row.totalAmountCents)} · ครบกำหนด{' '}
          {formatDate(row.dueDate)}
        </span>
      </div>

      {locked ? (
        <div className="multi-pay-done">
          <span className="muted">{cancelled ? 'ยกเลิกแล้ว' : 'ชำระแล้ว'}</span>
          <strong>{formatBaht(row.totalAmountCents)} บาท</strong>
        </div>
      ) : (
        <div className="multi-pay-entry">
          <div className="field">
            <label htmlFor={`amount-${row.invoiceId}`}>
              ยอดรับเงิน <span className="muted">(ค้าง {formatBaht(row.outstandingCents)})</span>
            </label>
            <input
              id={`amount-${row.invoiceId}`}
              inputMode="decimal"
              value={row.amountInput}
              onChange={(e) =>
                onChange(row.invoiceId, { amountInput: e.target.value, amountTouched: true })
              }
              disabled={!row.selected}
            />
            {overpaid && (
              <p className="field-hint field-hint-warn">
                เกินยอดค้างชำระ — รับได้ไม่เกิน {formatBaht(maxCents)} บาท
              </p>
            )}
            {emptyAmount && (
              <p className="field-hint field-hint-warn">ยังไม่ได้กรอกยอดเงิน</p>
            )}
          </div>

          {row.lateFee?.enabled && row.lateFee.suggestedCents > 0 && (
            <label className="multi-pay-latefee">
              <input
                type="checkbox"
                checked={row.chargeLateFee}
                onChange={(e) => {
                  // บวกค่าปรับเข้ายอดรับเงิน — main เพิ่มค่าปรับเข้าบิลก่อนออกใบเสร็จ
                  const next = { ...row, chargeLateFee: e.target.checked }
                  onChange(row.invoiceId, {
                    chargeLateFee: next.chargeLateFee,
                    amountInput: centsToInput(row.outstandingCents + feeCentsOf(next)),
                    amountTouched: false
                  })
                }}
                disabled={!row.selected}
              />
              <span>
                เก็บค่าปรับ {formatBaht(row.lateFee.suggestedCents)} บาท (
                {row.lateFee.chargeableDays} วัน)
              </span>
            </label>
          )}
        </div>
      )}
    </li>
  )
}

// ใช้บวกยอดบนจอเท่านั้น — ยอดจริงแปลงที่ main
function inputToCents(value) {
  const amount = Number(String(value ?? '').replace(/,/g, '').trim())
  if (!Number.isFinite(amount) || amount < 0) return 0
  return Math.round(amount * 100)
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

function formatBillingMonth(month) {
  if (!month) return '-'
  const [year, m] = String(month).split('-')
  return `${m}-${year}`
}
