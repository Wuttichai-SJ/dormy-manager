import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { useConfirm } from '../components/ConfirmDialog.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from '../components/FieldError.jsx'
import InfoTip from '../components/InfoTip.jsx'
import { showToast } from '../components/Toast.jsx'
import { formatPhone } from '../components/TenantDialog.jsx'
import { centsToInput, formatBaht } from '../format.js'
import { PAYMENT_METHODS, ROOM_STATUS_LABELS } from '../constants.js'
import { getContractsForRoom } from '../services/contractService.js'
import DateField from '../components/DateField.jsx'
import Modal from '../components/Modal.jsx'
import { listContractReceipts, receiveContractPayment } from '../services/paymentService.js'
import MoveInReceiptDocument from '../components/MoveInReceiptDocument.jsx'
import PrintDialog from '../components/PrintDialog.jsx'
import BookingsCard, { BookingFacts } from '../components/BookingsCard.jsx'
import ContractWizard from './ContractWizard.jsx'
import MoveOutPage from './MoveOutPage.jsx'
import { setMoveOutNotice } from '../services/terminationService.js'

export default function RoomDetailPage({ apartment, room, onBack, user }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(null) /* 'monthly' | 'daily' | null */
  const [converting, setConverting] = useState(null)
  // เพิ่มทีละหนึ่ง — BookingsCard เปิดหน้าต่างเพิ่มการจองเมื่อเลขเปลี่ยน
  const [bookingRequest, setBookingRequest] = useState(0)
  // มีการจองค้าง = ทำสัญญาได้ผ่านการจองเท่านั้น
  const [openBooking, setOpenBooking] = useState(null)
  const [movingOut, setMovingOut] = useState(false)
  const [moveInReceipts, setMoveInReceipts] = useState(null)

  const load = useCallback(async () => {
    const res = await getContractsForRoom(room.roomId)
    if (!res.success) return setError(res.error)
    setError('')
    setData(res.data)
  }, [room.roomId])

  useEffect(() => {
    load()
  }, [load])

  if (creating || converting) {
    return (
      <ContractWizard
        apartment={apartment}
        room={room}
        rentType={converting ? converting.rentType : creating}
        booking={converting}
        onCancel={() => {
          setCreating(null)
          setConverting(null)
        }}
        onDone={() => {
          setCreating(null)
          setConverting(null)
          showToast('บันทึกข้อมูลสำเร็จ')
          load()
        }}
      />
    )
  }

  const active = data?.active ?? null

  // ป้ายสถานะคิดจากสัญญา/การจองล่าสุด — ปิดปรับปรุงอ่านจาก room.status
  // ปิดใช้งานที่ตั้งค่า > ผังห้อง — ทำสัญญา/จองไม่ได้
  const inactive = room.isActive === false
  const headerStatus = active
    ? 'occupied'
    : inactive
      ? 'inactive'
      : room.status === 'maintenance'
        ? 'maintenance'
        : openBooking
          ? 'booked'
          : 'vacant'
  const headerLabel =
    headerStatus === 'booked'
      ? 'จองแล้ว'
      : headerStatus === 'inactive'
        ? 'ปิดใช้งาน'
        : (ROOM_STATUS_LABELS[headerStatus] ?? headerStatus)

  if (movingOut && active) {
    return (
      <MoveOutPage
        contract={active}
        room={room}
        signedBy={user?.fullName}
        onBack={() => setMovingOut(false)}
        onDone={() => {
          setMovingOut(false)
          load()
        }}
      />
    )
  }

  // ระหว่างพิมพ์แสดงแค่เอกสาร — printToPDF จับภาพหน้าที่แสดงอยู่
  if (moveInReceipts && active) {
    return (
      <>
        <div className="receipt-sheets">
          <MoveInReceiptDocument
            receipts={moveInReceipts}
            // ข้อมูลหอมาจากใบเสร็จ ({ name, address, phone }) ไม่ใช่ prop ของหน้า
            apartment={moveInReceipts[0]?.apartment ?? {}}
            roomNumber={room.roomNumber}
            // ประกอบชื่อจากรายชื่อผู้เช่าในสัญญา — สัญญาไม่มี tenantName
            tenantName={tenantNamesOf(active)}
            contractStartDate={active.startDate}
            deposit={active.deposit}
            signedBy={user?.fullName}
          />
        </div>

        <PrintDialog
          title="พิมพ์ใบรับเงินแรกเข้า"
          maxPages={1}
          onClose={() => setMoveInReceipts(null)}
          onPrinted={() => {
            setMoveInReceipts(null)
            showToast('ส่งใบรับเงินแรกเข้าเข้าเครื่องพิมพ์แล้ว')
          }}
        />
      </>
    )
  }

  return (
    <>
      <button type="button" className="link-btn link-back-inline" onClick={onBack}>
        <Icon name="back" />
        <span>กลับไปรายการห้องพัก</span>
      </button>

      <h2 className="room-detail-title">
        ห้อง: {room.roomNumber}
        <span className={`room-badge status-${headerStatus}`}>{headerLabel}</span>
      </h2>

      <Alert>{error}</Alert>

      {data === null ? (
        <p className="muted">กำลังโหลด...</p>
      ) : (
        <div className="room-detail-grid">
          <div className="room-detail-column">
            {active ? (
              <ContractCard
                contract={active}
                onReload={load}
                onPrintMoveIn={setMoveInReceipts}
              />
            ) : (
              <section className="panel">
                <h3 className="panel-title">รายละเอียดสัญญา</h3>
                {/* มีการจองค้าง = ทำสัญญาได้ผ่านการจองเท่านั้น */}
                {openBooking ? (
                  <div className="room-booked">
                    <div className="room-booked-head">
                      <span className="room-booked-icon" aria-hidden="true">
                        <Icon name="bookings" />
                      </span>
                      <div>
                        <p className="room-booked-label">ห้องนี้มีคนจองแล้ว</p>
                        <p className="room-booked-name">{openBooking.customerName}</p>
                        <p className="room-booked-phone">{formatPhone(openBooking.customerPhone)}</p>
                      </div>
                    </div>

                    <BookingFacts booking={openBooking} />

                    <p className="room-booked-hint">
                      ทำสัญญาหรือยกเลิกการจองได้ที่ "การจองห้อง" ด้านขวา
                    </p>
                  </div>
                ) : inactive ? (
                  <p className="room-detail-empty">
                    ห้องนี้ปิดใช้งานอยู่ · เปิดใช้งานได้ที่ ตั้งค่า &gt; ผังห้อง
                  </p>
                ) : (
                  <>
                    <p className="room-detail-empty">ห้องว่าง · เลือกประเภทสัญญา</p>
                    <div className="contract-type-picker">
                      <button
                        type="button"
                        className="contract-type contract-type-monthly"
                        onClick={() => setCreating('monthly')}
                      >
                        <Icon name="bookings" />
                        <span>รายเดือน</span>
                      </button>
                      <button
                        type="button"
                        className="contract-type contract-type-daily"
                        onClick={() => setCreating('daily')}
                      >
                        <Icon name="meters" />
                        <span>รายวัน</span>
                      </button>
                    </div>
                    <p className="room-booking-hint">
                      ยังไม่เข้าอยู่ตอนนี้?{' '}
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setBookingRequest((n) => n + 1)}
                      >
                        บันทึกการจองไว้ก่อน
                      </button>
                    </p>
                  </>
                )}
              </section>
            )}

            {active && <MeterCard contract={active} />}
            {active && (
              <MoveOutPanel
                contract={active}
                onReload={load}
                onMoveOut={() => setMovingOut(true)}
              />
            )}
          </div>

          <div className="room-detail-column">
            <ServicesCard contract={active} room={room} />
            {active && <TenantsCard contract={active} />}
            <BookingsCard
              room={room}
              onConvert={setConverting}
              onOpenBookingChange={setOpenBooking}
              addRequest={bookingRequest}
            />
          </div>
        </div>
      )}
    </>
  )
}

