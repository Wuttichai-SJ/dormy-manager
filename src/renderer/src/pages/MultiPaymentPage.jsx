import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import DateField from '../components/DateField.jsx'
import { showToast } from '../components/Toast.jsx'
import { INVOICE_STATUS_LABELS, PAYMENT_METHODS } from '../constants.js'
import { centsToInput, formatBaht } from '../format.js'
import {
  getMultiPaymentSheet,
  listBillingMonths,
  receiveManyPayments
} from '../services/paymentService.js'

// หน้ารับเงินหลายห้อง — ผู้เช่าหลายคนเดินมาจ่ายพร้อมกันที่โต๊ะเดียว
//
// โครงตามต้นแบบ (yeeraf: บิลรายเดือน → "รับเงินหลายห้อง" → หน้า multiple-monthly-billings):
// เลือกรอบเดือนด้านบน → การ์ดละห้อง ซ้ายเป็นข้อมูลบิล ขวาเป็นช่องรับเงิน
// ทำเป็นหน้าเต็มเหมือนต้นแบบ ไม่ใช่ modal เพราะหอสี่สิบห้องใส่ในกล่องไม่ลง
//
// **ช่องทาง/วันที่/หมายเหตุ อยู่ข้างบนชุดเดียวใช้ร่วมกันทั้งหน้า** — ที่รวมกันคือจังหวะที่
// รับเงิน ไม่ใช่ตัวหนี้ ถ้าให้กรอกรายห้องก็ไม่ได้เร็วกว่าเปิดบิลทีละใบเลย
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
      // เดือนล่าสุดคือรอบที่กำลังตามเก็บอยู่เกือบทุกครั้ง
      setBillingMonth(res.data[0] ?? '')
      if (res.data.length === 0) setLoading(false)
    })()
  }, [apartment.apartmentId])

  // ค่าปรับขยับตามวันที่รับเงิน จึงต้องดึงใหม่ทุกครั้งที่เปลี่ยนวัน ไม่ใช่คำนวณเองที่หน้าจอ
  // (สูตรอยู่ฝั่ง main ที่เดียว — ต่างจากหน่วยมิเตอร์ที่ต้องมีสำเนาเพราะขยับทุกตัวอักษร)
  const load = useCallback(async () => {
    if (!billingMonth) return
    setLoading(true)
    const res = await getMultiPaymentSheet({
      apartmentId: apartment.apartmentId,
      billingMonth,
      paymentDate: paymentDate || today()
    })
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setRows(
      res.data.map((invoice) => ({
        ...invoice,
        // ห้องที่ยังค้างติ๊กไว้ให้เลย — คนที่เข้าหน้านี้ตั้งใจจะรับเงิน ไม่ได้มาดูเฉยๆ
        // แล้วค่อยเอาห้องที่ยังไม่จ่ายออก เร็วกว่าไล่ติ๊กทีละห้อง
        selected: invoice.outstandingCents > 0 && invoice.status !== 'cancelled',
        amountInput: centsToInput(invoice.outstandingCents),
        // ค่าปรับต้องกดเลือกเอง ไม่ติ๊กให้อัตโนมัติ — เจ้าของหอมักยกให้ และการเก็บเงิน
        // เพิ่มโดยที่คนกดไม่ได้ตั้งใจเป็นความผิดพลาดที่แก้ไม่ได้ (ระบบไม่มีการคืนเงินค่าบิล)
        chargeLateFee: false
      }))
    )
  }, [apartment.apartmentId, billingMonth, paymentDate])

  useEffect(() => {
    load()
  }, [load])

  function setRow(invoiceId, patch) {
    setRows((list) =>
      list.map((row) => (row.invoiceId === invoiceId ? { ...row, ...patch } : row))
    )
  }

  // ห้องที่รับเงินได้จริง = ยังค้างอยู่และไม่ได้ถูกยกเลิก
  const payable = useMemo(
    () => rows.filter((row) => row.outstandingCents > 0 && row.status !== 'cancelled'),
    [rows]
  )
  const chosen = useMemo(() => payable.filter((row) => row.selected), [payable])

  const totalCents = useMemo(
    () =>
      chosen.reduce(
        (sum, row) =>
          sum + inputToCents(row.amountInput) + (row.chargeLateFee ? row.lateFee.suggestedCents : 0),
        0
      ),
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
        // ส่งเลขห้องไปด้วยเพื่อให้ข้อความ error ฝั่ง main บอกได้ว่าห้องไหนพัง
        roomNumber: row.roomNumber,
        amount: row.amountInput,
        lateFee: row.chargeLateFee ? centsToInput(row.lateFee.suggestedCents) : undefined
      }))
    })
    setBusy(false)
    if (!res.success) return setError(res.error)

    showToast(`รับเงินแล้ว ${res.data.length} ห้อง · ออกใบเสร็จ ${res.data.length} ใบ`)
    load()
  }

  return (
    <>
      <div className="page-back">
        <button type="button" className="link-btn" onClick={onBack}>
          <Icon name="back" />
          <span>กลับไปรายการใบแจ้งหนี้</span>
        </button>
      </div>

      <div className="info-banner">
        <strong>รับเงินหลายห้อง</strong>
        <p>
          สำหรับตอนที่ผู้เช่าหลายคนมาจ่ายพร้อมกัน — ช่องทาง วันที่ และหมายเหตุ ใช้ร่วมกันทั้งชุด
          ส่วนยอดเงินกรอกแยกรายห้องได้ · <strong>ระบบออกใบเสร็จแยกใบต่อห้อง</strong>{' '}
          ให้ผู้เช่าแต่ละคนถือกลับไป · ถ้ามีห้องใดกรอกผิด จะไม่มีห้องไหนถูกบันทึกเลย
        </p>
      </div>

      <section className="panel">
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

// ------------------------------------------------------------------
// การ์ดหนึ่งห้อง — ซ้ายคือบิล ขวาคือช่องรับเงิน (โครงเดียวกับต้นแบบ)
// ------------------------------------------------------------------
function MultiPaymentCard({ row, onChange }) {
  const settled = row.outstandingCents <= 0
  const cancelled = row.status === 'cancelled'
  const locked = settled || cancelled

  const amountCents = inputToCents(row.amountInput)
  // เกินยอดค้างฝั่ง main ก็ปฏิเสธอยู่แล้ว แต่บอกตั้งแต่ตอนพิมพ์ดีกว่าให้ไปเจอตอนกดบันทึก
  // แล้วทั้งชุดล้มเพราะห้องเดียว
  const overpaid = !locked && amountCents > row.outstandingCents
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
              onChange={(e) => onChange(row.invoiceId, { amountInput: e.target.value })}
              disabled={!row.selected}
            />
            {overpaid && (
              <p className="field-hint field-hint-warn">
                เกินยอดค้างชำระ — รับได้ไม่เกิน {formatBaht(row.outstandingCents)} บาท
              </p>
            )}
            {emptyAmount && (
              <p className="field-hint field-hint-warn">ยังไม่ได้กรอกยอดเงินของห้องนี้</p>
            )}
          </div>

          {/* ค่าปรับขึ้นเฉพาะห้องที่เข้าเงื่อนไขจริง — หอที่ปิดค่าปรับไว้จะไม่เห็นอะไรเลย */}
          {row.lateFee?.enabled && row.lateFee.suggestedCents > 0 && (
            <label className="multi-pay-latefee">
              <input
                type="checkbox"
                checked={row.chargeLateFee}
                onChange={(e) => onChange(row.invoiceId, { chargeLateFee: e.target.checked })}
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

// ------------------------------------------------------------------
// ช่องกรอกเป็นข้อความ ไม่ใช่ตัวเลข (ลบจนว่างแล้วต้องยังพิมพ์ต่อได้)
// ที่นี่ใช้บวกยอดรวมบนจอเท่านั้น ยอดที่บันทึกจริงแปลงใหม่ฝั่ง main ด้วย money.js
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
