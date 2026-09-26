import React, { useState } from 'react'
import Alert from '../components/Alert.jsx'
import InfoTip from '../components/InfoTip.jsx'
import DateField from '../components/DateField.jsx'
import { centsToInput, formatBaht } from '../format.js'
import { FULL_MONTH_MOVE_IN_UNTIL_DAY, PRORATE_DAYS_PER_MONTH } from '../constants.js'
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
    // **ระยะสัญญาคือตัวที่กฎเงินประกันใช้ตัดสินว่า "ออกก่อนครบหรือยัง"** (ดู 004 + 026)
    // เจ้าของหอยืนยัน 2026-08-11 ว่าหอทำสัญญา 12 เดือน จึงตั้งเป็นค่าตั้งต้น
    // เดิมไม่มีช่องนี้เลย สัญญาทุกใบจึงได้ NULL แล้วเงื่อนไข "ออกก่อนครบ" ไม่เคยทำงาน
    termMonths: rentType === 'daily' ? '' : '12',
    // เว้นว่าง = เก็บส่วนที่เหลือครบวันนี้ (กรณีปกติ) — ฝั่ง main คิดยอดให้เอง
    // กรอกเมื่อวันนี้เก็บได้ไม่ครบ ส่วนที่ขาดจะไปขึ้นเป็นยอดค้างบนหน้าห้อง
    depositReceived: '',
    bookingFee: booking ? centsToInput(booking.bookingFeeCents) : '',
    // มาจากใบจองก็เอาเลขของใบนั้นมาแสดง (ฝั่ง main ยกมาให้อยู่แล้ว ตรงนี้แค่ให้เห็นก่อนบันทึก)
    bookingReceiptNo: booking?.bookingNumber ?? '',
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

  // ยอดที่ต้องเก็บเพิ่มวันนี้ = เงินประกัน − เงินจองที่วางไว้แล้ว
  const dueToday = Math.max(depositCents - bookingCents, 0)
  // เว้นช่อง "รับวันนี้" ไว้ = เก็บครบ จึงไม่ค้าง — ต้องคิดแบบเดียวกับฝั่ง main
  const receivedToday = form.depositReceived.trim() === '' ? dueToday : toCentsSafe(form.depositReceived)
  const depositShort = Math.max(dueToday - receivedToday, 0)

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

              {/* ระยะสัญญามีเฉพาะรายเดือน — สัญญารายวันไม่มีคำว่า "อยู่ครบสัญญา"
                  และเงินประกันของมันไม่ได้ผูกกับเงื่อนไขนี้ */}
              {rentType === 'monthly' && (
                <div className="field">
                  <label htmlFor="termMonths">ระยะสัญญา</label>
                  <select
                    id="termMonths"
                    value={form.termMonths}
                    onChange={(e) => set('termMonths', e.target.value)}
                  >
                    <option value="12">12 เดือน (1 ปี)</option>
                    <option value="6">6 เดือน</option>
                    <option value="">ไม่กำหนดระยะ</option>
                  </select>
                  {/* ตัวเลขนี้เป็นตัวตัดสินเงินประกันตอนย้ายออก ไม่ใช่ข้อมูลประดับ
                      ต้องบอกให้คนกรอกรู้ ไม่งั้นจะถูกข้ามไปเพราะดูเหมือนไม่สำคัญ */}
                  <p className="field-hint">ออกก่อนครบสัญญา = ริบเงินประกัน</p>
                </div>
              )}
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
              </div>
              <div className="field">
                <label htmlFor="bookingReceiptNo">
                  เลขที่ใบจอง
                  <InfoTip
                    title="เลขที่ใบจอง"
                    points={
                      booking
                        ? ['ยกมาจากใบจองของผู้เช่ารายนี้ แก้ไม่ได้']
                        : ['เว้นว่างได้ ระบบออกเลขให้เองเมื่อมีเงินจอง']
                    }
                  />
                </label>
                <input
                  id="bookingReceiptNo"
                  value={form.bookingReceiptNo}
                  onChange={(e) => set('bookingReceiptNo', e.target.value)}
                  placeholder={booking ? '' : 'ระบบออกเลขให้อัตโนมัติ'}
                  readOnly={Boolean(booking)}
                />
                {/* มาจากใบจองก็ล็อกไว้ ไม่ให้แก้ — ผู้เช่าถือใบที่มีเลขนี้อยู่แล้ว
                    ส่วนกรณีทำสัญญาตรงยังพิมพ์เองได้ เผื่อหอใช้เล่มใบเสร็จของตัวเอง */}
              </div>
            </div>

            {/* ยอดที่ต้องเก็บเพิ่มวันนี้ — เว้นว่างไว้ = เก็บครบตามนี้ ซึ่งเป็นกรณีปกติ
                กรอกเมื่อวันนี้เก็บได้ไม่ครบ ส่วนที่ขาดจะไปขึ้นเป็นยอดค้างบนหน้าห้อง
                ถ้าไม่มีช่องนี้ ระบบจะเหมาว่าเก็บครบเสมอ แล้วการเตือนยอดค้างก็ไม่มีวันทำงาน */}
            <div className="field">
              <label htmlFor="depositReceived">
                รับเงินประกันวันนี้
                <InfoTip
                  title="เก็บได้ไม่ครบ?"
                  points={['กรอกยอดที่รับจริงวันนี้', 'ส่วนที่ขาดจะขึ้นเป็นยอดค้างที่หน้าห้อง']}
                />
              </label>
              <div className="input-with-suffix">
                <input
                  id="depositReceived"
                  value={form.depositReceived}
                  onChange={(e) => set('depositReceived', e.target.value)}
                  inputMode="decimal"
                  placeholder={centsToInput(dueToday)}
                />
                <span className="input-suffix">บาท</span>
              </div>
              <p className="field-hint">เว้นว่าง = เก็บครบ {formatBaht(dueToday)} บาท</p>
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
                <span>{formatBaht(dueToday)} บาท</span>
              </div>
              {/* บอกยอดค้างตั้งแต่ก่อนกดบันทึก ไม่ใช่ให้ไปเจอเอาทีหลังบนหน้าห้อง */}
              {depositShort > 0 && (
                <div className="contract-summary-row contract-summary-warn">
                  <span>จะค้างเงินประกัน</span>
                  <span>{formatBaht(depositShort)} บาท</span>
                </div>
              )}
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
            <h3 className="panel-title">
              ค่าเช่าล่วงหน้า
              <InfoTip
                title="ค่าเช่าเดือนแรก"
                points={[
                  'เข้าพักกลางเดือน จ่ายเฉพาะวันที่เหลือของเดือนนั้น',
                  'รอบบิลปกติเริ่มเดือนถัดไป',
                  'ระบบคำนวณให้ ไม่ต้องกรอกเอง'
                ]}
              />
            </h3>

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
          </>
        )}

        {step === 2 && (
          <>
            <h3 className="panel-title">
              เลขมิเตอร์วันเข้าพัก
              <InfoTip title="เลขตั้งต้น" points={['ใช้คิดค่าน้ำ/ค่าไฟบิลแรกของสัญญานี้']} />
            </h3>
            {/* ยังโชว์ตลอด — เลขที่ไม่ได้จดจากหน้าปัดจริง บิลแรกของผู้เช่าผิดทันที */}
            <p className="panel-subtitle">จดจากหน้าปัดจริงในวันเข้าพัก</p>

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
        </div>
      </div>

      <div className="field">
        <label>ที่อยู่</label>
        <input value={value.address} onChange={(e) => set('address', e.target.value)} />
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

// สำเนาสูตรจาก calculateAdvanceRentCents ใน db/contracts.js ไว้แสดงตัวอย่างก่อนบันทึก
// **ฝั่ง main เป็นตัวจริงเสมอ — ที่นี่ต้องให้คำตอบเท่ากันทุกกรณี** ไม่งั้นคนหน้าเคาน์เตอร์
// จะเก็บเงินตามตัวเลขบนจอ แล้วระบบออกใบเสร็จเป็นอีกยอด (เคยเกิดมาแล้ว ดูคอมเมนต์ที่
// FULL_MONTH_MOVE_IN_UNTIL_DAY ใน constants.js)
//
// ต่างจาก main ได้แค่เรื่องเดียว: วันที่ยังกรอกไม่เสร็จให้คืน 0 แทนการโยน error
// เพราะที่นี่ถูกเรียกใหม่ทุกตัวอักษรที่พิมพ์ ไม่ใช่ตอนกดบันทึก
function advanceRentCents(rentCents, startDate) {
  const date = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 0

  const rent = Number(rentCents)
  const dayOfMonth = date.getDate()
  if (dayOfMonth <= FULL_MONTH_MOVE_IN_UNTIL_DAY) return rent

  // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้ (กันเดือน ก.พ. / ปีอธิกสุรทินเอง)
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  // นับวันเข้าพักเป็นวันแรกที่คิดเงินด้วย — เข้า 15 มิ.ย. = อยู่ 16 วัน (15 ถึง 30)
  const daysStaying = daysInMonth - dayOfMonth + 1

  // **หารด้วย 30 เสมอ ไม่ใช่ daysInMonth** — กติกาของหอนี้ (ยืนยันกับเจ้าของหอแล้ว)
  // แล้วปัดเป็นบาทเต็ม (ตั้งแต่ 50 สตางค์ปัดขึ้น) — ต้องตรงกับ main ทุกตัวอักษร
  return Math.round((rent * daysStaying) / (PRORATE_DAYS_PER_MONTH * 100)) * 100
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
