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

// addRequest เปลี่ยน = เปิดหน้าต่างเพิ่มการจอง · onOpenBookingChange แจ้งการจองค้าง (null = ไม่มี)
export default function BookingsCard({ room, onConvert, onOpenBookingChange, addRequest = 0 }) {
  const [confirmDialog, ask] = useConfirm()
  const [bookings, setBookings] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(null)
  const [busy, setBusy] = useState(false)
  const addForm = useFormErrors(BOOKING_FIELDS)
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(async () => {
    const res = await listBookingsByRoom(room.roomId)
    if (!res.success) return setError(res.error)
    setError('')
    onOpenBookingChange?.(res.data.find((b) => b.isOpen) ?? null)
    setBookings(res.data)
  }, [room.roomId])

  useEffect(() => {
    load()
  }, [load])

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

  // แสดงเฉพาะคนที่ยังรอ — ใบที่จบแล้วพับเก็บไว้ (สัญญาและใบเสร็จอ้างถึง)
  const open = (bookings ?? []).filter((b) => b.isOpen)
  const past = (bookings ?? []).filter((b) => !b.isOpen)

  const startAdding = useCallback(() => {
    addForm.reset()
    setAdding({ ...EMPTY, rentPrice: centsToInput(room.monthlyRentCents) })
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
                          // ปุ่มยืนยันขึ้นต้นว่า "ยกเลิก" แล้ว ปุ่มปิดจึงใช้คำอื่น
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

// ชื่อช่องตรงกับ validateBookingInput
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
            {/* ใช้ PAYMENT_METHODS เหมือนหน้าอื่น */}
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

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

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

// pending/confirmed แสดงเป็น "รอเข้าพัก" เหมือนกัน
function bookingLabel(b) {
  if (b.isOpen) return 'รอเข้าพัก'
  if (b.status === 'converted_to_contract') return 'ทำสัญญาแล้ว'
  if (b.status === 'cancelled') return 'ยกเลิกแล้ว'
  return b.statusLabel
}

function bookingTone(b) {
  return b.isOpen ? 'booking-pending' : `booking-${b.status}`
}
