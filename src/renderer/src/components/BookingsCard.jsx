import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from './Alert.jsx'
import { useConfirm } from './ConfirmDialog.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from './FieldError.jsx'
import InfoTip from './InfoTip.jsx'
import Modal from './Modal.jsx'
import DateField from './DateField.jsx'
import { showToast } from './Toast.jsx'
import { formatBaht, centsToInput } from '../format.js'
import { PAYMENT_METHODS } from '../constants.js'
import {
  createBooking,
  deleteBooking,
  listBookingsByRoom,
  setBookingStatus
} from '../services/bookingService.js'

// การ์ด "รายชื่อคนจองรอเข้าพัก" ในหน้ารายละเอียดห้อง — ตามต้นแบบ
// คอลัมน์: เลขที่/วันที่จอง | ประเภท | ลูกค้า | วันที่เข้าพัก | ราคา | เงินจอง | สถานะ
//
// คนจองยังไม่ใช่ผู้เช่า จึงกรอกแค่ชื่อกับเบอร์ ระเบียนผู้เช่าจะถูกสร้างตอนทำสัญญาเท่านั้น
// (เหตุผลอยู่ใน db/bookings.js — คนจองแล้วไม่มาจะค้างในรายชื่อผู้เช่าตลอดไป)
const EMPTY = {
  rentType: 'monthly',
  checkInDate: '',
  checkOutDate: '',
  rentPrice: '',
  bookingFee: '',
  paymentMethod: 'cash',
  customerName: '',
  customerPhone: '',
  note: ''
}

