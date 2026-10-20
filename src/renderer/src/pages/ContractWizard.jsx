import React, { useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
import { useConfirm } from '../components/ConfirmDialog.jsx'
import InfoTip from '../components/InfoTip.jsx'
import DateField from '../components/DateField.jsx'
import FieldError from '../components/FieldError.jsx'
import { centsToInput, formatBaht } from '../format.js'
import { FULL_MONTH_MOVE_IN_UNTIL_DAY, PRORATE_DAYS_PER_MONTH } from '../constants.js'
import { EMPTY_TENANT, formatPhone } from '../components/TenantDialog.jsx'
import { createTenant, listTenants } from '../services/tenantService.js'
import { createContract } from '../services/contractService.js'
import { convertBookingToContract } from '../services/bookingService.js'

// 3 ขั้น: สัญญา · ค่าเช่าล่วงหน้า · มิเตอร์ — บันทึกครั้งเดียวตอนจบ
const STEPS = ['สัญญา', 'ค่าเช่าล่วงหน้า', 'มิเตอร์น้ำ-ไฟ']

const DEPOSIT_METHODS = [
  { value: 'cash', label: 'เงินสด' },
  { value: 'transfer', label: 'โอนเงิน' },
  { value: 'other', label: 'อื่นๆ' }
]

export default function ContractWizard({ apartment, room, booking, onCancel, onDone }) {
  const [confirmDialog, ask] = useConfirm()
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // มาจากใบจอง = เติมวันเข้าพัก ราคา เงินจองให้
  const [form, setForm] = useState({
    startDate: booking?.checkInDate ?? today(),
    endDate: booking?.checkOutDate ?? '',
    rentAmount: centsToInput(booking?.rentPriceCents ?? room.monthlyRentCents),
    deposit: '',
    depositPaymentMethod: 'cash',
    // ระยะสัญญาใช้ตัดสินเงินประกันตอนย้ายออก (หอนี้ 12 เดือน)
    termMonths: '12',
    // ว่าง = เก็บครบวันนี้
    depositReceived: '',
    bookingFee: booking ? centsToInput(booking.bookingFeeCents) : '',
    bookingReceiptNo: booking?.bookingNumber ?? '',
    note: booking?.note ?? '',
    // อยู่มาก่อนเริ่มใช้ระบบ — ไม่เก็บค่าเช่าเดือนแรก ไม่มีเงินจอง
    carriedOver: false,
    waterMeterStart: '',
    electricMeterStart: ''
  })

  // คนแรกคือผู้เช่าหลัก
  const [tenants, setTenants] = useState([
    booking ? tenantFromBooking(booking) : { ...EMPTY_TENANT }
  ])

  // เบอร์ (ตัวเลขล้วน) → ผู้เช่าในระบบที่ใช้เบอร์นี้ · null = ไม่มีใครใช้
  const [phoneOwners, setPhoneOwners] = useState({})

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  async function checkPhone(phone) {
    const digits = onlyDigits(phone)
    if (digits.length < 9) return
    const owner = await findPhoneOwner(digits)
    setPhoneOwners((map) => ({ ...map, [digits]: owner }))
  }

  // มาจากใบจอง = เบอร์กรอกมาแล้ว เช็กเลยไม่ต้องรอออกจากช่อง
  useEffect(() => {
    if (booking) checkPhone(booking.customerPhone)
  }, [])

  // index ของคนก่อนหน้าในสัญญานี้ที่ใช้เบอร์เดียวกัน · -1 = ไม่ซ้ำ
  const duplicateOf = (index) => {
    const digits = onlyDigits(tenants[index].phone)
    if (digits.length < 9) return -1
    return tenants.findIndex((t, i) => i < index && onlyDigits(t.phone) === digits)
  }

  const depositCents = toCentsSafe(form.deposit)
  const bookingCents = form.carriedOver ? 0 : toCentsSafe(form.bookingFee)
  const rentCents = toCentsSafe(form.rentAmount)

  const dueToday = Math.max(depositCents - bookingCents, 0)
  // ต้องคิดแบบเดียวกับ main
  const receivedToday = form.depositReceived.trim() === '' ? dueToday : toCentsSafe(form.depositReceived)
  const depositShort = Math.max(dueToday - receivedToday, 0)

  async function submit() {
    setError('')

    const dupIndex = tenants.findIndex((_, i) => duplicateOf(i) >= 0)
    if (dupIndex >= 0) {
      return setError(`${tenantLabel(dupIndex)} ใช้เบอร์ซ้ำกับ${tenantLabel(duplicateOf(dupIndex))}`)
    }

    setBusy(true)
    const owners = await Promise.all(tenants.map((person) => findPhoneOwner(person.phone)))
    setPhoneOwners((map) => {
      const next = { ...map }
      tenants.forEach((person, i) => (next[onlyDigits(person.phone)] = owners[i]))
      return next
    })

    const problem = await findOwnerProblem(tenants, owners)
    if (problem) {
      setBusy(false)
      return setError(problem)
    }

    if (!owners.some(Boolean)) return save(owners)

    // ปิดหน้าต่างโดยไม่ยืนยัน = ข้อความนี้ค้างไว้ให้กลับไปแก้เบอร์
    setBusy(false)
    setError('เบอร์ที่กรอกมีผู้เช่าในระบบใช้อยู่แล้ว · ถ้าเป็นคนละคน กรุณาใช้เบอร์อื่น')
    ask({
      tone: 'primary',
      icon: 'tenants',
      title: 'ใช้ข้อมูลผู้เช่าเดิม?',
      message: tenants
        .map((person, i) => owners[i] && reuseNote(person, owners[i]))
        .filter(Boolean)
        .join(' · '),
      confirmLabel: 'ใช่ คนเดิม',
      busyLabel: 'กำลังบันทึก...',
      dismissLabel: 'ไม่ใช่',
      onConfirm: async () => {
        await save(owners)
        return { success: true }
      }
    })
  }

  // owners[i] = ผู้เช่าเดิมที่ยืนยันแล้วว่าเป็นคนเดียวกัน · null = สร้างใหม่
  async function save(owners) {
    setError('')
    setBusy(true)

    const tenantIds = []
    for (const [i, person] of tenants.entries()) {
      if (owners[i]) {
        tenantIds.push(owners[i].tenantId)
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
      rentType: 'monthly',
      ...form,
      endDate: form.endDate || null,
      bookingFee: form.carriedOver ? '0' : form.bookingFee || '0',
      bookingReceiptNo: form.carriedOver ? '' : form.bookingReceiptNo,
      tenants: tenantIds
    }

    // มาจากใบจอง = ปิดใบจองในธุรกรรมเดียวกับสร้างสัญญา
    const res = booking
      ? await convertBookingToContract(booking.bookingId, payload)
      : await createContract(payload)

    setBusy(false)
    if (!res.success) return setError(res.error)
    onDone(res.data)
  }

  return (
    <div className="contract-wizard">
      {confirmDialog}
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
              สัญญาเช่า — ห้อง {room.roomNumber}
            </h3>

            {!booking && (
              <div className="contract-carried-over">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.carriedOver}
                    onChange={(e) => set('carriedOver', e.target.checked)}
                  />
                  <span>ผู้เช่าเดิม (อยู่ก่อนเริ่มใช้ระบบ)</span>
                </label>
                <InfoTip
                  title="ผู้เช่าเดิม"
                  points={[
                    'วันที่เข้าพัก = วันที่เข้าอยู่จริง ย้อนหลังได้',
                    'ไม่เก็บค่าเช่าเดือนแรก ไม่มีเงินจอง',
                    'เงินประกัน กรอกยอดที่หอถือไว้แล้ว',
                    'กรอกให้ครบก่อนออกบิลรอบแรกในระบบนี้'
                  ]}
                />
              </div>
            )}

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
                  ค่าเช่าต่อเดือน{' '}
                  <span className="required">* จำเป็น</span>
                </label>
                <div className="input-with-suffix">
                  <input
                    id="rentAmount"
                    value={form.rentAmount}
                    onChange={(e) => set('rentAmount', e.target.value)}
                    inputMode="decimal"
                  />
                  <span className="input-suffix">บาท/เดือน</span>
                </div>
              </div>

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
                <p className="field-hint">ออกก่อนครบสัญญา = ริบเงินประกัน</p>
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

            {!form.carriedOver && (
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
                </div>
              </div>
            )}

            <div className="field">
              <label htmlFor="depositReceived">
                {form.carriedOver ? 'เงินประกันที่หอถือไว้แล้ว' : 'รับเงินประกันวันนี้'}
                <InfoTip
                  title={form.carriedOver ? 'เงินประกันจากระบบเดิม' : 'เก็บได้ไม่ครบ?'}
                  points={
                    form.carriedOver
                      ? ['ใช้คืนตอนย้ายออก', 'ส่วนที่ขาดจะขึ้นเป็นยอดค้างที่หน้าห้อง']
                      : ['กรอกยอดที่รับจริงวันนี้', 'ส่วนที่ขาดจะขึ้นเป็นยอดค้างที่หน้าห้อง']
                  }
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
              <p className="field-hint">
                เว้นว่าง = {form.carriedOver ? 'ถือไว้ครบ' : 'เก็บครบ'} {formatBaht(dueToday)} บาท
              </p>
            </div>

            <div className="contract-summary">
              <h4>สรุป</h4>
              <div className="contract-summary-row">
                <span>เงินประกัน</span>
                <span>{formatBaht(depositCents)} บาท</span>
              </div>
              {!form.carriedOver && (
                <div className="contract-summary-row">
                  <span>เงินจอง</span>
                  <span className="negative">-{formatBaht(bookingCents)} บาท</span>
                </div>
              )}
              <div className="contract-summary-row total">
                <span>{form.carriedOver ? 'รวม (ยกยอดจากระบบเดิม)' : 'รวม (เก็บเพิ่ม)'}</span>
                <span>{formatBaht(dueToday)} บาท</span>
              </div>
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
                owner={phoneOwners[onlyDigits(person.phone)] ?? null}
                duplicateOf={duplicateOf(index)}
                onPhoneBlur={() => checkPhone(person.phone)}
                canRemove={tenants.length > 1}
                onChange={(next) =>
                  setTenants((list) => list.map((t, i) => (i === index ? next : t)))
                }
                onRemove={() =>
                  ask({
                    title: index === 0 ? 'นำผู้เช่าหลักออก?' : `นำผู้อยู่ร่วมคนที่ ${index} ออก?`,
                    message: 'ข้อมูลที่กรอกไว้ของคนนี้จะหายไป',
                    confirmLabel: 'นำออก',
                    busyLabel: 'กำลังนำออก...',
                    icon: 'close',
                    onConfirm: () => {
                      setTenants((list) => list.filter((_, i) => i !== index))
                      return { success: true }
                    }
                  })
                }
              />
            ))}

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
                <span>
                  {formatBaht(form.carriedOver ? 0 : advanceRentCents(rentCents, form.startDate))} บาท
                </span>
              </div>
            </div>
            {form.carriedOver && <p className="muted">ผู้เช่าเดิม จ่ายค่าเช่าในระบบเดิมแล้ว</p>}

          </>
        )}

        {step === 2 && (
          <>
            <h3 className="panel-title">
              {form.carriedOver ? 'เลขมิเตอร์วันเริ่มใช้ระบบ' : 'เลขมิเตอร์วันเข้าพัก'}
              <InfoTip title="เลขตั้งต้น" points={['ใช้คิดค่าน้ำ/ค่าไฟบิลแรกของสัญญานี้']} />
            </h3>
            <p className="panel-subtitle">
              {form.carriedOver ? 'จดจากหน้าปัดจริงวันนี้' : 'จดจากหน้าปัดจริงในวันเข้าพัก'}
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

function TenantFields({ index, value, owner, duplicateOf, onPhoneBlur, onChange, onRemove, canRemove }) {
  const set = (key, v) => onChange({ ...value, [key]: v })

  return (
    <div className="contract-tenant">
      <div className="contract-tenant-head">
        <strong>{tenantLabel(index)}</strong>
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
            onBlur={onPhoneBlur}
            inputMode="tel"
          />
          {duplicateOf >= 0 ? (
            <FieldError message={`เบอร์ซ้ำกับ${tenantLabel(duplicateOf)} ในสัญญานี้`} />
          ) : owner && idCardMismatch(value, owner) ? (
            <FieldError message={`เบอร์นี้เป็นของ ${owner.fullName} แต่เลขบัตรไม่ตรงกัน · กรุณาใช้เบอร์อื่น`} />
          ) : owner ? (
            <p className="field-hint field-hint-warn">
              เบอร์นี้เป็นของ {owner.fullName} ({ownerStatus(owner)}) · ถ้าเป็นคนเดิม ระบบจะใช้ข้อมูลเดิม
            </p>
          ) : null}
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

function tenantLabel(index) {
  return index === 0 ? 'ผู้เช่าหลัก' : `ผู้อยู่ร่วมคนที่ ${index}`
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

async function findPhoneOwner(phone) {
  const digits = onlyDigits(phone)
  if (digits.length < 9) return null
  const res = await listTenants(digits)
  return res.success ? (res.data.find((t) => t.phone === digits) ?? null) : null
}

// กรอกเลขบัตรมาแล้วไม่ตรงกับเจ้าของเบอร์ = คนละคนแน่นอน
function idCardMismatch(person, owner) {
  const typed = onlyDigits(person.idCardNo)
  return Boolean(typed && owner.idCardNo && typed !== owner.idCardNo)
}

function ownerStatus(owner) {
  return owner.activeContracts > 0 ? 'ยังมีสัญญาเช่าอยู่' : 'ผู้เช่าเก่า'
}

function reuseNote(person, owner) {
  const typedName = `${person.firstName.trim()} ${person.lastName.trim()}`
  const nameNote = typedName === owner.fullName ? '' : ` ชื่อที่กรอกไว้ "${typedName}" จะไม่ถูกใช้`
  return `เบอร์ ${formatPhone(owner.phone)} เป็นของ "${owner.fullName}" (${ownerStatus(owner)}) สัญญานี้จะใช้ข้อมูลเดิมของคนนี้${nameNote}`
}

// ตรวจก่อนสร้างผู้เช่าคนแรก — กันสร้างไปครึ่งทางแล้วค้าง
async function findOwnerProblem(tenants, owners) {
  for (const [i, person] of tenants.entries()) {
    const owner = owners[i]
    if (owner && idCardMismatch(person, owner)) {
      return `เบอร์ของ${tenantLabel(i)} เป็นของ "${owner.fullName}" แต่เลขบัตรไม่ตรงกัน · ถ้าเป็นคนละคน กรุณาใช้เบอร์อื่น`
    }

    const idCard = onlyDigits(person.idCardNo)
    if (owner || !idCard) continue
    const res = await listTenants(idCard)
    const cardOwner = res.success ? res.data.find((t) => t.idCardNo === idCard) : null
    if (cardOwner) {
      return `เลขบัตรของ${tenantLabel(i)} เป็นของ "${cardOwner.fullName}" (เบอร์ ${formatPhone(cardOwner.phone)}) อยู่แล้ว · ถ้าเป็นคนเดิม ให้กรอกเบอร์นี้`
    }
  }
  return null
}

function today() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// แสดงตัวอย่างเท่านั้น — ค่าไม่ครบคืน 0
function toCentsSafe(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

// สำเนาของ calculateAdvanceRentCents ใน main/db/contracts.js — ต้องได้คำตอบเท่ากัน (ต่างแค่วันที่ไม่ครบคืน 0)
function advanceRentCents(rentCents, startDate) {
  const date = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 0

  const rent = Number(rentCents)
  const dayOfMonth = date.getDate()
  if (dayOfMonth <= FULL_MONTH_MOVE_IN_UNTIL_DAY) return rent

  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  // นับวันเข้าพักเป็นวันแรกด้วย
  const daysStaying = daysInMonth - dayOfMonth + 1

  // หาร 30 เสมอ แล้วปัดเป็นบาทเต็ม — ต้องตรงกับ main
  return Math.round((rent * daysStaying) / (PRORATE_DAYS_PER_MONTH * 100)) * 100
}

// เดาคำแรกเป็นชื่อ ที่เหลือเป็นนามสกุล ให้คนตรวจ
function tenantFromBooking(booking) {
  const parts = String(booking.customerName ?? '').trim().split(/\s+/)
  return {
    ...EMPTY_TENANT,
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
    phone: booking.customerPhone ?? ''
  }
}
