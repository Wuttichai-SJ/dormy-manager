import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import DateField from '../components/DateField.jsx'
import { showToast } from '../components/Toast.jsx'
import { formatBaht } from '../format.js'
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

export default function MoveOutPage({ contract, room, onBack, onDone }) {
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

  // ดึงใหม่ทุกครั้งที่วันที่ออกหรือรายการเปลี่ยน — ทั้งผลการตัดสินและยอดสุทธิขยับตามวันที่
  // (สูตรอยู่ฝั่ง main ที่เดียว หน้าจอไม่คำนวณเองเด็ดขาด)
  const load = useCallback(async () => {
    const res = await getTerminationSheet({
      contractId: contract.contractId,
      moveOutDate,
      adjustments
    })
    if (!res.success) return setError(res.error)
    setError('')
    setSheet(res.data)
  }, [contract.contractId, moveOutDate, adjustments])

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
      overrideReason
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    showToast(`ย้ายออกห้อง ${room.roomNumber} เรียบร้อย`)
    setResult(res.data)
  }

  if (result) {
    return <MoveOutResult result={result} room={room} onDone={onDone} />
  }

  const refundable = override === null ? sheet?.isDepositRefundable : override
  const needsReason = override !== null && sheet && override !== sheet.isDepositRefundable

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
            <p className="field-hint move-out-formula">
              คำนวณจาก เงินประกันที่คืนได้ − ยอดรวมใบแจ้งหนี้ค้างชำระ − รายการเงินเพิ่มเติม
            </p>

            {/* กติกาที่ผู้ใช้ตัดสินใจ 2026-08-11 — ต้องเขียนไว้ตรงหน้าคนกด ไม่ใช่ซ่อนในโค้ด */}
            {refundable === false && sheet.outstandingTotalCents > 0 && (
              <Alert kind="warn">
                เงินประกันถูกริบ จึง<strong>นำไปหักหนี้ไม่ได้</strong> — ใบแจ้งหนี้ค้างชำระ{' '}
                {formatBaht(sheet.outstandingTotalCents)} บาท จะยังค้างอยู่ในระบบให้ตามเก็บต่อ
              </Alert>
            )}
            {refundable !== false && sheet.settledFromDepositCents > 0 && (
              <Alert kind="warn">
                เมื่อกดยืนยัน ใบแจ้งหนี้ค้างชำระจะถูกหักออกจากเงินประกัน{' '}
                {formatBaht(sheet.settledFromDepositCents)} บาท และถูกทำเครื่องหมายว่าชำระแล้ว
              </Alert>
            )}
            {sheet.netRefundCents < 0 && (
              <p className="field-hint">
                ยอดติดลบไม่มีการออกใบเสร็จคืนเงิน — เป็นยอดที่ผู้เช่ายังต้องจ่าย ไม่ใช่เงินที่หอต้องคืน
              </p>
            )}

            <div className="move-out-confirm">
              <div className="field">
                <label htmlFor="moveOutDate">วันที่ออก</label>
                <DateField id="moveOutDate" value={moveOutDate} onChange={setMoveOutDate} />
              </div>
              <button
                type="button"
                className="btn btn-danger"
                onClick={submit}
                disabled={busy || (needsReason && overrideReason.trim() === '')}
              >
                {busy ? 'กำลังบันทึก...' : 'ยืนยันย้ายออก'}
              </button>
            </div>
            {needsReason && overrideReason.trim() === '' && (
              <p className="field-hint">ต้องกรอกเหตุผลที่ตัดสินต่างจากกฎก่อนจึงจะยืนยันได้</p>
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
  const current = override === null ? systemSaysRefund : override
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
          {current ? 'คืนเงินประกันเต็มจำนวน' : 'ริบเงินประกันทั้งหมด'}
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
function MoveOutResult({ result, room, onDone }) {
  return (
    <>
      <h2 className="room-detail-title">รายละเอียดการย้ายออก — ห้อง {room.roomNumber}</h2>

      <section className="panel">
        {result.receipts.length === 0 ? (
          <p className="muted table-empty">ไม่มีใบเสร็จจากการย้ายออกครั้งนี้</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>เลขที่ใบเสร็จรับเงิน</th>
                <th>ประเภท</th>
                <th className="align-right">ยอดเงิน</th>
              </tr>
            </thead>
            <tbody>
              {result.receipts.map((receipt) => (
                <tr key={receipt.receiptNumber}>
                  <td>{receipt.receiptNumber}</td>
                  <td>{receipt.label}</td>
                  <td className="align-right">
                    <span className={receipt.amountCents < 0 ? 'negative' : undefined}>
                      {formatBaht(receipt.amountCents)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="move-out-total">
          {result.netRefundCents >= 0 ? (
            <strong className="move-out-refund">
              คืนเงินผู้เช่า {formatBaht(result.netRefundCents)} บาท
            </strong>
          ) : (
            <strong className="move-out-owed">
              ผู้เช่ายังค้างจ่าย {formatBaht(-result.netRefundCents)} บาท
            </strong>
          )}
        </p>

        {!result.isDepositRefundable && (
          <Alert kind="warn">
            ริบเงินประกัน {formatBaht(result.depositSnapshotCents)} บาท — {result.forfeitReasonLabel}
            {result.isManualOverride && ` (เจ้าของหอตัดสินเอง: ${result.overrideReason})`}
          </Alert>
        )}

        <div className="card-foot">
          <button type="button" className="btn" onClick={onDone}>
            เสร็จสิ้น
          </button>
        </div>
      </section>
    </>
  )
}

// ------------------------------------------------------------------
function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
