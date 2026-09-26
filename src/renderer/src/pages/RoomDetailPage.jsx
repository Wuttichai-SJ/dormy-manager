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

// หน้ารายละเอียดห้อง — ศูนย์กลางของทั้งระบบตามต้นแบบ (สำรวจหน้าจริง 2026-07-31)
//
// ห้องว่าง  → การ์ด "เพิ่มสัญญาประเภท" ให้เลือก รายเดือน / รายวัน
// ห้องไม่ว่าง → รายละเอียดสัญญา · เลขมิเตอร์วันเข้าพัก · บริการรายเดือน · ข้อมูลผู้เช่า
//
// ส่วนที่ต้นแบบมีแต่เราตัดทิ้งถาวร: ข้อมูลรถ
export default function RoomDetailPage({ apartment, room, onBack, user }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(null) // 'monthly' | 'daily' | null
  // ใบจองที่กำลังแปลงเป็นสัญญา — ตัวช่วยจะเติมข้อมูลจากใบจองให้ก่อน
  const [converting, setConverting] = useState(null)
  // เพิ่มขึ้นทีละหนึ่งทุกครั้งที่กด "บันทึกการจองไว้ก่อน" — BookingsCard เปิดหน้าต่างเพิ่มการจองเมื่อเลขเปลี่ยน
  const [bookingRequest, setBookingRequest] = useState(0)
  // การจองที่ยังค้างของห้องนี้ (มาจาก BookingsCard) — มี = ทำสัญญาตรงไม่ได้ ต้องทำจากการจอง
  const [openBooking, setOpenBooking] = useState(null)
  // กำลังอยู่ในขั้นตอนย้ายออก (หน้าเต็ม เหมือนตัวช่วยทำสัญญา)
  const [movingOut, setMovingOut] = useState(false)
  // ใบเสร็จของสัญญาที่ดึงมาเพื่อพิมพ์ "ใบรับเงินแรกเข้า" — null = ยังไม่ได้กดพิมพ์
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

  // ป้ายสถานะบนหัวหน้า — คิดจากสัญญา/การจองที่โหลดล่าสุด ไม่ใช่ room.status ที่ติดมาตอนเปิดหน้า
  // เดิมย้ายออกเสร็จแล้วป้ายยังค้าง "ไม่ว่าง" จนกว่าจะกลับไปหน้ารายการแล้วเข้ามาใหม่
  // ปิดปรับปรุงเป็นค่าที่ตั้งเอง ไม่ได้เกิดจากสัญญา จึงยังอ่านจาก room.status
  const headerStatus = active
    ? 'occupied'
    : room.status === 'maintenance'
      ? 'maintenance'
      : openBooking
        ? 'booked'
        : 'vacant'
  const headerLabel =
    headerStatus === 'booked' ? 'จองแล้ว' : (ROOM_STATUS_LABELS[headerStatus] ?? headerStatus)

  if (movingOut && active) {
    return (
      <MoveOutPage
        contract={active}
        room={room}
        // ชื่อในช่องลงชื่อท้ายใบสรุป = คนที่กำลังทำรายการย้ายออกใบนี้
        signedBy={user?.fullName}
        onBack={() => setMovingOut(false)}
        onDone={() => {
          setMovingOut(false)
          // โหลดใหม่ทั้งหน้า — สัญญาปิดแล้ว ห้องกลับมาว่าง หน้าจะเปลี่ยนเป็นการ์ด
          // "เพิ่มสัญญาประเภท" เอง ซึ่งคือสิ่งที่ผู้ใช้ต้องการทำต่อพอดี
          load()
        }}
      />
    )
  }

  // ระหว่างพิมพ์ หน้าจอต้องเหลือแค่เอกสาร เพราะ printToPDF จับภาพหน้าที่กำลังแสดงอยู่
  // (แบบแผนเดียวกับ ReceiptsPage — ถ้าทำเป็นกล่องซ้อนทับ เมนูกับการ์ดจะติดไปในกระดาษด้วย)
  if (moveInReceipts && active) {
    return (
      <>
        <div className="receipt-sheets">
          <MoveInReceiptDocument
            receipts={moveInReceipts}
            // ข้อมูลหอมาจากใบเสร็จ ไม่ใช่ prop ของหน้า — ตัวที่ติดมากับใบเสร็จเป็นรูป
            // { name, address, phone } ตรงกับที่เอกสารทุกใบในระบบใช้ ส่วน prop ของหน้า
            // เป็น { nameTh, addressTh } คนละรูป ส่งผิดตัวหัวเอกสารจะว่างเปล่าเงียบๆ
            apartment={moveInReceipts[0]?.apartment ?? {}}
            roomNumber={room.roomNumber}
            // สัญญาไม่มีช่อง tenantName (เคยส่งตัวนี้ไป ใบรับเงินเลยขึ้น "ผู้เช่า: -" ทุกใบ)
            // ประกอบจากรายชื่อผู้เช่าในสัญญา ผู้เช่าหลักขึ้นก่อน
            tenantName={tenantNamesOf(active)}
            contractStartDate={active.startDate}
            deposit={active.deposit}
            signedBy={user?.fullName}
          />
        </div>

        {/* เอกสารนี้เป็น A4 หน้าเดียวเสมอ ไม่ใช่ A5 สองใบต่อแผ่นแบบใบเสร็จ */}
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
                {/* 🔴 มีคนจองค้าง = ทำสัญญาได้ทางเดียวคือจากการจอง (main ปฏิเสธการทำสัญญาตรงด้วย)
                    ซ่อนปุ่มรายเดือน/รายวัน แล้วพาไปทำสัญญาให้ผู้จองแทน — เงินจองจะถูกนับเข้าเงินประกัน */}
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

                    {/* ปุ่มทำสัญญา/ยกเลิกอยู่ที่การ์ด "การจองห้อง" ที่เดียว (เฟิสขอ 2026-09-26) */}
                    <p className="room-booked-hint">
                      ทำสัญญาหรือยกเลิกการจองได้ที่ "การจองห้อง" ด้านขวา
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="room-detail-empty">ห้องว่าง · เลือกประเภทสัญญา</p>
                    {/* ปุ่มใหญ่สองใบตามต้นแบบ — เลือกประเภทก่อนแล้วค่อยเข้าตัวช่วยกรอก */}
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
                    {/* การจองอยู่การ์ดขวาล่าง คนที่เปิดห้องว่างมาเห็นแต่ปุ่มทำสัญญา ไม่รู้ว่าจองได้ด้วย
                        (เฟิสทักท้วง 2026-09-26) — บอกไว้ตรงที่ตาอยู่ แล้วเปิดหน้าต่างจองให้เลย */}
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
            {/* แยกเป็นการ์ดของตัวเองใต้เลขมิเตอร์ — เดิมแทรกท้ายการ์ดสัญญา ปนกับข้อมูลสัญญา */}
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
            {/* ต้นแบบแสดงคิวจองไว้ในหน้าห้องเสมอ ไม่ว่าห้องจะว่างหรือไม่ */}
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
  // ใบรับเงินแรกเข้า — ดึงใบเสร็จสดตอนกดพิมพ์ ไม่ได้เก็บไว้ตั้งแต่ตอนทำสัญญา
  // จะได้เห็นเงินประกันที่เก็บเพิ่มทีหลังด้วย (ดูคอมเมนต์ใน MoveInReceiptDocument)
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
    // ยอดที่รับมาจริง นับจากใบเสร็จ ไม่ใช่ยอดที่ตกลงกันไว้ — เงินจองที่หักเป็นเงินประกัน
    // ก็อยู่ในนี้แล้ว เพราะตอนทำสัญญาระบบออกใบเสร็จให้ก้อนนั้นไปแล้ว
    ['รับเงินประกันแล้ว', formatBaht(deposit.receivedCents)]
  ]

  // เงินจอง/เงินล่วงหน้าโผล่เฉพาะเมื่อมีจริง — สัญญาที่ไม่มีเงินจองไม่ต้องเห็นแถวว่างๆ
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

      {/* ยอดค้างต้องตามหลอกหลอนอยู่บนหน้าจอจนกว่าจะเก็บครบ ไม่ใช่แจ้งเตือนที่กดปิดแล้วหาย
          — เคสจริง: วางเงินจองครึ่งหนึ่งตอนมาดูห้อง อีกครึ่งเก็บวันเข้าอยู่จริงอีกสองเดือนถัดมา */}
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

      {/* พิมพ์กระดาษใบเดียวที่รวมเงินทุกก้อนตอนย้ายเข้า — ผู้เช่าจะได้ไม่ต้องถือใบเสร็จ
          สามใบที่หน้าตาเหมือนกัน · ใบเสร็จรายก้อนยังพิมพ์แยกได้ที่หน้าการชำระเงินตามเดิม */}
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

// แจ้งย้ายออก — โครงตามต้นแบบ (คู่มือ yeeraf ขั้น 2-4): หัวข้อ "แจ้งย้ายออก" มีปุ่มแจ้ง
// เมื่อยังไม่ได้แจ้ง · แจ้งแล้วขึ้นวันที่ตัวโตพร้อมลิงก์แก้ไข · ใต้ลงมาเป็นปุ่มแดงย้ายออก
//
// **สองจังหวะแยกกันโดยตั้งใจ** — วันที่แจ้งต้องถูกบันทึกตั้งแต่วันที่ผู้เช่ามาบอกจริง
// เพราะระยะห่างจากวันนั้นถึงวันออกคือสิ่งที่กฎเงินประกันใช้ตัดสิน ถ้าให้มากรอกตอนกดย้ายออก
// ก็แก้ให้เข้าทางได้เสมอ
// การ์ดแจ้งย้ายออก — สองสภาพ: ยังไม่แจ้ง (บอกกติกา + ปุ่มบันทึก) / แจ้งแล้ว (วันที่แจ้ง +
// วันแรกที่ย้ายออกได้โดยแจ้งล่วงหน้าครบ) · ปุ่มย้ายออกแยกไว้ล่างสุด เพราะเป็นทางออก ไม่ใช่ข้อมูล
//
// "ย้ายออกได้ตั้งแต่" = วันที่แจ้ง + จำนวนวันที่สัญญากำหนด — เงื่อนไขเดียวกับที่ main ใช้ตัดสิน
// ตอนย้ายออก (noticeDaysGiven >= requiredNoticeDays ใน db/terminations.js) บอกไว้ล่วงหน้า
// เจ้าของหอจะได้ตอบผู้เช่าได้ทันทีว่าออกวันไหนถึงไม่ผิดกติกา
// (อีกเงื่อนไขคือ "อยู่ครบระยะสัญญา" ตัดสินตอนย้ายออกเหมือนเดิม — ดูหน้าย้ายออก)
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

      {/* ปุ่มย้ายออกใช้ได้แม้ยังไม่ได้แจ้ง — คนที่ออกเงียบๆ ไม่แจ้งเลยก็ต้องปิดสัญญาได้
          ระบบจะบันทึกว่า "ไม่ได้แจ้งล่วงหน้า" แล้วกฎเงินประกันตัดสินตามนั้นเอง */}
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

// วันที่ ISO + จำนวนวัน → วันที่ ISO (นับแบบปฏิทิน ไม่สนเวลา)
function addDays(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + Number(days)))
  return next.toISOString().slice(0, 10)
}

