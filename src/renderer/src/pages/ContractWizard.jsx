import React, { useState } from 'react'
import Alert from '../components/Alert.jsx'
import DateField from '../components/DateField.jsx'
import { centsToInput, formatBaht } from '../format.js'
import { EMPTY_TENANT } from '../components/TenantDialog.jsx'
import { createTenant, listTenants } from '../services/tenantService.js'
import { createContract } from '../services/contractService.js'
import { convertBookingToContract } from '../services/bookingService.js'

// ตัวช่วยทำสัญญา 3 ขั้น — ลอกจากหน้าจริงของต้นแบบ `/rooms/{id}/agreements/create`
//   1 สัญญา · 2 ค่าเช่าล่วงหน้า · 3 มิเตอร์น้ำ-ไฟ
//
// ทั้งสามขั้นเก็บไว้ในหน่วยความจำแล้วเขียนลงฐานข้อมูลครั้งเดียวตอนกด "บันทึก" ที่ขั้นสุดท้าย
// เหตุผลอยู่ใน db/contracts.js — สัญญาที่มีแต่ขั้น 1 ออกบิลเดือนแรกไม่ได้ จึงไม่มีประโยชน์
// ที่จะบันทึกค้างไว้ครึ่งทาง
const STEPS = ['สัญญา', 'ค่าเช่าล่วงหน้า', 'มิเตอร์น้ำ-ไฟ']

const DEPOSIT_METHODS = [
  { value: 'cash', label: 'เงินสด' },
  { value: 'transfer', label: 'โอนเงิน' },
  { value: 'other', label: 'อื่นๆ' }
]

