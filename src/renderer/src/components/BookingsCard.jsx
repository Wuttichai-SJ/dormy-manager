import React, { useCallback, useEffect, useState } from 'react'
import Alert from './Alert.jsx'
import InfoTip from './InfoTip.jsx'
import Modal from './Modal.jsx'
import DateField from './DateField.jsx'
import { showToast } from './Toast.jsx'
import { formatPhone } from './TenantDialog.jsx'
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

export default function BookingsCard({ room, onConvert }) {
  const [bookings, setBookings] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(null)
  const [busy, setBusy] = useState(false)
  // ใบจองที่จบไปแล้วพับเก็บไว้ ไม่ได้ลบทิ้ง — ดูเหตุผลที่ตัวแปร past ด้านล่าง
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(async () => {
    const res = await listBookingsByRoom(room.roomId)
    if (!res.success) return setError(res.error)
    setError('')
    setBookings(res.data)
  }, [room.roomId])

  useEffect(() => {
    load()
  }, [load])

  async function act(fn, message) {
    setError('')
    const res = await fn()
    if (!res.success) return setError(res.error)
    if (message) showToast(message)
    load()
  }

  async function submit() {
    setError('')
    setBusy(true)
    const res = await createBooking({ ...adding, roomId: room.roomId })
    setBusy(false)
    if (!res.success) return setError(res.error)
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
  const shown = showPast ? [...open, ...past] : open

  return (
    <section className="panel">
      <div className="panel-head-row">
        <h3 className="panel-title">รายชื่อคนจองรอเข้าพัก</h3>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            setAdding({
              ...EMPTY,
              // เติมราคาห้องให้ก่อน แก้ได้ — ต่อรองราคากันได้ตั้งแต่ตอนจอง
              rentPrice: centsToInput(room.monthlyRentCents)
            })
          }
        >
          เพิ่ม
        </button>
      </div>

      <Alert>{error}</Alert>

      {bookings === null ? (
        <p className="muted">กำลังโหลด...</p>
      ) : shown.length === 0 ? (
        <p className="muted">
          {past.length > 0 ? 'ไม่มีคนจองรอเข้าพักในตอนนี้' : 'ยังไม่มีรายการจองห้องนี้'}
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>เลขที่ / วันที่จอง</th>
              <th>ลูกค้า</th>
              <th>วันที่เข้าพัก</th>
              <th className="align-right">เงินจอง</th>
              <th>สถานะ</th>
              <th className="align-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.bookingId} className={b.isOpen ? undefined : 'booking-past'}>
                <td>
                  {/* ใบที่จองไว้ก่อนระบบจะออกเลขให้ไม่มีเลข — ขึ้นขีดแทน ไม่ใช่ช่องว่างเปล่า */}
                  <div>{b.bookingNumber ?? '—'}</div>
                  <div className="muted room-cell-sub">{b.bookingDate}</div>
                </td>
                <td>
                  <div>{b.customerName}</div>
                  <div className="muted room-cell-sub">{formatPhone(b.customerPhone)}</div>
                </td>
                <td>{b.checkInDate}</td>
                <td className="align-right">{formatBaht(b.bookingFeeCents)}</td>
                <td>
                  <span className={`booking-status booking-${b.status}`}>{b.statusLabel}</span>
                </td>
                <td className="align-right">
                  {/* ทำสัญญาได้เฉพาะใบที่ยังกันห้องอยู่ และเฉพาะตอนที่ห้องยังไม่มีสัญญา */}
                  {b.isOpen && (
                    <>
                      {b.status === 'pending' && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => act(() => setBookingStatus(b.bookingId, 'confirmed'), 'ยืนยันการจองแล้ว')}
                        >
                          ยืนยัน
                        </button>
                      )}
                      <button type="button" className="link-btn table-action" onClick={() => onConvert(b)}>
                        ทำสัญญา
                      </button>
                      <button
                        type="button"
                        className="link-btn link-danger table-action"
                        onClick={() => act(() => setBookingStatus(b.bookingId, 'cancelled'), 'ยกเลิกการจองแล้ว')}
                      >
                        ยกเลิก
                      </button>
                    </>
                  )}
                  {b.status === 'cancelled' && (
                    <button
                      type="button"
                      className="link-btn link-danger"
                      onClick={() => act(() => deleteBooking(b.bookingId), 'ลบรายการจองแล้ว')}
                    >
                      ลบ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          onChange={setAdding}
          onClose={() => setAdding(null)}
          onSubmit={submit}
        />
      )}
    </section>
  )
}

function BookingDialog({ value, onChange, onClose, onSubmit, busy }) {
  const set = (key, v) => onChange({ ...value, [key]: v })

  return (
    <Modal title="เพิ่มรายการจอง" busy={busy} onClose={onClose} onSubmit={onSubmit}>
      <div className="field-row">
        <div className="field field-required">
          <label>
            ชื่อผู้จอง <span className="required">* จำเป็น</span>
          </label>
          <input value={value.customerName} onChange={(e) => set('customerName', e.target.value)} autoFocus />
        </div>
        <div className="field field-required">
          <label>
            เบอร์ติดต่อ <span className="required">* จำเป็น</span>
          </label>
          <input
            value={value.customerPhone}
            onChange={(e) => set('customerPhone', e.target.value)}
            inputMode="tel"
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field field-required">
          <label>
            ประเภทการเช่า <span className="required">* จำเป็น</span>
          </label>
          <select value={value.rentType} onChange={(e) => set('rentType', e.target.value)}>
            <option value="monthly">รายเดือน</option>
            <option value="daily">รายวัน</option>
          </select>
        </div>
        <div className="field field-required">
          <label>
            วันที่เข้าพัก <span className="required">* จำเป็น</span>
          </label>
          <DateField value={value.checkInDate} onChange={(v) => set('checkInDate', v)} />
        </div>
        <div className="field">
          <label>วันที่ออก</label>
          <DateField value={value.checkOutDate} onChange={(v) => set('checkOutDate', v)} />
        </div>
      </div>

      <div className="field-row">
        <div className="field field-required">
          <label>
            ราคาห้อง <span className="required">* จำเป็น</span>
          </label>
          <div className="input-with-suffix">
            <input value={value.rentPrice} onChange={(e) => set('rentPrice', e.target.value)} inputMode="decimal" />
            <span className="input-suffix">บาท</span>
          </div>
        </div>
        <div className="field field-required">
          <label>
            เงินจอง <span className="required">* จำเป็น</span>
            <InfoTip title="เงินจอง" points={['หักออกจากยอดที่เก็บเพิ่มตอนทำสัญญา']} />
          </label>
          <div className="input-with-suffix">
            <input value={value.bookingFee} onChange={(e) => set('bookingFee', e.target.value)} inputMode="decimal" />
            <span className="input-suffix">บาท</span>
          </div>
        </div>
        <div className="field field-required">
          <label>
            ชำระโดย <span className="required">* จำเป็น</span>
          </label>
          {/* ต้องมาจาก PAYMENT_METHODS เหมือนอีก 6 หน้าที่มีช่องนี้ ไม่ใช่พิมพ์ <option> เอง
              เดิมพิมพ์เองแล้วคำเพี้ยน: ที่นี่ขึ้น "โอนเงิน" แต่ทุกหน้าอื่นขึ้น "เงินโอน" */}
          <select value={value.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
            {PAYMENT_METHODS.map((method) => (
              <option key={method.key} value={method.key}>
                {method.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>หมายเหตุ</label>
        <input value={value.note} onChange={(e) => set('note', e.target.value)} />
      </div>
    </Modal>
  )
}
