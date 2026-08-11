import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import DateField from '../components/DateField.jsx'
import { showToast } from '../components/Toast.jsx'
import { formatBaht } from '../format.js'
import { PAYMENT_METHODS } from '../constants.js'
import MoveOutDocument from '../components/MoveOutDocument.jsx'
import PrintDialog from '../components/PrintDialog.jsx'
import { revealPdf, savePdf } from '../services/printService.js'
import { completeTermination, getTerminationSheet } from '../services/terminationService.js'

// หน้าสรุปย้ายออก — โครงตามคู่มือต้นแบบ (yeeraf "ยกเลิกสัญญาเช่า / ย้ายออก" ขั้น 5-7):
//   กล่อง 1 ใบแจ้งหนี้ค้างชำระ · กล่อง 2 เงินประกัน · กล่อง 3 รายการเก็บเงิน/คืนเงินเพิ่มเติม
//   → สรุปค่าใช้จ่าย + วันที่ออก + ยืนยัน → หน้ารายละเอียดการย้ายออก
//
// **สิ่งที่ต้นแบบไม่มี: กล่อง "ผลการตัดสิน"** — ต้นแบบคืนเงินประกันเสมอ (เงินประกัน − หนี้)
// ส่วนหอนี้มีกฎริบที่ snapshot ไว้ที่สัญญาตั้งแต่ migration 004 จึงต้องบอกให้ชัดว่า
// ตัดสินว่าอะไร เพราะอะไร ก่อนที่เจ้าของหอจะกดยืนยัน
const ITEM_TABS = [
  { key: 'service', label: 'ค่าบริการ', hint: 'ค่าใช้จ่ายที่เรียกเก็บเพิ่ม เช่น ค่า keycard หาย ค่าทำความสะอาด' },
  {
    key: 'meter',
    label: 'ค่ามิเตอร์',
    hint: 'ค่าน้ำ-ค่าไฟงวดสุดท้ายที่ยังไม่เคยออกบิล (ย้ายออกก่อนถึงรอบจดมิเตอร์ถัดไป)'
  },
  { key: 'discount_refund', label: 'ส่วนลด / คืนเงิน', hint: 'กรอกเป็นจำนวนบวก ระบบจะบวกกลับเข้ายอดเงินคืนให้เอง' }
]