// อีกกี่วันจากวันนี้ (ติดลบ = ผ่านมาแล้ว)
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
        {/* ยังโชว์ตลอด ไม่ซ่อนใน ⓘ — ใส่วันย้ายออกจริงแทนวันแจ้ง = ตัดสินเงินประกันผิด
            (แม้มี error ก็ยังโชว์ เพราะเป็นกติกาที่ต้องเห็นตอนแก้วันที่) */}
        <p className="field-hint">
          วันที่มาแจ้ง ไม่ใช่วันย้ายออก · ต้องแจ้งล่วงหน้า {contract.depositNoticeDays} วัน
        </p>
        {/* บอกผลของวันที่ที่เลือกทันที — คนกรอกจะได้ตอบผู้เช่าตรงนั้นว่าออกได้วันไหน */}
        {noticeDate && contract.depositNoticeDays > 0 && (
          <p className="move-out-earliest">
            ย้ายออกได้ตั้งแต่ <strong>{formatDate(addDays(noticeDate, contract.depositNoticeDays))}</strong>{' '}
            โดยแจ้งล่วงหน้าครบ
          </p>
        )}
      </div>

      {/* ผู้เช่าเปลี่ยนใจไม่ย้ายแล้วต้องล้างได้ ไม่งั้นวันที่ค้างอยู่จะไปมีผลกับการตัดสิน
          เงินประกันในอนาคตโดยไม่มีใครนึกถึง */}
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

