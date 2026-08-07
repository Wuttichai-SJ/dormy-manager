import React, { useCallback, useEffect, useState } from 'react'
import Alert from './Alert.jsx'
import Modal from './Modal.jsx'
import DateField from './DateField.jsx'
import { showToast } from './Toast.jsx'
import { formatPhone } from './TenantDialog.jsx'
import { formatBaht, centsToInput } from '../format.js'
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

  return (
    <section className="panel">
      <div className="panel-head-row">
        <div>
          <h3 className="panel-title">รายชื่อคนจองรอเข้าพัก</h3>
          <p className="panel-subtitle">เพิ่มรายการจองก่อนเข้าพัก</p>
        </div>
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
      ) : bookings.length === 0 ? (
        <p className="muted">ยังไม่มีรายการจองห้องนี้</p>
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
            {bookings.map((b) => (
              <tr key={b.bookingId}>
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
          </label>
          <div className="input-with-suffix">
            <input value={value.bookingFee} onChange={(e) => set('bookingFee', e.target.value)} inputMode="decimal" />
            <span className="input-suffix">บาท</span>
          </div>
          {/* เงินก้อนนี้จะถูกหักออกจากยอดที่ต้องเก็บเพิ่มตอนทำสัญญา */}
          <p className="field-hint">จะถูกนำไปหักออกจากยอดที่เก็บเพิ่มตอนทำสัญญา</p>
        </div>
        <div className="field field-required">
          <label>
            ชำระโดย <span className="required">* จำเป็น</span>
          </label>
          <select value={value.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
            <option value="cash">เงินสด</option>
            <option value="transfer">โอนเงิน</option>
            <option value="other">อื่นๆ</option>
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
