import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { useConfirm } from '../components/ConfirmDialog.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from '../components/FieldError.jsx'
import DateField from '../components/DateField.jsx'
import { showToast } from '../components/Toast.jsx'
import { formatBaht } from '../format.js'
import { PAYMENT_METHODS } from '../constants.js'
import MoveOutDocument from '../components/MoveOutDocument.jsx'
import PrintDialog from '../components/PrintDialog.jsx'
import { revealPdf, savePdf } from '../services/printService.js'
import { completeTermination, getTerminationSheet } from '../services/terminationService.js'

// หน้าสรุปย้ายออก — มีกล่อง "ผลการตัดสิน" ตามกฎเงินประกันของหอ
const OTHER_CATEGORY = 'อื่น ๆ'

// ค่าน้ำ-ค่าไฟไม่อยู่ในนี้ — คิดจากมิเตอร์ที่ FinalMeterCard
const ITEM_TABS = [
  {
    key: 'service',
    label: 'ค่าเสียหาย / ค่าปรับ',
    hint: 'หักจากเงินประกัน ส่วนที่เกินเงินประกันผู้เช่าจ่ายเพิ่ม',
    categories: [
      'ค่าทำความสะอาด',
      'ค่าซ่อมแซม / ของเสียหาย',
      'กุญแจ / คีย์การ์ดหาย',
      'ค่าปรับ',
      OTHER_CATEGORY
    ]
  },
  {
    key: 'discount_refund',
    label: 'คืนเงิน / ส่วนลด',
    hint: 'กรอกเป็นจำนวนบวก ระบบบวกคืนให้เอง',
    categories: ['คืนค่าเช่าล่วงหน้า', 'ส่วนลดพิเศษ', OTHER_CATEGORY]
  }
]

const EMPTY_FINAL_READINGS = {
  water: { current: '', isOverCycle: false, include: false },
  electric: { current: '', isOverCycle: false, include: false }
}

