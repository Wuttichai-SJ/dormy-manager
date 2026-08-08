import React, { useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
import { centsToInput } from '../format.js'
import { MAX_DUE_DATE_DAY } from '../constants.js'
import { createApartment, getApartment, updateApartment } from '../services/apartmentService.js'

// ฟอร์มเพิ่ม/แก้ไขหอพัก — ลอกหน้า "เพิ่มอพาร์ตเมนต์" ของต้นแบบมาทั้งโครงและระยะ:
// แต่ละกลุ่มมีหัวข้อ+คำอธิบายอยู่คอลัมน์ซ้าย การ์ดช่องกรอกอยู่คอลัมน์ขวา คั่นกลุ่มด้วย
// เส้นบางที่เว้น 32px ทั้งบนและล่าง ปิดท้ายด้วยปุ่มยืนยันใบเดียวชิดขวา (ไม่มีปุ่มยกเลิก
// เหมือนกัน — ทางออกคือลิงก์ "กลับไปรายการหอพัก" ด้านบน)
//
// ต่างจากต้นแบบโดยตั้งใจ 3 อย่าง:
// - ไม่มีหัวข้อ "โลโก้อพาร์ตเมนต์" (คอลัมน์ logo_url มีรออยู่ แต่ยังไม่ทำหน้าอัปโหลด)
// - ไม่มีช่องเลขประจำตัวผู้เสียภาษี (หอนักศึกษาไม่ออกใบกำกับภาษีเต็มรูป)
// - VAT เปิดได้เลย ไม่ต้องอัปเกรดแพ็กเกจ (ระบบนี้ไม่มีแพ็กเกจ)
const EMPTY = {
  nameTh: '',
  addressTh: '',
  nameEn: '',
  addressEn: '',
  phone: '',
  dueDateDay: '5',
  lateFeePerDay: '0.00',
  lateFeeGraceDays: '0',
  isAutoLateFeeEnabled: false,
  isVatEnabled: false
}

const DUE_DATE_DAYS = Array.from({ length: MAX_DUE_DATE_DAY }, (_, i) => i + 1)

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
        isVatEnabled: a.isVatEnabled
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

          {/* ต้นแบบใช้ช่องบรรทัดเดียวสำหรับที่อยู่ ไม่ใช่กล่องหลายบรรทัด */}
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
          <h2>กำหนดชำระค่าห้องและค่าปรับ</h2>
          <p>วันที่ที่ต้องการให้ระบบเริ่มคิดค่าปรับอัตโนมัติกรณีเลยวันที่กำหนดชำระเงิน</p>
        </div>

        <div className="form-section-body">
          <div className="field field-required">
            <label htmlFor="dueDateDay">
              วันสุดท้ายของการชำระเงิน <Required />
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
            {/* ต้นแบบก็ให้เลือกได้ถึงวันที่ 28 เท่ากัน เหตุผลอยู่ใน db/apartments.js
                (ก.พ. ไม่มีวันที่ 29-31) ต้นแบบไม่มีคำอธิบายบรรทัดนี้ เราใส่เพิ่มเอง
                เพราะมีคนถามแล้วว่าทำไมเลื่อนต่อไม่ได้ */}
            <p className="field-hint">เลือกได้ถึงวันที่ {MAX_DUE_DATE_DAY} เพื่อให้มีวันนี้ครบทุกเดือน</p>
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
            <label htmlFor="lateFeeGraceDays">ผ่อนผันก่อนเริ่มปรับ</label>
            <div className="input-with-suffix">
              <input
                id="lateFeeGraceDays"
                value={form.lateFeeGraceDays}
                onChange={(e) => set('lateFeeGraceDays', e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />
              <span className="input-suffix">วัน</span>
            </div>
            <p className="field-hint">
              เกินกำหนดกี่วันจึงเริ่มคิดค่าปรับ · 0 = ปรับตั้งแต่วันถัดจากวันครบกำหนดเลย
            </p>
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
            {/* บอกให้ชัดว่าปิดอยู่แล้วช่องข้างบนไม่มีผล ไม่งั้นเจ้าของหอกรอกค่าปรับไว้
                แล้วสงสัยว่าทำไมไม่เคยถูกเก็บ */}
            <p className="field-hint">
              {form.isAutoLateFeeEnabled
                ? 'เมื่อรับเงินบิลที่เกินกำหนด ระบบจะคำนวณค่าปรับให้และติ๊กไว้ให้ — ยกเลิกหรือลดยอดได้ทุกครั้ง'
                : 'ปิดอยู่ — ค่าปรับต่อวันและวันผ่อนผันที่กรอกไว้จะยังไม่ถูกนำมาใช้'}
            </p>
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