// addRequest = ตัวเลขจากหน้าห้อง เปลี่ยนเมื่อไหร่ = เปิดหน้าต่างเพิ่มการจอง (ปุ่มลัดในการ์ดสัญญา)
// onOpenBookingChange = แจ้งหน้าห้องทุกครั้งที่โหลดรายการใหม่ว่ามีการจองค้างไหม (null = ไม่มี)
//   หน้าห้องใช้ซ่อนปุ่มทำสัญญาตรง เมื่อมีคนจองอยู่ (ดู createContract ฝั่ง main)
export default function BookingsCard({ room, onConvert, onOpenBookingChange, addRequest = 0 }) {
  // หน้าต่างยืนยันก่อนลบ/ยกเลิก — ดู components/ConfirmDialog.jsx
  const [confirmDialog, ask] = useConfirm()
  const [bookings, setBookings] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(null)
  const [busy, setBusy] = useState(false)
  const addForm = useFormErrors(BOOKING_FIELDS)
  // ใบจองที่จบไปแล้วพับเก็บไว้ ไม่ได้ลบทิ้ง — ดูเหตุผลที่ตัวแปร past ด้านล่าง
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(async () => {
    const res = await listBookingsByRoom(room.roomId)
    if (!res.success) return setError(res.error)
    setError('')
    // ห้องหนึ่งมีการจองค้างได้รายเดียว (createBooking กันไว้)
    onOpenBookingChange?.(res.data.find((b) => b.isOpen) ?? null)
    setBookings(res.data)
  }, [room.roomId])

  useEffect(() => {
    load()
  }, [load])

  // คืนผลเต็มจาก IPC ให้หน้าต่างยืนยันแสดง error ในหน้าต่างเอง · สำเร็จ = แจ้งผล + โหลดใหม่
  async function actResult(fn, message) {
    const res = await fn()
    if (res.success) {
      if (message) showToast(message)
      load()
    }
    return res
  }

  async function submit() {
    addForm.reset()
    setBusy(true)
    const res = await createBooking({ ...adding, roomId: room.roomId })
    setBusy(false)
    if (!res.success) return addForm.fromResult(res)
    showToast('เพิ่มข้อมูลสำเร็จ')
    setAdding(null)
    load()
  }

  // การ์ดนี้ชื่อ "คนจองรอเข้าพัก" จึงต้องมีแต่คนที่ยังรออยู่จริง — คนที่ทำสัญญาเข้าอยู่แล้ว
  // หรือยกเลิกไปแล้วไม่ได้รออะไร (ผู้ใช้รายงาน 2026-08-10: วุฒิชัยเข้าอยู่ห้อง 101 แล้ว
  // แต่ยังค้างอยู่ในรายชื่อคนรอ)
  //
  // **แต่ไม่ลบออกจากสายตาถาวร** — ใบจองเป็นหลักฐานที่ยังถูกอ้างถึงอยู่: สัญญาเก็บเลขที่
  // ใบจองไว้ และใบเสร็จเงินประกันเขียนว่า "เงินจองตามใบจอง B..." ถ้าหายไปเลยจะตามไม่ได้ว่า
  // เงินก้อนนั้นมาจากไหน จึงพับเก็บไว้ให้กดดูได้
  const open = (bookings ?? []).filter((b) => b.isOpen)
  const past = (bookings ?? []).filter((b) => !b.isOpen)

  // เติมราคาห้องให้ก่อน แก้ได้ — ต่อรองราคากันได้ตั้งแต่ตอนจอง
  const startAdding = useCallback(() => {
    addForm.reset()
    setAdding({ ...EMPTY, rentPrice: centsToInput(room.monthlyRentCents) })
    // addForm.reset มาจาก useCallback คงที่ — ไม่ต้องอยู่ใน deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.monthlyRentCents])

  useEffect(() => {
    if (addRequest > 0) startAdding()
  }, [addRequest, startAdding])
  const shown = showPast ? [...open, ...past] : open

  return (
    <section className="panel">
      {confirmDialog}
      <div className="panel-head-row">
        <h3 className="panel-title">การจองห้อง</h3>
        <button type="button" className="btn btn-sm" onClick={startAdding}>
          <Icon name="plus" />
          <span>เพิ่มการจอง</span>
        </button>
      </div>

      <Alert>{error}</Alert>

      {bookings === null ? (
        <p className="muted">กำลังโหลด...</p>
      ) : shown.length === 0 ? (
        // จอว่างที่บอกว่าที่นี่ทำอะไรได้ — เดิมเป็นข้อความเทาบรรทัดเดียว คนไม่รู้ว่าระบบมีการจอง
        <div className="booking-empty">
          <span className="booking-empty-icon" aria-hidden="true">
            <Icon name="bookings" />
          </span>
          <p className="booking-empty-title">
            {past.length > 0 ? 'ไม่มีคนจองรอเข้าพักตอนนี้' : 'ยังไม่มีการจองห้องนี้'}
          </p>
          <p className="booking-empty-hint">ผู้เช่าวางเงินจองไว้ก่อนเข้าพัก บันทึกไว้ที่นี่</p>
        </div>
      ) : (
        // การ์ดละหนึ่งการจอง ไม่ใช่ตาราง 6 คอลัมน์ — การ์ดนี้อยู่คอลัมน์ขวาที่แคบ ตารางเดิมบีบจน
        // ชื่อ วันที่ และปุ่มหักเป็นหลายบรรทัด (เฟิสทักท้วง 2026-09-26)
        // บรรทัดบน = ใครจอง + สถานะ · กลาง = เข้าวันไหน จ่ายเท่าไหร่ · ล่าง = เลขที่ + ปุ่ม
        // รายการย่อ: ชื่อ + สถานะ + ปุ่ม (เฟิสขอ 2026-09-26) — รายละเอียดวันที่/เงินจองอยู่ที่
        // การ์ดสัญญาด้านซ้ายแล้ว ไม่ต้องซ้ำที่นี่
        // ไม่มีปุ่ม "ยืนยันการจอง" แล้ว — ฝั่ง main แค่เปลี่ยนป้าย ไม่มีผลกับอะไรเลย หอไม่ได้ใช้
        <ul className="booking-rows">
          {shown.map((b) => (
            <li key={b.bookingId} className={'booking-row' + (b.isOpen ? '' : ' booking-past')}>
              <div className="booking-row-who">
                <strong>{b.customerName}</strong>
                <span className={`booking-status ${bookingTone(b)}`}>{bookingLabel(b)}</span>
              </div>

              <div className="booking-row-actions">
                {b.isOpen && (
                  <>
                    <button
                      type="button"
                      className="link-btn link-danger"
                      onClick={() =>
                        ask({
                          title: `ยกเลิกการจองของ ${b.customerName}?`,
                          message: 'ห้องจะกลับเป็นห้องว่าง · เงินจองไม่คืนตามกติกาของหอ',
                          confirmLabel: 'ยกเลิกการจอง',
                          busyLabel: 'กำลังยกเลิก...',
                          // ปุ่มยืนยันขึ้นต้นว่า "ยกเลิก" อยู่แล้ว ปุ่มปิดจึงต้องใช้คำอื่น
                          dismissLabel: 'เก็บการจองไว้',
                          icon: 'close',
                          onConfirm: () => actResult(() => setBookingStatus(b.bookingId, 'cancelled'), 'ยกเลิกการจองแล้ว')
                        })
                      }
                    >
                      ยกเลิก
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => onConvert(b)}>
                      ทำสัญญา
                    </button>
                  </>
                )}
                {b.status === 'cancelled' && (
                  <button
                    type="button"
                    className="link-btn link-danger"
                    onClick={() =>
                      ask({
                        title: `ลบรายการจองของ ${b.customerName}?`,
                        message: 'รายการจะหายจากประวัติการจอง กู้คืนไม่ได้',
                        confirmLabel: 'ลบรายการ',
                        onConfirm: () => actResult(() => deleteBooking(b.bookingId), 'ลบรายการจองแล้ว')
                      })
                    }
                  >
                    ลบรายการ
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ใบจองที่จบไปแล้วยังกดดูได้ ไม่ได้หายไปจากระบบ — สัญญาอ้างเลขที่ใบจองอยู่ และ
          ใบเสร็จเงินประกันก็อ้างถึง ถ้าดูย้อนหลังไม่ได้จะตามที่มาของเงินจองไม่เจอ */}
      {past.length > 0 && (
        <button
          type="button"
          className="link-btn booking-past-toggle"
          onClick={() => setShowPast((v) => !v)}
        >
          {showPast
            ? 'ซ่อนประวัติการจอง'
            : `ดูประวัติการจองที่จบแล้ว (${past.length} รายการ)`}
        </button>
      )}

      {adding && (
        <BookingDialog
          value={adding}
          busy={busy}
          form={addForm}
          onChange={setAdding}
          onClose={() => {
            setAdding(null)
            addForm.reset()
          }}
          onSubmit={submit}
        />
      )}
    </section>
  )
}

// ชื่อช่องตรงกับ key ใน validateBookingInput (src/main/db/bookings.js)
const BOOKING_FIELDS = [
  'customerName',
  'customerPhone',
  'rentType',
  'checkInDate',
  'checkOutDate',
  'rentPrice',
  'bookingFee',
  'paymentMethod'
]

function BookingDialog({ value, onChange, onClose, onSubmit, busy, form }) {
  const { errors } = form
  // แก้ช่องไหน error ของช่องนั้นหายทันที
  const set = (key, v) => {
    onChange({ ...value, [key]: v })
    form.clear(key)
  }
  const err = (key) => <FieldError id={`booking-${key}-error`} message={errors[key]} />
  const inv = (key) => invalidProps(`booking-${key}`, errors[key])

  return (
    <Modal
      title="เพิ่มการจอง"
      icon="bookings"
      submitLabel="บันทึกการจอง"
      busy={busy}
      error={form.formError}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      {/* แบ่งเป็นสามกลุ่มตามลำดับที่คุยกับผู้จองจริง: ใครจอง → เข้าวันไหน → จ่ายเท่าไหร่
          เดิมเป็นช่องเรียงต่อกันเก้าช่อง ไม่มีอะไรบอกว่าช่องไหนเป็นเรื่องเดียวกัน */}
      <fieldset className="form-group">
        <legend>ผู้จอง</legend>
        <div className="field-row">
          <div className={fieldClass('field field-required', errors.customerName)}>
            <label htmlFor="booking-customerName">
              ชื่อผู้จอง <span className="required">* จำเป็น</span>
            </label>
            <input
              id="booking-customerName"
              value={value.customerName}
              onChange={(e) => set('customerName', e.target.value)}
              autoFocus
              {...inv('customerName')}
            />
            {err('customerName')}
          </div>
          <div className={fieldClass('field field-required', errors.customerPhone)}>
            <label htmlFor="booking-customerPhone">
              เบอร์ติดต่อ <span className="required">* จำเป็น</span>
            </label>
            <input
              id="booking-customerPhone"
              value={value.customerPhone}
              onChange={(e) => set('customerPhone', e.target.value)}
              inputMode="tel"
              {...inv('customerPhone')}
            />
            {err('customerPhone')}
          </div>
        </div>
      </fieldset>

      <fieldset className="form-group">
        <legend>การเข้าพัก</legend>
        <div className="field-row">
          <div className={fieldClass('field field-required', errors.rentType)}>
            <label htmlFor="booking-rentType">
              ประเภทการเช่า <span className="required">* จำเป็น</span>
            </label>
            <select
              id="booking-rentType"
              value={value.rentType}
              onChange={(e) => set('rentType', e.target.value)}
              {...inv('rentType')}
            >
              <option value="monthly">รายเดือน</option>
              <option value="daily">รายวัน</option>
            </select>
            {err('rentType')}
          </div>
          <div className={fieldClass('field field-required', errors.checkInDate)}>
            <label htmlFor="booking-checkInDate">
              วันที่เข้าพัก <span className="required">* จำเป็น</span>
            </label>
            <DateField
              id="booking-checkInDate"
              value={value.checkInDate}
              onChange={(v) => set('checkInDate', v)}
            />
            {err('checkInDate')}
          </div>
          <div className={fieldClass('field', errors.checkOutDate)}>
            <label htmlFor="booking-checkOutDate">วันที่ออก</label>
            <DateField
              id="booking-checkOutDate"
              value={value.checkOutDate}
              onChange={(v) => set('checkOutDate', v)}
            />
            {err('checkOutDate')}
          </div>
        </div>
      </fieldset>

      <fieldset className="form-group">
        <legend>เงินจอง</legend>
        <div className="field-row">
          <div className={fieldClass('field field-required', errors.rentPrice)}>
            <label htmlFor="booking-rentPrice">
              ราคาห้อง <span className="required">* จำเป็น</span>
            </label>
            <div className="input-with-suffix">
              <input
                id="booking-rentPrice"
                value={value.rentPrice}
                onChange={(e) => set('rentPrice', e.target.value)}
                inputMode="decimal"
                {...inv('rentPrice')}
              />
              <span className="input-suffix">บาท</span>
            </div>
            {err('rentPrice')}
          </div>
          <div className={fieldClass('field field-required', errors.bookingFee)}>
            <label htmlFor="booking-bookingFee">
              เงินจอง <span className="required">* จำเป็น</span>
              <InfoTip title="เงินจอง" points={['หักออกจากยอดที่เก็บเพิ่มตอนทำสัญญา']} />
            </label>
            <div className="input-with-suffix">
              <input
                id="booking-bookingFee"
                value={value.bookingFee}
                onChange={(e) => set('bookingFee', e.target.value)}
                inputMode="decimal"
                {...inv('bookingFee')}
              />
              <span className="input-suffix">บาท</span>
            </div>
            {err('bookingFee')}
          </div>
          <div className={fieldClass('field field-required', errors.paymentMethod)}>
            <label htmlFor="booking-paymentMethod">
              ชำระโดย <span className="required">* จำเป็น</span>
            </label>
            {/* ต้องมาจาก PAYMENT_METHODS เหมือนอีก 6 หน้าที่มีช่องนี้ ไม่ใช่พิมพ์ <option> เอง
                เดิมพิมพ์เองแล้วคำเพี้ยน: ที่นี่ขึ้น "โอนเงิน" แต่ทุกหน้าอื่นขึ้น "เงินโอน" */}
            <select
              id="booking-paymentMethod"
              value={value.paymentMethod}
              onChange={(e) => set('paymentMethod', e.target.value)}
              {...inv('paymentMethod')}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method.key} value={method.key}>
                  {method.label}
                </option>
              ))}
            </select>
            {err('paymentMethod')}
          </div>
        </div>
        <div className="field">
          <label htmlFor="booking-note">หมายเหตุ</label>
          <input
            id="booking-note"
            value={value.note}
            onChange={(e) => set('note', e.target.value)}
            placeholder="เช่น เข้าอยู่พร้อมเพื่อน / ขอห้องชั้นล่าง"
          />
        </div>
      </fieldset>
    </Modal>
  )
}

// วันที่บนหน้าจอเป็น ค.ศ. dd/mm/yyyy เหมือนหน้าอื่นของระบบ — เดิมโชว์ ISO (2026-09-30) ตรงๆ
function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

// ข้อมูลหลักของการจองเป็นกล่องเรียงแถว — วันเข้าพัก (พร้อมนับถอยหลัง) · วันที่ออก · เงินจอง · วันที่จอง
// ใช้ทั้งในการ์ดการจองและในการ์ดสัญญาของห้องที่มีคนจอง (เฟิสขอให้เห็นวันที่ชัดๆ 2026-09-26)
// วันที่ออกขึ้นเฉพาะตอนกรอกไว้ — ส่วนใหญ่จองรายเดือนไม่ได้กำหนดวันออก
export function BookingFacts({ booking }) {
  const countdown = daysUntilLabel(booking.checkInDate)
  return (
    <dl className="booking-facts">
      <div className="booking-fact booking-fact-main">
        <dt>วันเข้าพัก</dt>
        <dd>{formatDate(booking.checkInDate)}</dd>
        {countdown && <span className="booking-fact-sub">{countdown}</span>}
      </div>
      {booking.checkOutDate && (
        <div className="booking-fact">
          <dt>วันที่ออก</dt>
          <dd>{formatDate(booking.checkOutDate)}</dd>
        </div>
      )}
      <div className="booking-fact">
        <dt>เงินจอง</dt>
        <dd>{formatBaht(booking.bookingFeeCents)}</dd>
        <span className="booking-fact-sub">บาท</span>
      </div>
      <div className="booking-fact">
        <dt>วันที่จอง</dt>
        <dd>{formatDate(booking.bookingDate)}</dd>
      </div>
    </dl>
  )
}

// "อีก 5 วัน" / "เข้าพักวันนี้" / "เลยมา 2 วัน" — นับจากวันที่ในเครื่อง ไม่สนเวลา
function daysUntilLabel(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((target - today) / 86400000)
  if (Number.isNaN(days)) return ''
  if (days === 0) return 'เข้าพักวันนี้'
  return days > 0 ? `อีก ${days} วัน` : `เลยมา ${-days} วัน`
}

// ป้ายสถานะที่หน้าจอ — "รอยืนยัน" กับ "ยืนยันแล้ว" รวมเป็น "รอเข้าพัก" เพราะเอาปุ่มยืนยันออกแล้ว
// (สถานะในฐานข้อมูลยังเป็น pending/confirmed เหมือนเดิม ไม่ได้แตะ — ใบเก่าที่เคยยืนยันไว้ก็ยังถูก)
function bookingLabel(b) {
  if (b.isOpen) return 'รอเข้าพัก'
  if (b.status === 'converted_to_contract') return 'ทำสัญญาแล้ว'
  if (b.status === 'cancelled') return 'ยกเลิกแล้ว'
  return b.statusLabel
}

function bookingTone(b) {
  return b.isOpen ? 'booking-pending' : `booking-${b.status}`
}