function ContractCard({ contract, onReload, onPrintMoveIn }) {
  const [receiving, setReceiving] = useState(false)
  const [loadingReceipts, setLoadingReceipts] = useState(false)

  async function openMoveInReceipt() {
    setLoadingReceipts(true)
    const res = await listContractReceipts(contract.contractId)
    setLoadingReceipts(false)
    if (!res.success) return showToast(res.error, 'error')
    if (res.data.length === 0) return showToast('สัญญานี้ยังไม่มีใบเสร็จให้พิมพ์', 'error')
    onPrintMoveIn(res.data)
  }
  const deposit = contract.deposit ?? { requiredCents: contract.depositAmountCents, receivedCents: 0, outstandingCents: 0 }

  const rows = [
    ['ประเภท', contract.rentType === 'monthly' ? 'รายเดือน' : 'รายวัน'],
    ['เริ่มต้น', contract.startDate],
    ['สิ้นสุด', contract.endDate ?? '-'],
    ['ค่าห้อง', formatBaht(contract.rentAmountCents)],
    ['เงินประกัน', formatBaht(contract.depositAmountCents)],
    ['รับเงินประกันแล้ว', formatBaht(deposit.receivedCents)]
  ]

  if (contract.bookingFeeCents > 0) rows.push(['เงินจอง', formatBaht(contract.bookingFeeCents)])
  if (contract.advancePaymentAmountCents > 0) {
    rows.push(['เงินล่วงหน้า', formatBaht(contract.advancePaymentAmountCents)])
  }

  return (
    <section className="panel">
      <h3 className="panel-title">รายละเอียดสัญญา</h3>
      <dl className="contract-rows">
        {rows.map(([label, value]) => (
          <div className="contract-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {deposit.outstandingCents > 0 && (
        <div className="deposit-due">
          <div>
            <strong>ยังเก็บเงินประกันไม่ครบ</strong>
            <span>ค้างอีก {formatBaht(deposit.outstandingCents)} บาท</span>
          </div>
          <button type="button" className="btn" onClick={() => setReceiving(true)}>
            รับเงินประกันเพิ่ม
          </button>
        </div>
      )}

      {contract.note && <p className="field-hint">{contract.note}</p>}

      <div className="contract-doc-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={openMoveInReceipt}
          disabled={loadingReceipts}
        >
          {loadingReceipts ? 'กำลังเตรียม...' : 'พิมพ์ใบรับเงินแรกเข้า'}
        </button>
      </div>

      {receiving && (
        <DepositPaymentDialog
          contract={contract}
          outstandingCents={deposit.outstandingCents}
          onClose={() => setReceiving(false)}
          onDone={() => {
            setReceiving(false)
            onReload?.()
          }}
        />
      )}
    </section>
  )
}

// "ย้ายออกได้ตั้งแต่" = วันที่แจ้ง + วันแจ้งล่วงหน้าของสัญญา (เงื่อนไขเดียวกับ main)
function MoveOutPanel({ contract, onReload, onMoveOut }) {
  const [editing, setEditing] = useState(false)
  const noticeDate = contract.moveOutNoticeDate
  const noticeDays = contract.depositNoticeDays
  const earliest = noticeDate && noticeDays ? addDays(noticeDate, noticeDays) : null
  const countdown = earliest ? daysFromToday(earliest) : null

  return (
    <section className="panel">
      <h3 className="panel-title">แจ้งย้ายออก</h3>

      {noticeDate ? (
        <>
          <dl className="booking-facts">
            <div className="booking-fact">
              <dt>ผู้เช่าแจ้งเมื่อ</dt>
              <dd>{formatDate(noticeDate)}</dd>
            </div>
            {earliest && (
              <div className="booking-fact booking-fact-main">
                <dt>ย้ายออกได้ตั้งแต่</dt>
                <dd>{formatDate(earliest)}</dd>
                <span className="booking-fact-sub">
                  {countdown > 0 ? `อีก ${countdown} วัน · ` : ''}ครบแจ้งล่วงหน้า {noticeDays} วัน
                </span>
              </div>
            )}
          </dl>
          <button type="button" className="link-btn" onClick={() => setEditing(true)}>
            แก้ไขวันที่แจ้ง
          </button>
        </>
      ) : (
        <div className="move-out-empty">
          <p className="move-out-empty-title">ผู้เช่ายังไม่ได้แจ้งย้ายออก</p>
          {noticeDays > 0 && (
            <p className="move-out-empty-rule">กติกาของสัญญานี้: ต้องแจ้งล่วงหน้าอย่างน้อย {noticeDays} วัน</p>
          )}
          <button type="button" className="btn btn-outline" onClick={() => setEditing(true)}>
            <Icon name="bookings" />
            <span>บันทึกการแจ้งย้ายออก</span>
          </button>
        </div>
      )}

      {/* ย้ายออกได้แม้ยังไม่แจ้ง — ระบบบันทึกว่าไม่ได้แจ้งล่วงหน้า */}
      <div className="move-out-panel-foot">
        <span>ผู้เช่าย้ายออกแล้ว?</span>
        <button type="button" className="btn btn-danger btn-sm" onClick={onMoveOut}>
          ยกเลิกสัญญา / ย้ายออก
        </button>
      </div>

      {editing && (
        <MoveOutNoticeDialog
          contract={contract}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false)
            onReload?.()
          }}
        />
      )}
    </section>
  )
}