export default function MoveOutPage({ contract, room, onBack, onDone, signedBy }) {
  const [moveOutDate, setMoveOutDate] = useState(todayIso())
  const [adjustments, setAdjustments] = useState([])
  const [sheet, setSheet] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // ผลลัพธ์หลังยืนยัน — มีค่าเมื่อไหร่แปลว่าย้ายออกเสร็จแล้ว หน้าเปลี่ยนเป็นใบสรุป
  const [result, setResult] = useState(null)

  // เจ้าของกดข้ามผลการตัดสินของระบบ — null = ใช้ตามกฎ
  const [override, setOverride] = useState(null)
  const [overrideReason, setOverrideReason] = useState('')

  // ยอมให้ย้ายออกทั้งที่ยังมีบิลค้าง (ผู้เช่าหนีไป) — ต้องมีเหตุผลเสมอ
  const [allowOutstanding, setAllowOutstanding] = useState(false)
  const [outstandingReason, setOutstandingReason] = useState('')

  // ช่องทางของเงินที่เคลื่อนในวันย้ายออก (คืนให้ผู้เช่า หรือรับส่วนต่างจากผู้เช่า)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  // ยอดสุทธิติดลบ = ผู้เช่าต้องจ่ายเพิ่ม · ค่าตั้งต้นคือเก็บได้แล้ว เพราะเจ้าของหอตรวจห้อง
  // แล้วบอกผู้เช่าตรงนั้น ผู้เช่าจ่ายก่อนออกจากหอ — เก็บไม่ได้เป็นกรณียกเว้น
  const [collectShortfall, setCollectShortfall] = useState(true)

  // พิมพ์ใบสรุปตัวอย่างก่อนกดยืนยัน — ผู้ใช้สั่ง 2026-08-11: ต้องยื่นให้ผู้เช่าดูก่อนเขา
  // ออกจากหอ ไม่ใช่พิมพ์ได้หลังปิดสัญญาไปแล้วซึ่งผู้เช่าเดินไปแล้ว
  const [previewing, setPreviewing] = useState(false)

  // ดึงใหม่ทุกครั้งที่วันที่ออก รายการ **หรือช่องติ๊กข้ามกฎ** เปลี่ยน
  // (สูตรอยู่ฝั่ง main ที่เดียว หน้าจอไม่คำนวณเองเด็ดขาด)
  //
  // 🔴 เดิม `override` ไม่ได้อยู่ในรายการนี้ และ API ก็ไม่รับมันด้วย ยอดสรุปจึงค้างเป็นของ
  // "ตามกฎ" ตลอด ต่อให้ติ๊กว่าจะคืนเงินให้ ตัวเลขที่ถูกไปโผล่ตอนกดยืนยันซึ่งสายไปแล้ว
  const load = useCallback(async () => {
    const res = await getTerminationSheet({
      contractId: contract.contractId,
      moveOutDate,
      adjustments,
      overrideRefundable: override
    })
    if (!res.success) return setError(res.error)
    setError('')
    setSheet(res.data)
  }, [contract.contractId, moveOutDate, adjustments, override])

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
      allowOutstanding,
      outstandingReason,
      collectShortfall,
      paymentMethod
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    showToast(`ย้ายออกห้อง ${room.roomNumber} เรียบร้อย`)
    setResult(res.data)
  }

  if (result) {
    return <MoveOutResult result={result} room={room} onDone={onDone} signedBy={signedBy} />
  }

  // ระหว่างพิมพ์ตัวอย่าง หน้าจอแสดงเฉพาะตัวเอกสาร เพราะ printToPDF จับภาพหน้าที่แสดงอยู่
  // (วิธีเดียวกับหน้ารายงานใบเสร็จและการพิมพ์ใบแจ้งหนี้ทั้งหอ)
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

  // ด่านทั้งสองต้องผ่านก่อนปุ่มยืนยันจะกดได้ — ปิดปุ่มไว้ดีกว่าปล่อยให้กดแล้วเจอ error
  // (ฝั่ง main บังคับซ้ำอยู่แล้ว ล็อกที่หน้าจออย่างเดียวไม่เคยพอ)
  const canConfirm =
    sheet &&
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
      <Alert>{error}</Alert>

      {!sheet ? (
        <p className="muted">กำลังคำนวณ...</p>
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

                {/* กติกาของหอ (เจ้าของหอยืนยัน 2026-08-11): ต้องเคลียร์บิลให้หมดก่อนย้ายออก
                    ระบบไม่หักจากเงินประกันให้เอง — ถ้าตกลงหักจริง ให้ไปกดรับเงินที่บิลใบนั้น
                    ตามปกติก่อน เงินก้อนนั้นจะได้มีใบเสร็จของตัวเอง */}
                <Alert kind="warn">
                  <strong>ต้องเคลียร์บิลค้างชำระให้ครบก่อนย้ายออก</strong> — ยังค้างอยู่{' '}
                  {formatBaht(sheet.outstandingTotalCents)} บาท · ไปกดรับเงินที่ใบแจ้งหนี้เหล่านี้
                  ก่อน แล้วกลับมาที่หน้านี้อีกครั้ง
                </Alert>

                {/* ผู้เช่าที่หนีไปเฉยๆ ยังต้องปิดสัญญาได้ ไม่งั้นห้องจะติดอยู่กับหนี้ที่ไม่มีวัน
                    ได้คืนตลอดไป แล้วปล่อยห้องใหม่ไม่ได้ */}
                <div className="field checkbox-row">
                  <label>
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
                </div>

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
                      บิลจะยังค้างอยู่ในระบบให้ตามเก็บต่อ ไม่ได้ถูกปิดหรือหักจากเงินประกัน
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

          <AdjustmentsCard
            items={sheet.items}
            onAdd={(item) => setAdjustments((list) => [...list, item])}
            onRemove={(index) => setAdjustments((list) => list.filter((_, i) => i !== index))}
            totalCents={sheet.adjustmentsTotalCents}
            onError={setError}
          />

          <section className="panel move-out-summary">
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
            {/* สูตรเขียนไว้ตรงหน้าคนกด — เงินประกันมีไว้รองรับความเสียหาย ค่าซ่อมจึงหักจาก
                ก้อนนี้เสมอ ส่วนค่ามิเตอร์กับบิลเป็นคนละเรื่อง ไม่แตะเงินประกัน */}
            <p className="field-hint move-out-formula">
              เงินประกัน {formatBaht(sheet.depositReceivedCents)} − ค่าเสียหาย{' '}
              {formatBaht(sheet.damageTotalCents)}
              {sheet.forfeitedCents > 0 && ` − ริบ ${formatBaht(sheet.forfeitedCents)}`}
              {sheet.meterTotalCents > 0 && ` − ค่ามิเตอร์ ${formatBaht(sheet.meterTotalCents)}`}
              {sheet.refundItemsTotalCents > 0 &&
                ` + คืนให้ผู้เช่า ${formatBaht(sheet.refundItemsTotalCents)}`}
            </p>

            {/* 🔴 ยอดติดลบ = **เงินไหลเข้าหอ** ไม่ใช่ "ไม่มีอะไรเกิดขึ้น" — ต้องออกใบเสร็จให้
                ไม่งั้นระบบไม่รู้ว่าเก็บมาแล้วหรือยัง และผู้เช่าไม่ได้หลักฐานว่าจ่ายอะไรไป
                (ผู้ใช้เจอตอนทดสอบจริง 2026-08-11) */}
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
                    ไม่ออกใบเสร็จ — ยอดนี้จะขึ้นในใบสรุปการย้ายออกว่ายังค้างชำระ
                  </p>
                )}
              </div>
            )}

            <div className="move-out-confirm">
              <div className="field">
                <label htmlFor="moveOutDate">วันที่ออก</label>
                <DateField id="moveOutDate" value={moveOutDate} onChange={setMoveOutDate} />
              </div>

              {/* ช่องทางโผล่เฉพาะเมื่อมีเงินเคลื่อนจริง — ยอดสุทธิเป็น 0 ไม่มีใบเสร็จให้ออก */}
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
              {/* ยื่นใบสรุปให้ผู้เช่าดูก่อนกดยืนยัน — หลังยืนยันแล้วผู้เช่าเดินไปแล้ว
                  และการทักท้วงตัวเลขหลังปิดสัญญาไปแล้วแก้อะไรไม่ได้ */}
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setPreviewing(true)}
              >
                <Icon name="printer" />
                <span>พิมพ์ใบสรุปให้ผู้เช่า</span>
              </button>

              <button
                type="button"
                className="btn btn-danger"
                onClick={submit}
                disabled={busy || !canConfirm}
              >
                {busy ? 'กำลังบันทึก...' : 'ยืนยันย้ายออก'}
              </button>
            </div>
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