// รับเงินประกันส่วนที่ยังค้าง — ออกใบเสร็จจริง ไม่ใช่แค่ติ๊กว่าเก็บแล้ว
// เพราะยอด "รับแล้ว" ถูกนับจากใบเสร็จ ถ้าไม่ออกใบ ยอดค้างก็ไม่ลด
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

// วันที่บนหน้าจอทำงานเป็น ค.ศ. รูปแบบ dd/mm/yyyy เหมือนหน้าอื่น — ส่วน พ.ศ. ใช้เฉพาะ
// บนเอกสารที่ยื่นให้ผู้เช่า (ดู formatDocumentDate ใน format.js)
function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

function MeterCard({ contract }) {
  return (
    <section className="panel">
      {/* เลขนี้เป็นจุดตั้งต้นของการคิดค่าน้ำ/ค่าไฟบิลแรก แก้ทีหลังแล้วบิลเพี้ยนทั้งสัญญา */}
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
  // มีสัญญาแล้ว = โชว์ราคาที่ตรึงไว้ในสัญญา ไม่ใช่ราคาปัจจุบันของหอ (ดู db/contracts.js)
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

// ชื่อผู้เช่าทุกคนในสัญญา ผู้เช่าหลักก่อน — ใช้บนเอกสารที่ยื่นให้ผู้เช่า
function tenantNamesOf(contract) {
  const tenants = [...(contract?.tenants ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
  return tenants.length > 0 ? tenants.map((t) => t.fullName).join(', ') : null
}