export default function ContractWizard({ apartment, room, rentType, booking, onCancel, onDone }) {
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // มาจากใบจอง = เติมสิ่งที่ตกลงกันไว้แล้วให้ก่อน (วันเข้าพัก ราคา เงินจอง)
  // เจ้าหน้าที่จะได้ไม่ต้องเปิดใบจองอีกจอเพื่อลอกตัวเลข แล้วลอกผิด
  const [form, setForm] = useState({
    startDate: booking?.checkInDate ?? today(),
    endDate: booking?.checkOutDate ?? '',
    // เติมค่าเช่าจากราคาตั้งของห้องให้ก่อน (ต้นแบบก็ทำ) แต่แก้ได้ เพราะต่อรองราคากันได้
    rentAmount: centsToInput(
      booking?.rentPriceCents ?? (rentType === 'daily' ? room.dailyRentCents : room.monthlyRentCents)
    ),
    deposit: '',
    depositPaymentMethod: 'cash',
    bookingFee: booking ? centsToInput(booking.bookingFeeCents) : '',
    bookingReceiptNo: '',
    note: booking?.note ?? '',
    waterMeterStart: '',
    electricMeterStart: ''
  })

  // ผู้เช่าของสัญญานี้ — คนแรกคือผู้เช่าหลัก (ดู 010_contract_tenants.sql)
  //
  // ใบจองเก็บชื่อไว้เป็นข้อความก้อนเดียว ("สมชาย ใจดี") แยกชื่อ/นามสกุลอัตโนมัติแล้วผิดบ่อย
  // (ชื่อสองพยางค์ นามสกุลมีเว้นวรรค) จึงเดาให้แค่คำแรก แล้วให้คนตรวจก่อนบันทึก
  const [tenants, setTenants] = useState([
    booking ? tenantFromBooking(booking) : { ...EMPTY_TENANT }
  ])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const depositCents = toCentsSafe(form.deposit)
  const bookingCents = toCentsSafe(form.bookingFee)
  const rentCents = toCentsSafe(form.rentAmount)

  async function submit() {
    setError('')
    setBusy(true)

    // ผู้เช่าที่ยังไม่มีในระบบต้องถูกสร้างก่อน แล้วค่อยเอา id ไปผูกกับสัญญา
    // ค้นด้วยเบอร์ก่อนสร้าง — เบอร์ซ้ำจะถูกฝั่ง main ปฏิเสธอยู่แล้ว แต่ถ้าเจอคนเดิม
    // ควรใช้ระเบียนเดิมต่อ ไม่ใช่เด้ง error ใส่หน้าคนกรอก
    const tenantIds = []
    for (const person of tenants) {
      const found = await listTenants(person.phone)
      const existing = found.success
        ? found.data.find((t) => t.phone === String(person.phone).replace(/\D/g, ''))
        : null

      if (existing) {
        tenantIds.push(existing.tenantId)
        continue
      }

      const created = await createTenant(person)
      if (!created.success) {
        setBusy(false)
        return setError(created.error)
      }
      tenantIds.push(created.data.tenantId)
    }

    const payload = {
      roomId: room.roomId,
      rentType,
      ...form,
      endDate: form.endDate || null,
      bookingFee: form.bookingFee || '0',
      tenants: tenantIds
    }

    // มาจากใบจอง = ต้องปิดใบจองในธุรกรรมเดียวกับที่สร้างสัญญา ไม่ใช่สร้างสัญญาแล้วค่อยไป
    // ปิดใบจองทีหลัง — ถ้าขั้นที่สองพลาด ห้องจะมีทั้งสัญญาและใบจองค้างพร้อมกัน
    const res = booking
      ? await convertBookingToContract(booking.bookingId, payload)
      : await createContract(payload)

    setBusy(false)
    if (!res.success) return setError(res.error)
    onDone(res.data)
  }

  return (
    <div className="contract-wizard">
      <ol className="contract-steps">
        {STEPS.map((label, index) => (
          <li key={label} className={'contract-step' + (index === step ? ' current' : '')}>
            <span className="contract-step-number">{index + 1}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      <section className="panel">
        <Alert>{error}</Alert>

        {step === 0 && (
          <>
            <h3 className="panel-title">
              สัญญา{rentType === 'monthly' ? 'รายเดือน' : 'รายวัน'} — ห้อง {room.roomNumber}
            </h3>

            <div className="field-row">
              <div className="field field-required">
                <label htmlFor="startDate">
                  วันที่เข้าพัก <span className="required">* จำเป็น</span>
                </label>
                <DateField
                  id="startDate"
                  value={form.startDate}
                  onChange={(v) => set('startDate', v)}
                />
              </div>
              <div className="field">
                <label htmlFor="endDate">วันที่ออก</label>
                <DateField id="endDate" value={form.endDate} onChange={(v) => set('endDate', v)} />
              </div>
              <div className="field field-required">
                <label htmlFor="rentAmount">
                  ค่าเช่าต่อ{rentType === 'monthly' ? 'เดือน' : 'วัน'}{' '}
                  <span className="required">* จำเป็น</span>
                </label>
                <div className="input-with-suffix">
                  <input
                    id="rentAmount"
                    value={form.rentAmount}
                    onChange={(e) => set('rentAmount', e.target.value)}
                    inputMode="decimal"
                  />
                  <span className="input-suffix">บาท/{rentType === 'monthly' ? 'เดือน' : 'วัน'}</span>
                </div>
              </div>
            </div>

            <div className="field-row">
              <div className="field field-required">
                <label htmlFor="deposit">
                  เงินประกัน <span className="required">* จำเป็น</span>
                </label>
                <div className="input-with-suffix">
                  <input
                    id="deposit"
                    value={form.deposit}
                    onChange={(e) => set('deposit', e.target.value)}
                    inputMode="decimal"
                  />
                  <span className="input-suffix">บาท</span>
                </div>
              </div>
              <div className="field field-required">
                <label htmlFor="depositPaymentMethod">
                  ชำระเงินประกันโดย <span className="required">* จำเป็น</span>
                </label>
                <select
                  id="depositPaymentMethod"
                  value={form.depositPaymentMethod}
                  onChange={(e) => set('depositPaymentMethod', e.target.value)}
                >
                  {DEPOSIT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="bookingFee">เงินจอง</label>
                <div className="input-with-suffix">
                  <input
                    id="bookingFee"
                    value={form.bookingFee}
                    onChange={(e) => set('bookingFee', e.target.value)}
                    inputMode="decimal"
                  />
                  <span className="input-suffix">บาท</span>
                </div>
                <p className="field-hint">ระบุจำนวนเงิน หากผู้เช่าวางเงินจองไว้ก่อนเข้าพัก</p>
              </div>
              <div className="field">
                <label htmlFor="bookingReceiptNo">เลขที่ใบจอง</label>
                <input
                  id="bookingReceiptNo"
                  value={form.bookingReceiptNo}
                  onChange={(e) => set('bookingReceiptNo', e.target.value)}
                />
              </div>
            </div>

            {/* กล่องสรุปสีฟ้าแบบต้นแบบ — เงินจองที่วางไว้แล้วถูกหักออกจากยอดที่ต้องเก็บเพิ่ม */}
            <div className="contract-summary">
              <h4>สรุป</h4>
              <div className="contract-summary-row">
                <span>เงินประกัน</span>
                <span>{formatBaht(depositCents)} บาท</span>
              </div>
              <div className="contract-summary-row">
                <span>เงินจอง</span>
                <span className="negative">-{formatBaht(bookingCents)} บาท</span>
              </div>
              <div className="contract-summary-row total">
                <span>รวม (เก็บเพิ่ม)</span>
                <span>{formatBaht(Math.max(depositCents - bookingCents, 0))} บาท</span>
              </div>
            </div>

            <hr className="divider" />

            <h3 className="panel-title">ข้อมูลผู้เช่า</h3>
            {tenants.map((person, index) => (
              <TenantFields
                key={index}
                index={index}
                value={person}
                canRemove={tenants.length > 1}
                onChange={(next) =>
                  setTenants((list) => list.map((t, i) => (i === index ? next : t)))
                }
                onRemove={() => setTenants((list) => list.filter((_, i) => i !== index))}
              />
            ))}

            {/* ต้นแบบรองรับผู้เช่าหลายคนต่อสัญญา — ห้องนักศึกษาอยู่กัน 2 คนเป็นเรื่องปกติ */}
            <button
              type="button"
              className="btn-outline"
              onClick={() => setTenants((list) => [...list, { ...EMPTY_TENANT }])}
            >
              เพิ่มผู้เช่าอีกคน
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <h3 className="panel-title">ค่าเช่าล่วงหน้า</h3>
            <p className="panel-subtitle">
              เข้าพักกลางเดือนจ่ายเฉพาะวันที่เหลือของเดือนนั้น รอบบิลปกติเริ่มเดือนถัดไป
            </p>

            {rentType === 'monthly' ? (
              <div className="contract-summary">
                <div className="contract-summary-row">
                  <span>ค่าเช่าต่อเดือน</span>
                  <span>{formatBaht(rentCents)} บาท</span>
                </div>
                <div className="contract-summary-row">
                  <span>วันที่เข้าพัก</span>
                  <span>{form.startDate}</span>
                </div>
                <div className="contract-summary-row total">
                  <span>ค่าเช่าล่วงหน้าที่ต้องเก็บ</span>
                  <span>{formatBaht(advanceRentCents(rentCents, form.startDate))} บาท</span>
                </div>
              </div>
            ) : (
              <p className="muted">สัญญารายวันไม่มีค่าเช่าล่วงหน้า</p>
            )}

            {/* คิดให้เอง ไม่ให้กรอกมือ — คิดมือแล้วผิดคือเก็บเงินผิดตั้งแต่วันแรก
                สูตรตัวจริงอยู่ฝั่ง main (db/contracts.js) ตรงนี้แค่แสดงให้ดูก่อนบันทึก */}
            <p className="field-hint">
              ระบบคำนวณให้อัตโนมัติจากจำนวนวันที่เหลือในเดือน ไม่ต้องกรอกเอง
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <h3 className="panel-title">เลขมิเตอร์วันเข้าพัก</h3>
            <p className="panel-subtitle">
              ใช้เป็นเลขตั้งต้นของบิลแรก — จดจากหน้าปัดจริงในวันที่ผู้เช่าเข้าพัก
            </p>

            <div className="field-row">
              <div className="field field-required">
                <label htmlFor="waterMeterStart">
                  เลขมิเตอร์ค่าน้ำ <span className="required">* จำเป็น</span>
                </label>
                <input
                  id="waterMeterStart"
                  value={form.waterMeterStart}
                  onChange={(e) => set('waterMeterStart', e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div className="field field-required">
                <label htmlFor="electricMeterStart">
                  เลขมิเตอร์ค่าไฟ <span className="required">* จำเป็น</span>
                </label>
                <input
                  id="electricMeterStart"
                  value={form.electricMeterStart}
                  onChange={(e) => set('electricMeterStart', e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>
          </>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={step === 0 ? onCancel : () => setStep(step - 1)}>
            {step === 0 ? 'ยกเลิก' : 'ย้อนกลับ'}
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn" onClick={() => setStep(step + 1)}>
              ต่อไป
            </button>
          ) : (
            <button type="button" className="btn" disabled={busy} onClick={submit}>
              {busy ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function TenantFields({ index, value, onChange, onRemove, canRemove }) {
  const set = (key, v) => onChange({ ...value, [key]: v })

  return (
    <div className="contract-tenant">
      <div className="contract-tenant-head">
        <strong>{index === 0 ? 'ผู้เช่าหลัก' : `ผู้อยู่ร่วมคนที่ ${index}`}</strong>
        {canRemove && (
          <button type="button" className="link-btn link-danger" onClick={onRemove}>
            นำออก
          </button>
        )}
      </div>

      <div className="field-row">
        <div className="field field-required">
          <label>
            ชื่อจริง <span className="required">* จำเป็น</span>
          </label>
          <input value={value.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </div>
        <div className="field field-required">
          <label>
            นามสกุล <span className="required">* จำเป็น</span>
          </label>
          <input value={value.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </div>
      </div>

      <div className="field-row">
        <div className="field field-required">
          <label>
            เบอร์ติดต่อ <span className="required">* จำเป็น</span>
          </label>
          <input
            value={value.phone}
            onChange={(e) => set('phone', e.target.value)}
            inputMode="tel"
          />
        </div>
        <div className="field">
          <label>เลขบัตรประชาชน / พาสปอร์ต</label>
          <input
            value={value.idCardNo}
            onChange={(e) => set('idCardNo', e.target.value)}
            inputMode="numeric"
          />
          <p className="field-hint">เว้นว่างได้ ถ้ายังไม่ได้เอกสาร</p>
        </div>
      </div>

      <div className="field">
        <label>ที่อยู่</label>
        <input value={value.address} onChange={(e) => set('address', e.target.value)} />
        <p className="field-hint">สำหรับแสดงบนใบแจ้งหนี้ / ใบเสร็จ</p>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// ตัวช่วยเล็กๆ ของหน้านี้
// ------------------------------------------------------------------
function today() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// แปลงบาทที่พิมพ์อยู่เป็นสตางค์เพื่อ "แสดงตัวอย่าง" เท่านั้น ตัวจริงคิดที่ฝั่ง main
// ระหว่างพิมพ์ค่าจะยังไม่สมบูรณ์ ("12." / "" ) จึงต้องคืน 0 แทนที่จะโยน error
function toCentsSafe(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

// สำเนาสูตรจาก db/contracts.js ไว้แสดงตัวอย่างก่อนบันทึก — ฝั่ง main เป็นตัวจริงเสมอ
// ถ้าแก้สูตรที่ main ต้องแก้ที่นี่ด้วย (เหมือน constants.js)
function advanceRentCents(rentCents, startDate) {
  const date = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 0
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return Math.round((rentCents * (daysInMonth - date.getDate() + 1)) / daysInMonth)
}

// ใบจองเก็บชื่อเป็นข้อความก้อนเดียว — เดาให้แค่ "คำแรกคือชื่อ ที่เหลือคือนามสกุล"
// แล้วให้คนตรวจ ไม่ใช่บันทึกตามที่เดาไปเลย
function tenantFromBooking(booking) {
  const parts = String(booking.customerName ?? '').trim().split(/\s+/)
  return {
    ...EMPTY_TENANT,
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
    phone: booking.customerPhone ?? ''
  }
}