// ------------------------------------------------------------------
// ผลการตัดสินเรื่องเงินประกัน — กล่องที่ต้นแบบไม่มี
// ------------------------------------------------------------------
// แสดง "ตัวเลขที่ใช้ตัดสิน" ให้เห็นครบ ไม่ใช่บอกแค่ผลลัพธ์ — เจ้าของหอต้องตรวจได้เองว่า
// ระบบนับเดือนถูกไหม ก่อนจะบอกผู้เช่าว่าไม่ได้เงินคืน
function DepositVerdict({ sheet, override, onOverride, overrideReason, onOverrideReason }) {
  const systemSaysRefund = sheet.isDepositRefundable
  // ผลที่ใช้จริงมาจากฝั่ง main แล้ว (sheet คิดใหม่เมื่อติ๊กช่องนี้) ไม่ต้องเดาเองบนหน้าจอ
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
            {/* ต่อสัญญามาต้องบอก ไม่งั้น "อยู่มาแล้ว 14 เดือน" ของสัญญาที่เพิ่งเริ่มสองเดือนก่อน
                จะดูเหมือนคำนวณผิด ทั้งที่นับทั้งสายการต่อสัญญามาถูกแล้ว */}
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
          {/* บอกยอดจริงหลังหักค่าเสียหายแล้ว ไม่ใช่คำว่า "เต็มจำนวน" ซึ่งไม่จริงเมื่อมีค่าซ่อม */}
          {current
            ? `คืนเงินประกัน ${formatBaht(sheet.depositRefundCents)} บาท`
            : `ริบเงินประกัน ${formatBaht(sheet.forfeitedCents)} บาท`}
          {isOverriding && ' (เจ้าของหอตัดสินเอง)'}
        </strong>
        {!systemSaysRefund && <span>ตามกฎของสัญญา: {sheet.forfeitReasonLabel}</span>}
        {systemSaysRefund && <span>ตามกฎของสัญญา: อยู่ครบกำหนดและแจ้งล่วงหน้าครบ</span>}
      </div>

      {/* เปิดช่องนี้ไว้เพราะถ้าไม่เปิด เจ้าของจะเลี่ยงไปพิมพ์เป็น "รายการคืนเงินเพิ่มเติม" แทน
          แล้วเหตุผลจริงจะหายไปจากประวัติ กลายเป็นตัวเลขลอยๆ ที่ไม่มีใครอธิบายได้ (ดู 004) */}
      <div className="field checkbox-row">
        <label>
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
      </div>

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

// ------------------------------------------------------------------
// รายการเก็บเงิน/คืนเงินเพิ่มเติม — สามแท็บตามต้นแบบ
// ------------------------------------------------------------------
function AdjustmentsCard({ items, onAdd, onRemove, totalCents, onError }) {
  const [tab, setTab] = useState(ITEM_TABS[0])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')

  function add() {
    onError('')
    if (!description.trim()) return onError('กรุณาระบุชื่อรายการ')
    if (!(Number(amount) > 0)) return onError('จำนวนเงินต้องมากกว่า 0')
    onAdd({ itemType: tab.key, description, amount })
    setDescription('')
    setAmount('')
  }

  return (
    <section className="panel">
      <h3 className="panel-title">รายการเก็บเงิน / คืนเงินเพิ่มเติม</h3>

      {items.length > 0 && (
        <table className="data-table">
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.description}-${index}`}>
                <td>
                  {item.description}
                  <span className="field-hint"> {item.itemTypeLabel}</span>
                </td>
                <td className="align-right">
                  <span className={item.amountCents < 0 ? 'negative' : undefined}>
                    {formatBaht(item.amountCents)}
                  </span>
                </td>
                <td className="align-right">
                  <button
                    type="button"
                    className="link-btn link-danger table-action icon-only"
                    onClick={() => onRemove(index)}
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
            onClick={() => setTab(t)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="field-hint invoice-tab-hint">{tab.hint}</p>

      <div className="field-row">
        <div className="field">
          <label htmlFor="adjustmentName">ชื่อรายการ</label>
          <input
            id="adjustmentName"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="adjustmentAmount">จำนวนเงิน</label>
          <input
            id="adjustmentAmount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>

      <div className="card-foot">
        <span className="move-out-adjust-total">รวมเป็นเงิน {formatBaht(totalCents)}</span>
        <button type="button" className="btn" onClick={add}>
          เพิ่ม
        </button>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------
// หลังยืนยัน — ตรงกับหน้า "รายละเอียดการย้ายออก" ของต้นแบบ
// ------------------------------------------------------------------
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
          ยังไม่ได้รับเงินส่วนต่าง {formatBaht(result.unpaidBalanceCents)} บาท — ยอดนี้ขึ้นในใบสรุป
          ว่ายังค้างชำระ และไม่มีใบเสร็จรับเงินออกให้
        </Alert>
      )}

      <section className="panel invoice-doc">
        {/* ปุ่มถูกซ่อนตอนพิมพ์ด้วย @media print (คลาส invoice-doc-tools) ไม่ติดไปบนกระดาษ */}
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

// ------------------------------------------------------------------
function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
