import React, { useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
import InfoTip from '../components/InfoTip.jsx'
import { centsToInput } from '../format.js'
import { MAX_DUE_DATE_DAY, DEFAULT_VAT_RATE, MAX_VAT_RATE } from '../constants.js'
import { createApartment, getApartment, updateApartment } from '../services/apartmentService.js'

const EMPTY = {
  nameTh: '',
  addressTh: '',
  nameEn: '',
  addressEn: '',
  phone: '',
  dueDateDay: '10',
  lateFeePerDay: '0.00',
  lateFeeGraceDays: '0',
  isAutoLateFeeEnabled: false,
  isVatEnabled: false,
  vatRate: String(DEFAULT_VAT_RATE),
  meterDigits: '5'
}

// รับแค่ตัวเลขกับจุดเดียว ทศนิยมไม่เกิน 2 ตำแหน่ง
function sanitiseRate(value) {
  const cleaned = String(value).replace(/[^\d.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  if (rest.length === 0) return whole
  return `${whole}.${rest.join('').slice(0, 2)}`
}

const DUE_DATE_DAYS = Array.from({ length: MAX_DUE_DATE_DAY }, (_, i) => i + 1)
const METER_DIGIT_CHOICES = [4, 5, 6, 7, 8]

export default function ApartmentFormPage({ apartmentId, onDone }) {
  const isEdit = Boolean(apartmentId)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(isEdit)

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false

    getApartment(apartmentId).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (!res.success) return setError(res.error)

      const a = res.data
      setForm({
        nameTh: a.nameTh ?? '',
        addressTh: a.addressTh ?? '',
        nameEn: a.nameEn ?? '',
        addressEn: a.addressEn ?? '',
        phone: a.phone ?? '',
        dueDateDay: String(a.dueDateDay),
        lateFeePerDay: centsToInput(a.lateFeePerDayCents),
        lateFeeGraceDays: String(a.lateFeeGraceDays ?? 0),
        isAutoLateFeeEnabled: a.isAutoLateFeeEnabled,
        isVatEnabled: a.isVatEnabled,
        vatRate: String(a.vatRate ?? DEFAULT_VAT_RATE),
        meterDigits: String(a.meterDigits ?? 5)
      })
    })

    return () => {
      cancelled = true
    }
  }, [apartmentId, isEdit])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = isEdit
      ? await updateApartment(apartmentId, form)
      : await createApartment(form)
    setBusy(false)

    if (!res.success) return setError(res.error)
    onDone(res.data)
  }

  if (loading) return <p className="muted">กำลังโหลดข้อมูลหอพัก...</p>

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>

      <section className="form-section">
        <div className="form-section-head">
          <h2>รายละเอียดหอพัก</h2>
          <p>ชื่อและที่อยู่ จะถูกนำไปแสดงในใบแจ้งหนี้และใบเสร็จ</p>
        </div>

        <div className="form-section-body">
          <div className="field field-required">
            <label htmlFor="nameTh">
              ชื่อ (ภาษาไทย) <Required />
            </label>
            <input
              id="nameTh"
              value={form.nameTh}
              onChange={(e) => set('nameTh', e.target.value)}
              autoFocus
            />
          </div>

          <div className="field field-required">
            <label htmlFor="addressTh">
              ที่อยู่ (ภาษาไทย) <Required />
            </label>
            <input
              id="addressTh"
              value={form.addressTh}
              onChange={(e) => set('addressTh', e.target.value)}
            />
          </div>

          <hr className="divider" />

          <div className="field">
            <label htmlFor="nameEn">ชื่อ (อังกฤษ)</label>
            <input
              id="nameEn"
              value={form.nameEn}
              onChange={(e) => set('nameEn', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="addressEn">ที่อยู่ (อังกฤษ)</label>
            <input
              id="addressEn"
              value={form.addressEn}
              onChange={(e) => set('addressEn', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-head">
          <h2>รายละเอียดอื่นๆ</h2>
          <p>เบอร์โทรศัพท์สำหรับให้ผู้เช่าติดต่อ</p>
        </div>
        <div className="form-section-body">
          <div className="field">
            <label htmlFor="phone">เบอร์โทรศัพท์</label>
            <input
              id="phone"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              inputMode="tel"
            />
          </div>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-head">
          <h2>มิเตอร์น้ำ-ไฟ</h2>
          <p>จำนวนหลักบนหน้าปัดมิเตอร์ ใช้กันการกรอกเลขเกินและคิดหน่วยตอนมิเตอร์หมุนครบรอบ</p>
        </div>
        <div className="form-section-body">
          <div className="field">
            <label htmlFor="meterDigits">
              จำนวนหลักของมิเตอร์
              <InfoTip
                title="จำนวนหลักของมิเตอร์"
                points={[
                  'นับเฉพาะหลักบนหน้าปัด',
                  'มิเตอร์ 5 หลักอ่านได้ถึง 99,999 แล้วหมุนกลับไป 0',
                  'เลขที่จดเกินกว่านี้ระบบไม่รับ'
                ]}
              />
            </label>
            <select
              id="meterDigits"
              value={form.meterDigits}
              onChange={(e) => set('meterDigits', e.target.value)}
            >
              {METER_DIGIT_CHOICES.map((digits) => (
                <option key={digits} value={digits}>
                  {digits} หลัก (สูงสุด {(10 ** digits - 1).toLocaleString()})
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-head">
          <h2>กำหนดชำระค่าห้องและค่าปรับ</h2>
          <p>วันที่ที่ต้องการให้ระบบเริ่มคิดค่าปรับอัตโนมัติกรณีเลยวันที่กำหนดชำระเงิน</p>
        </div>

        <div className="form-section-body">
          <div className="field field-required">
            <label htmlFor="dueDateDay">
              วันสุดท้ายของการชำระเงิน <Required />
              <InfoTip
                title="วันครบกำหนดชำระ"
                points={[
                  `เลือกได้ถึงวันที่ ${MAX_DUE_DATE_DAY} เพื่อให้มีวันนี้ครบทุกเดือน`,
                  `ออกบิลก่อนวันที่ ${form.dueDateDay} → ครบกำหนดเดือนเดียวกัน`,
                  `ออกบิลตั้งแต่วันที่ ${form.dueDateDay} → เลื่อนไปเดือนถัดไป`
                ]}
              />
            </label>
            <select
              id="dueDateDay"
              value={form.dueDateDay}
              onChange={(e) => set('dueDateDay', e.target.value)}
            >
              {DUE_DATE_DAYS.map((day) => (
                <option key={day} value={day}>
                  วันที่ {day}
                </option>
              ))}
            </select>
          </div>

          <div className="field field-required">
            <label htmlFor="lateFeePerDay">
              ค่าปรับชำระล่าช้าต่อวัน <Required />
            </label>
            <div className="input-with-suffix">
              <input
                id="lateFeePerDay"
                value={form.lateFeePerDay}
                onChange={(e) => set('lateFeePerDay', e.target.value)}
                inputMode="decimal"
              />
              <span className="input-suffix">บาท/วัน</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="lateFeeGraceDays">
              ผ่อนผันก่อนเริ่มปรับ
              <InfoTip
                title="วันผ่อนผัน"
                points={['เกินกำหนดกี่วันจึงเริ่มคิดค่าปรับ', '0 = ปรับตั้งแต่วันถัดจากวันครบกำหนด']}
              />
            </label>
            <div className="input-with-suffix">
              <input
                id="lateFeeGraceDays"
                value={form.lateFeeGraceDays}
                onChange={(e) => set('lateFeeGraceDays', e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />
              <span className="input-suffix">วัน</span>
            </div>
          </div>

          <div className="field checkbox-field">
            <span>กรณีมีการชำระล่าช้ากว่าวันที่ระบุ ต้องการให้ระบบเพิ่มค่าปรับให้อัตโนมัติหรือไม่</span>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.isAutoLateFeeEnabled}
                onChange={(e) => set('isAutoLateFeeEnabled', e.target.checked)}
              />
              <span>ต้องการ</span>
            </label>
            {form.isAutoLateFeeEnabled && Number(form.lateFeePerDay) === 0 ? (
              <p className="field-hint field-hint-warn">
                ค่าปรับต่อวันยังเป็น 0 บาท — ระบบจะเก็บค่าปรับไม่ได้
              </p>
            ) : (
              <p className="field-hint">
                {form.isAutoLateFeeEnabled
                  ? 'ระบบคำนวณค่าปรับให้ตอนรับเงิน · ยกเลิกหรือลดยอดได้'
                  : 'ปิดอยู่ · ค่าปรับที่กรอกไว้ยังไม่ถูกใช้'}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-head">
          <h2>รายละเอียด VAT</h2>
          <p>เปิดเมื่อหอพักจดทะเบียน VAT และต้องแสดงภาษีในใบแจ้งหนี้</p>
        </div>
        <div className="form-section-body">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.isVatEnabled}
              onChange={(e) => set('isVatEnabled', e.target.checked)}
            />
            <span>เปิดการใช้งาน VAT</span>
          </label>

          <div className="field">
            <label htmlFor="vatRate">
              อัตรา VAT
              <InfoTip
                title="อัตรา VAT"
                points={[
                  `กรอกได้ 0-${MAX_VAT_RATE} ทศนิยมไม่เกิน 2 ตำแหน่ง`,
                  'บิลที่ออกไปแล้วคิดที่อัตราเดิมเสมอ แม้ผู้เช่ามาจ่ายช้า'
                ]}
              />
            </label>
            <div className="input-with-suffix">
              <input
                id="vatRate"
                value={form.vatRate}
                onChange={(e) => set('vatRate', sanitiseRate(e.target.value))}
                inputMode="decimal"
                disabled={!form.isVatEnabled}
              />
              <span className="input-suffix">%</span>
            </div>
            <p className="field-hint">เปลี่ยนอัตรามีผลกับบิลรอบถัดไปเท่านั้น</p>
          </div>
        </div>
      </section>

      <div className="form-actions">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'กำลังบันทึก...' : isEdit ? 'บันทึก' : 'สร้าง'}
        </button>
      </div>
    </form>
  )
}

function Required() {
  return <span className="required">* จำเป็น</span>
}