export default function MoveOutPage({ contract, room, onBack, onDone, signedBy }) {
  const [confirmDialog, ask] = useConfirm()
  const [moveOutDate, setMoveOutDate] = useState(todayIso())
  const [adjustments, setAdjustments] = useState([])
  // เลขมิเตอร์วันย้ายออก — ยอดเงินคิดที่ main
  const [finalReadings, setFinalReadings] = useState(EMPTY_FINAL_READINGS)
  const [sheet, setSheet] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  // null = ใช้ตามกฎ
  const [override, setOverride] = useState(null)
  const [overrideReason, setOverrideReason] = useState('')

  // ย้ายออกทั้งที่มีบิลค้าง (ผู้เช่าหนี) — ต้องมีเหตุผล
  const [allowOutstanding, setAllowOutstanding] = useState(false)
  const [outstandingReason, setOutstandingReason] = useState('')

  const [paymentMethod, setPaymentMethod] = useState('cash')
  // ยอดติดลบ = ผู้เช่าต้องจ่ายเพิ่ม · ค่าเริ่มต้นคือเก็บได้แล้ว
  const [collectShortfall, setCollectShortfall] = useState(true)

  const [previewing, setPreviewing] = useState(false)

  // คำนวณล่าสุดไม่ผ่าน = ล็อกปุ่มพิมพ์/ยืนยันจนกว่าจะคำนวณผ่าน
  const [sheetError, setSheetError] = useState('')

  // ดึงใหม่เมื่อวันที่ออก รายการ เลขมิเตอร์ หรือการข้ามกฎเปลี่ยน — ไม่คำนวณเองที่หน้าจอ
  const load = useCallback(async () => {
    const res = await getTerminationSheet({
      contractId: contract.contractId,
      moveOutDate,
      adjustments,
      overrideRefundable: override,
      finalReadings
    })
    if (!res.success) return setSheetError(res.error)
    setSheetError('')
    setSheet(res.data)
  }, [contract.contractId, moveOutDate, adjustments, override, finalReadings])

  useEffect(() => {
    load()
  }, [load])

  async function submit() {
    setError('')
    setBusy(true)
    const res = await completeTermination({
      contractId: contract.contractId,
      moveOutDate,
      adjustments,
      overrideRefundable: override,
      overrideReason,
      finalReadings,
      allowOutstanding,
      outstandingReason,
      collectShortfall,
      paymentMethod
    })
    setBusy(false)
    if (!res.success) return res
    showToast(`ย้ายออกห้อง ${room.roomNumber} เรียบร้อย`)
    setResult(res.data)
    return res
  }

  function confirmMoveOut() {
    const net = sheet.netRefundCents
    const money =
      net > 0
        ? `คืนเงินผู้เช่า ${formatBaht(net)} บาท`
        : net < 0
          ? collectShortfall
            ? `รับเงินส่วนต่างจากผู้เช่า ${formatBaht(-net)} บาท`
            : `ผู้เช่าค้างจ่าย ${formatBaht(-net)} บาท (ยังไม่ได้รับ)`
          : 'ไม่มีเงินคืนหรือเก็บเพิ่ม'
    ask({
      title: `ยืนยันย้ายออกห้อง ${room.roomNumber}?`,
      message: `${money} · สัญญาจะถูกปิดและห้องกลับเป็นห้องว่าง ย้อนกลับไม่ได้`,
      confirmLabel: 'ยืนยันย้ายออก',
      busyLabel: 'กำลังบันทึก...',
      icon: 'moveOuts',
      onConfirm: submit
    })
  }

  if (result) {
    return <MoveOutResult result={result} room={room} onDone={onDone} signedBy={signedBy} />
  }

  // ระหว่างพิมพ์แสดงแค่เอกสาร — printToPDF จับภาพหน้าที่แสดงอยู่
  if (previewing && sheet) {
    return (
      <>
        <MoveOutDocument termination={{ ...sheet, isDraft: true }} signedBy={signedBy} />
        <PrintDialog
          title="พิมพ์ใบสรุปการย้ายออก (ตัวอย่าง)"
          onClose={() => setPreviewing(false)}
          onPrinted={() => {
            setPreviewing(false)
            showToast('ส่งเอกสารเข้าเครื่องพิมพ์แล้ว')
          }}
        />
      </>
    )
  }

  const needsReason = override !== null && sheet && override !== sheet.isDepositRefundable

  const stale = Boolean(sheetError)

  const canConfirm =
    sheet &&
    !stale &&
    !sheet.meterError &&
    !(needsReason && overrideReason.trim() === '') &&
    !(sheet.hasOutstanding && !allowOutstanding) &&
    !(sheet.hasOutstanding && allowOutstanding && outstandingReason.trim() === '')

  return (
    <>
      <button type="button" className="link-btn link-back-inline" onClick={onBack}>
        <Icon name="back" />
        <span>กลับไปรายละเอียดห้อง</span>
      </button>

      <h2 className="room-detail-title">ยกเลิกสัญญา / ย้ายออก — ห้อง {room.roomNumber}</h2>
      {confirmDialog}
      <Alert>{error}</Alert>
      {stale && (
        <Alert kind="warn">
          {sheet ? 'ตัวเลขด้านล่างยังไม่อัปเดต — ' : ''}
          {sheetError}
        </Alert>
      )}

      {!sheet ? (
        !stale && <p className="muted">กำลังคำนวณ...</p>
      ) : (
        <>
          <section className="panel">
            <h3 className="panel-title">ใบแจ้งหนี้ค้างชำระ</h3>
            {sheet.outstandingInvoices.length === 0 ? (
              <p className="muted table-empty">ไม่มีใบแจ้งหนี้ค้างชำระ</p>
            ) : (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>เลขที่</th>
                      <th>รอบเดือน</th>
                      <th className="align-right">ยอดค้าง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.outstandingInvoices.map((invoice) => (
                      <tr key={invoice.invoiceId}>
                        <td>{invoice.invoiceNumber}</td>
                        <td>{invoice.billingMonth}</td>
                        <td className="align-right">{formatBaht(invoice.outstandingCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <Alert kind="warn">
                  <strong>ยังค้างชำระ {formatBaht(sheet.outstandingTotalCents)} บาท</strong> —
                  รับเงินที่ใบแจ้งหนี้ข้างบนให้ครบก่อนย้ายออก
                </Alert>

                <label className="checkbox-row move-out-check">
                  <input
                    type="checkbox"
                    checked={allowOutstanding}
                    onChange={(e) => {
                      setAllowOutstanding(e.target.checked)
                      if (!e.target.checked) setOutstandingReason('')
                    }}
                  />
                  <span>ย้ายออกทั้งที่ยังมีบิลค้าง (เช่น ผู้เช่าหนีไปแล้ว)</span>
                </label>

                {allowOutstanding && (
                  <div className="field field-required">
                    <label htmlFor="outstandingReason">
                      เหตุผล <span className="required">* จำเป็น</span>
                    </label>
                    <textarea
                      id="outstandingReason"
                      rows={2}
                      value={outstandingReason}
                      onChange={(e) => setOutstandingReason(e.target.value)}
                      placeholder="เช่น ผู้เช่าย้ายออกเองโดยไม่แจ้งและติดต่อไม่ได้"
                    />
                    <p className="field-hint">
                      บิลยังค้างให้ตามเก็บต่อ ไม่หักจากเงินประกัน
                    </p>
                  </div>
                )}
              </>
            )}
          </section>

          <DepositVerdict
            sheet={sheet}
            override={override}
            onOverride={setOverride}
            overrideReason={overrideReason}
            onOverrideReason={setOverrideReason}
          />

          <FinalMeterCard
            meter={sheet.meter}
            readings={finalReadings}
            onChange={(side, patch) =>
              setFinalReadings((all) => ({ ...all, [side]: { ...all[side], ...patch } }))
            }
          />

          {/* แสดงจาก adjustments ที่ผู้ใช้เพิ่ม ไม่ใช่จากผลคำนวณ (ลบได้เสมอ) */}
          <AdjustmentsCard
            items={adjustments}
            onAdd={(item) => setAdjustments((list) => [...list, item])}
            onRemove={(index) => setAdjustments((list) => list.filter((_, i) => i !== index))}
          />

          <section className={'panel move-out-summary' + (stale ? ' is-stale' : '')}>
            <p className="move-out-total">
              สรุปค่าใช้จ่าย{' '}
              {sheet.netRefundCents >= 0 ? (
                <strong className="move-out-refund">คืนเงิน {formatBaht(sheet.netRefundCents)} บาท</strong>
              ) : (
                <strong className="move-out-owed">
                  ผู้เช่าค้างจ่ายอีก {formatBaht(-sheet.netRefundCents)} บาท
                </strong>
              )}
            </p>
            <p className="field-hint move-out-formula">
              เงินประกัน {formatBaht(sheet.depositReceivedCents)} − ค่าเสียหาย{' '}
              {formatBaht(sheet.damageTotalCents)}
              {sheet.forfeitedCents > 0 && ` − ริบ ${formatBaht(sheet.forfeitedCents)}`}
              {sheet.meterTotalCents > 0 && ` − ค่าน้ำ-ค่าไฟ ${formatBaht(sheet.meterTotalCents)}`}
              {sheet.refundItemsTotalCents > 0 &&
                ` + คืนให้ผู้เช่า ${formatBaht(sheet.refundItemsTotalCents)}`}
            </p>

            {/* ยอดติดลบต้องออกใบเสร็จรับเงินส่วนต่าง */}
            {sheet.netRefundCents < 0 && (
              <div className="move-out-shortfall">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={collectShortfall}
                    onChange={(e) => setCollectShortfall(e.target.checked)}
                  />
                  <span>
                    รับเงินส่วนต่าง {formatBaht(-sheet.netRefundCents)} บาท จากผู้เช่าแล้ว
                    (ออกใบเสร็จให้)
                  </span>
                </label>
                {!collectShortfall && (
                  <p className="field-hint">
                    ไม่ออกใบเสร็จ · ใบสรุปจะขึ้นว่ายังค้างชำระ
                  </p>
                )}
              </div>
            )}

            <div className="move-out-confirm">
              <div className="field">
                <label htmlFor="moveOutDate">วันที่ออก</label>
                <DateField id="moveOutDate" value={moveOutDate} onChange={setMoveOutDate} />
              </div>

              {(sheet.netRefundCents > 0 || (sheet.netRefundCents < 0 && collectShortfall)) && (
                <div className="field">
                  <label htmlFor="moveOutMethod">
                    {sheet.netRefundCents > 0 ? 'คืนเงินโดย' : 'รับเงินโดย'}
                  </label>
                  <select
                    id="moveOutMethod"
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
              )}
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setPreviewing(true)}
                disabled={stale}
              >
                <Icon name="printer" />
                <span>พิมพ์ใบสรุปให้ผู้เช่า</span>
              </button>

              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmMoveOut}
                disabled={busy || !canConfirm}
              >
                {busy ? 'กำลังบันทึก...' : 'ยืนยันย้ายออก'}
              </button>
            </div>
            {stale && (
              <p className="field-hint">ตัวเลขยังไม่อัปเดต — แก้ข้อที่ผิดก่อนจึงจะพิมพ์หรือยืนยันได้</p>
            )}
            {sheet.meterError && (
              <p className="field-hint">ต้องแก้เลขมิเตอร์วันย้ายออกให้ถูกก่อนจึงจะยืนยันได้</p>
            )}
            {needsReason && overrideReason.trim() === '' && (
              <p className="field-hint">ต้องกรอกเหตุผลที่ตัดสินต่างจากกฎก่อนจึงจะยืนยันได้</p>
            )}
            {sheet.hasOutstanding && !allowOutstanding && (
              <p className="field-hint">ต้องเคลียร์บิลค้างชำระให้ครบก่อนจึงจะยืนยันได้</p>
            )}
            {sheet.hasOutstanding && allowOutstanding && outstandingReason.trim() === '' && (
              <p className="field-hint">ต้องกรอกเหตุผลที่ให้ย้ายออกทั้งที่ยังค้างบิลก่อน</p>
            )}
          </section>
        </>
      )}
    </>
  )
}

function DepositVerdict({ sheet, override, onOverride, overrideReason, onOverrideReason }) {
  const systemSaysRefund = sheet.isDepositRefundable
  const current = sheet.appliedRefundable
  const isOverriding = override !== null && override !== systemSaysRefund

  return (
    <section className="panel">
      <h3 className="panel-title">เงินประกัน</h3>

      <dl className="contract-rows">
        <div className="contract-row">
          <dt>รับมาแล้ว</dt>
          <dd>{formatBaht(sheet.depositReceivedCents)}</dd>
        </div>
        <div className="contract-row">
          <dt>อยู่มาแล้ว</dt>
          <dd>
            {sheet.monthsStayed} เดือน
            {sheet.requiredMonths ? ` (สัญญากำหนด ${sheet.requiredMonths} เดือน)` : ' (ไม่กำหนดระยะ)'}
            {sheet.isRenewal && (
              <span className="field-hint"> นับต่อเนื่องจากสัญญาใบแรก ({sheet.chainStartDate})</span>
            )}
          </dd>
        </div>
        <div className="contract-row">
          <dt>แจ้งล่วงหน้า</dt>
          <dd>
            {sheet.isNoticeGiven
              ? `${sheet.noticeDaysGiven} วัน (แจ้งเมื่อ ${sheet.noticeDate})`
              : 'ไม่ได้แจ้งล่วงหน้า'}
            {` · สัญญากำหนด ${sheet.requiredNoticeDays} วัน`}
          </dd>
        </div>
      </dl>

      <div className={'verdict-box' + (current ? ' verdict-refund' : ' verdict-forfeit')}>
        <strong>
          {current
            ? `คืนเงินประกัน ${formatBaht(sheet.depositRefundCents)} บาท`
            : `ริบเงินประกัน ${formatBaht(sheet.forfeitedCents)} บาท`}
          {isOverriding && ' (เจ้าของหอตัดสินเอง)'}
        </strong>
        {!systemSaysRefund && <span>ตามกฎของสัญญา: {sheet.forfeitReasonLabel}</span>}
        {systemSaysRefund && <span>ตามกฎของสัญญา: อยู่ครบกำหนดและแจ้งล่วงหน้าครบ</span>}
      </div>

      <label className="checkbox-row move-out-check">
        <input
          type="checkbox"
          checked={isOverriding}
          onChange={(e) => {
            onOverride(e.target.checked ? !systemSaysRefund : null)
            if (!e.target.checked) onOverrideReason('')
          }}
        />
        <span>ตัดสินต่างจากกฎ — {systemSaysRefund ? 'ริบเงินประกัน' : 'คืนเงินประกันให้'}</span>
      </label>

      {isOverriding && (
        <div className="field field-required">
          <label htmlFor="overrideReason">
            เหตุผล <span className="required">* จำเป็น</span>
          </label>
          <textarea
            id="overrideReason"
            rows={2}
            value={overrideReason}
            onChange={(e) => onOverrideReason(e.target.value)}
            placeholder="เช่น ผู้เช่าย้ายออกเพราะหอซ่อมท่อน้ำ ไม่ใช่ความผิดผู้เช่า"
          />
        </div>
      )}
    </section>
  )
}

// เลขครั้งก่อนและเรตมาจากห้อง — กรอกแค่เลขวันย้ายออก (ห้องเหมาจ่ายเลือกว่าจะเก็บหรือไม่)
function FinalMeterCard({ meter, readings, onChange }) {
  if (meter.sides.length === 0) return null

  return (
    <section className="panel">
      <h3 className="panel-title">ค่าน้ำ-ค่าไฟงวดสุดท้าย</h3>

      <table className="data-table move-out-meter">
        <thead>
          <tr>
            <th>รายการ</th>
            <th className="align-right">เลขครั้งก่อน</th>
            <th>เลขวันย้ายออก</th>
            <th className="align-right">หน่วยที่ใช้</th>
            <th className="align-right">ยอดเงิน</th>
          </tr>
        </thead>
        <tbody>
          {meter.sides.map((side) => (
            <FinalMeterRow
              key={side.side}
              side={side}
              reading={readings[side.side]}
              onChange={(patch) => onChange(side.side, patch)}
            />
          ))}
        </tbody>
      </table>
    </section>
  )
}

function FinalMeterRow({ side, reading, onChange }) {
  const isFlat = side.billingType === 'flat'
  const inputId = `finalMeter-${side.side}`
  // เลขน้อยกว่าครั้งก่อน = อาจเกินรอบมิเตอร์ จึงค่อยแสดงตัวเลือก
  const typed = Number(String(reading.current).replace(/,/g, ''))
  const showOverCycle =
    reading.isOverCycle ||
    (reading.current.trim() !== '' && Number.isFinite(typed) && typed < side.previousReading)

  return (
    <tr>
      <td>
        {side.label}
        <p className="field-hint">{rateText(side)}</p>
        {side.isUnpriced && <p className="field-hint negative">ห้องนี้ยังไม่ได้ตั้งราคา</p>}
        {side.unbilledBatchDate && (
          <p className="field-hint negative">
            รอบจด {side.unbilledBatchDate} ยังไม่ได้ออกบิล — ออกบิลรอบนั้นก่อน
          </p>
        )}
      </td>
      <td className="align-right">
        {isFlat ? (
          '-'
        ) : (
          <>
            {side.previousReading}
            <p className="field-hint">
              {side.previousSource === 'batch'
                ? `จดเมื่อ ${side.previousDate}`
                : `เลขวันเข้าพัก ${side.previousDate}`}
            </p>
          </>
        )}
      </td>
      <td>
        {isFlat ? (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={reading.include}
              onChange={(e) => onChange({ include: e.target.checked })}
            />
            <span>เก็บงวดสุดท้าย</span>
          </label>
        ) : (
          <div className={fieldClass('field', side.error)}>
            <input
              id={inputId}
              inputMode="decimal"
              aria-label={`เลขมิเตอร์${side.label}วันย้ายออก`}
              value={reading.current}
              onChange={(e) => onChange({ current: e.target.value })}
              {...invalidProps(inputId, side.error)}
            />
            <FieldError id={`${inputId}-error`} message={side.error} />
            {showOverCycle && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={reading.isOverCycle}
                  onChange={(e) => onChange({ isOverCycle: e.target.checked })}
                />
                <span>เกินรอบมิเตอร์</span>
              </label>
            )}
          </div>
        )}
      </td>
      <td className="align-right">{side.unitsUsed ?? '-'}</td>
      <td className="align-right">
        {side.isCharged ? formatBaht(side.totalCents) : '-'}
        {side.isCharged && side.isMinimumApplied && (
          <p className="field-hint">คิดขั้นต่ำ {formatBaht(side.minChargeCents)} บาท</p>
        )}
        {side.isCharged && side.vatCents > 0 && (
          <p className="field-hint">รวม VAT {formatBaht(side.vatCents)}</p>
        )}
      </td>
    </tr>
  )
}

function rateText(side) {
  if (side.billingType === 'flat') return `เหมาจ่าย ${formatBaht(side.flatRateCents)} บาท/เดือน`
  const perUnit = `${formatBaht(side.unitPriceCents)} บาท/หน่วย`
  return side.billingType === 'minimum'
    ? `${perUnit} · ขั้นต่ำ ${formatBaht(side.minChargeCents)} บาท`
    : perUnit
}

// ยังไม่ส่งไป main จนกว่าจะยืนยัน — ตรวจที่หน้าจอ · amount เป็นข้อความบาท
function AdjustmentsCard({ items, onAdd, onRemove }) {
  const [confirmDialog, ask] = useConfirm()
  const [tab, setTab] = useState(ITEM_TABS[0])
  const [category, setCategory] = useState(ITEM_TABS[0].categories[0])
  const [detail, setDetail] = useState('')
  const [amount, setAmount] = useState('')
  const { errors, fromResult, clear, reset } = useFormErrors(['description', 'amount'])

  function selectTab(next) {
    reset()
    setTab(next)
    setCategory(next.categories[0])
  }

  function add() {
    reset()
    const fields = {}
    const note = detail.trim()
    if (category === OTHER_CATEGORY && !note) fields.description = 'กรุณาระบุรายละเอียด'
    // กติกาเดียวกับ toCents ฝั่ง main
    const cents = bahtInputToCents(amount)
    if (cents === null) fields.amount = 'จำนวนเงินต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง'
    else if (cents === 0) fields.amount = 'จำนวนเงินต้องมากกว่า 0'
    if (Object.keys(fields).length > 0) return fromResult({ fields })

    // main เก็บเป็นชื่อรายการบรรทัดเดียว
    const description =
      category === OTHER_CATEGORY ? note : note ? `${category} — ${note}` : category
    onAdd({ itemType: tab.key, description, amount })
    setDetail('')
    setAmount('')
  }

  return (
    <section className="panel">
      <h3 className="panel-title">รายการเก็บเงิน / คืนเงินเพิ่มเติม</h3>
      {confirmDialog}

      {items.length > 0 && (
        <table className="data-table">
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.description}-${index}`}>
                <td>
                  {item.description}
                  <span className="field-hint"> {itemTypeLabel(item.itemType)}</span>
                </td>
                <td className="align-right">
                  <span className={signedCents(item) < 0 ? 'negative' : undefined}>
                    {formatBaht(signedCents(item))}
                  </span>
                </td>
                <td className="align-right">
                  <button
                    type="button"
                    className="link-btn link-danger table-action icon-only"
                    onClick={() =>
                      ask({
                        title: `ลบรายการ "${item.description}"?`,
                        message: 'ยอดสรุปการย้ายออกจะถูกคิดใหม่',
                        confirmLabel: 'ลบรายการ',
                        onConfirm: () => {
                          onRemove(index)
                          return { success: true }
                        }
                      })
                    }
                    aria-label={`ลบรายการ ${item.description}`}
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mode-tabs">
        {ITEM_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={'mode-tab' + (t.key === tab.key ? ' active' : '')}
            onClick={() => selectTab(t)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab.hint && <p className="field-hint invoice-tab-hint">{tab.hint}</p>}

      <div className="field-row">
        <div className="field">
          <label htmlFor="adjustmentCategory">หมวด</label>
          <select
            id="adjustmentCategory"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              clear('description')
            }}
          >
            {tab.categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className={fieldClass('field', errors.description)}>
          <label htmlFor="adjustmentName">
            รายละเอียด{' '}
            {category !== OTHER_CATEGORY && <span className="optional">(ไม่บังคับ)</span>}
          </label>
          <input
            id="adjustmentName"
            value={detail}
            onChange={(e) => {
              setDetail(e.target.value)
              clear('description')
            }}
            {...invalidProps('adjustmentName', errors.description)}
          />
          <FieldError id="adjustmentName-error" message={errors.description} />
        </div>
        <div className={fieldClass('field', errors.amount)}>
          <label htmlFor="adjustmentAmount">จำนวนเงิน</label>
          <input
            id="adjustmentAmount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              clear('amount')
            }}
            {...invalidProps('adjustmentAmount', errors.amount)}
          />
          <FieldError id="adjustmentAmount-error" message={errors.amount} />
        </div>
      </div>

      <div className="card-foot">
        <span className="move-out-adjust-total">
          รวมเป็นเงิน {formatBaht(items.reduce((sum, item) => sum + signedCents(item), 0))}
        </span>
        <button type="button" className="btn" onClick={add}>
          เพิ่ม
        </button>
      </div>
    </section>
  )
}

function MoveOutResult({ result, room, onDone, signedBy }) {
  const [printing, setPrinting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onSavePdf() {
    setError('')
    setBusy(true)
    const res = await savePdf(`ใบสรุปการย้ายออก-ห้อง${result.roomNumber}-${result.moveOutDate}`)
    setBusy(false)
    if (!res.success) return setError(res.error)
    if (res.data.cancelled) return
    showToast('บันทึกไฟล์ PDF แล้ว')
    revealPdf(res.data.filePath)
  }

  return (
    <>
      <h2 className="room-detail-title">รายละเอียดการย้ายออก — ห้อง {room.roomNumber}</h2>
      <Alert>{error}</Alert>

      {result.unpaidBalanceCents > 0 && (
        <Alert kind="warn">
          ยังไม่ได้รับเงินส่วนต่าง {formatBaht(result.unpaidBalanceCents)} บาท — ใบสรุปขึ้นว่ายังค้างชำระ
        </Alert>
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

        <MoveOutDocument termination={result} signedBy={signedBy} />
      </section>

      <div className="card-foot move-out-done">
        <button type="button" className="btn" onClick={onDone}>
          เสร็จสิ้น
        </button>
      </div>

      {printing && (
        <PrintDialog
          title="พิมพ์ใบสรุปการย้ายออก"
          onClose={() => setPrinting(false)}
          onPrinted={() => {
            setPrinting(false)
            showToast('ส่งเอกสารเข้าเครื่องพิมพ์แล้ว')
          }}
        />
      )}
    </>
  )
}

function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// กติกาเดียวกับ toCents ใน main/money.js · ผิดรูปแบบ = null
function bahtInputToCents(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [baht, satang = ''] = cleaned.split('.')
  const cents = Number(baht) * 100 + Number(satang.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

// ส่วนลดแสดงเป็นลบ (ผู้ใช้กรอกเป็นบวก)
function signedCents(item) {
  const cents = bahtInputToCents(item.amount) ?? 0
  return item.itemType === 'discount_refund' ? -cents : cents
}

function itemTypeLabel(itemType) {
  return ITEM_TABS.find((t) => t.key === itemType)?.label ?? itemType
}