function addDays(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + Number(days)))
  return next.toISOString().slice(0, 10)
}

function daysFromToday(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const now = new Date()
  return Math.round(
    (Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000
  )
}

function MoveOutNoticeDialog({ contract, onClose, onDone }) {
  const [confirmDialog, ask] = useConfirm()
  const [noticeDate, setNoticeDate] = useState(contract.moveOutNoticeDate ?? todayIso())
  const [busy, setBusy] = useState(false)
  const { errors, formError, fromResult, clear, reset } = useFormErrors(['noticeDate'])

  async function save(value) {
    reset()
    setBusy(true)
    const res = await setMoveOutNotice(contract.contractId, value)
    setBusy(false)
    if (!res.success) return fromResult(res)
    showToast(value ? 'บันทึกวันที่แจ้งย้ายออกแล้ว' : 'ยกเลิกการแจ้งย้ายออกแล้ว')
    onDone()
  }

  return (
    <Modal
      title="แจ้งย้ายออก"
      icon="bookings"
      busy={busy}
      error={formError}
      onClose={onClose}
      onSubmit={() => save(noticeDate)}
    >
      <div className={fieldClass('field field-required', errors.noticeDate)}>
        <label htmlFor="noticeDate">
          วันที่แจ้งย้ายออก <span className="required">* จำเป็น</span>
        </label>
        <DateField
          id="noticeDate"
          value={noticeDate}
          onChange={(v) => {
            setNoticeDate(v)
            clear('noticeDate')
          }}
        />
        <FieldError id="noticeDate-error" message={errors.noticeDate} />
        <p className="field-hint">
          วันที่มาแจ้ง ไม่ใช่วันย้ายออก · ต้องแจ้งล่วงหน้า {contract.depositNoticeDays} วัน
        </p>
        {noticeDate && contract.depositNoticeDays > 0 && (
          <p className="move-out-earliest">
            ย้ายออกได้ตั้งแต่ <strong>{formatDate(addDays(noticeDate, contract.depositNoticeDays))}</strong>{' '}
            โดยแจ้งล่วงหน้าครบ
          </p>
        )}
      </div>

      {contract.moveOutNoticeDate && (
        <button
          type="button"
          className="link-btn link-danger"
          onClick={() =>
            ask({
              title: 'ยกเลิกการแจ้งย้ายออก?',
              message: `ลบวันที่แจ้ง ${formatDate(contract.moveOutNoticeDate)} ออก · ผู้เช่าอยู่ต่อตามสัญญาเดิม`,
              confirmLabel: 'ยกเลิกการแจ้ง',
              busyLabel: 'กำลังยกเลิก...',
              dismissLabel: 'เก็บไว้',
              icon: 'close',
              onConfirm: async () => {
                const res = await setMoveOutNotice(contract.contractId, null)
                if (res.success) {
                  showToast('ยกเลิกการแจ้งย้ายออกแล้ว')
                  onDone()
                }
                return res
              }
            })
          }
          disabled={busy}
        >
          ยกเลิกการแจ้งย้ายออก (ผู้เช่าไม่ย้ายแล้ว)
        </button>
      )}
      {confirmDialog}
    </Modal>
  )
}

// ออกใบเสร็จจริง — ยอดรับแล้วนับจากใบเสร็จ
function DepositPaymentDialog({ contract, outstandingCents, onClose, onDone }) {
  const [amount, setAmount] = useState(centsToInput(outstandingCents))
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentDate, setPaymentDate] = useState(todayIso())
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const { errors, formError, fromResult, clear, reset } = useFormErrors([
    'amount',
    'paymentMethod',
    'paymentDate'
  ])

  async function submit() {
    reset()
    setBusy(true)
    const res = await receiveContractPayment({
      contractId: contract.contractId,
      amount,
      paymentMethod,
      paymentDate,
      remark,
      purpose: 'deposit'
    })
    setBusy(false)
    if (!res.success) return fromResult(res)
    showToast(`รับเงินประกันแล้ว ออกใบเสร็จ ${res.data.receiptNumber}`)
    onDone()
  }

  return (
    <Modal
      title="รับเงินประกันเพิ่ม"
      icon="payments"
      busy={busy}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className={fieldClass('field', errors.amount)}>
        <label htmlFor="depositAmount">
          จำนวนเงิน <span className="muted">(ค้างอยู่ {formatBaht(outstandingCents)})</span>
        </label>
        <input
          id="depositAmount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            clear('amount')
          }}
          {...invalidProps('depositAmount', errors.amount)}
        />
        <FieldError id="depositAmount-error" message={errors.amount} />
      </div>

      <div className={fieldClass('field', errors.paymentMethod)}>
        <label htmlFor="depositMethod">ชำระเงินโดย</label>
        <select
          id="depositMethod"
          value={paymentMethod}
          onChange={(e) => {
            setPaymentMethod(e.target.value)
            clear('paymentMethod')
          }}
          {...invalidProps('depositMethod', errors.paymentMethod)}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <FieldError id="depositMethod-error" message={errors.paymentMethod} />
      </div>

      <div className={fieldClass('field', errors.paymentDate)}>
        <label htmlFor="depositDate">
          วันที่รับเงิน <span className="required">* จำเป็น</span>
        </label>
        <DateField
          id="depositDate"
          value={paymentDate}
          onChange={(v) => {
            setPaymentDate(v)
            clear('paymentDate')
          }}
        />
        <FieldError id="depositDate-error" message={errors.paymentDate} />
      </div>

      <div className="field">
        <label htmlFor="depositRemark">หมายเหตุ</label>
        <input
          id="depositRemark"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="เช่น เก็บส่วนที่เหลือวันเข้าอยู่"
        />
      </div>
    </Modal>
  )
}

function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

function MeterCard({ contract }) {
  return (
    <section className="panel">
      <h3 className="panel-title">
        เลขมิเตอร์วันเข้าพัก
        <InfoTip title="เลขตั้งต้น" points={['ใช้คิดค่าน้ำ/ค่าไฟบิลแรกของสัญญานี้']} />
      </h3>
      <div className="meter-start-grid">
        <div className="meter-start meter-start-water">
          <Icon name="water" />
          <strong>{contract.waterMeterStart}</strong>
          <span>ค่าน้ำ</span>
        </div>
        <div className="meter-start meter-start-electric">
          <Icon name="electric" />
          <strong>{contract.electricMeterStart}</strong>
          <span>ค่าไฟ</span>
        </div>
      </div>
    </section>
  )
}

function ServicesCard({ contract, room }) {
  // มีสัญญา = แสดงราคาที่ตรึงในสัญญา
  const items = contract
    ? contract.services.map((s) => ({ name: s.name, price: formatBaht(s.priceCents) }))
    : (room.serviceItems ?? []).map((s) => ({ name: s.name, price: formatBaht(s.priceCents) }))

  return (
    <section className="panel">
      <h3 className="panel-title">
        บริการรายเดือน
        <InfoTip
          title="บริการรายเดือน"
          points={[
            'เข้าบิลรายเดือนอัตโนมัติ',
            contract && 'ราคาตรึงไว้ตั้งแต่วันทำสัญญา หอขึ้นราคาก็ไม่กระทบ'
          ]}
        />
      </h3>

      {items.length === 0 ? (
        <p className="muted">ไม่มีบริการ</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>ค่าบริการ</th>
              <th className="align-right">ราคา</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td className="align-right">
                  {item.price ?? <span className="muted">ตามราคาปัจจุบัน</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function TenantsCard({ contract }) {
  return (
    <section className="panel">
      <h3 className="panel-title">ข้อมูลผู้เช่า</h3>

      <table className="data-table">
        <thead>
          <tr>
            <th>ชื่อ</th>
            <th>เบอร์ติดต่อ</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {contract.tenants.map((t) => (
            <tr key={t.tenantId}>
              <td>{t.fullName}</td>
              <td>{formatPhone(t.phone)}</td>
              <td>
                {t.isPrimary ? (
                  <span className="tag">ผู้เช่าหลัก</span>
                ) : (
                  <span className="muted">ผู้อยู่ร่วม</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function tenantNamesOf(contract) {
  const tenants = [...(contract?.tenants ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
  return tenants.length > 0 ? tenants.map((t) => t.fullName).join(', ') : null
}
