import React, { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { centsToInput } from '../format.js'
import { MAX_DUE_DATE_DAY } from '../constants.js'
import { createApartment, getApartment, updateApartment } from '../services/apartmentService.js'

// ฟอร์มเพิ่ม/แก้ไขหอพัก — โครงตามหน้าเพิ่มอพาร์ตเมนต์ของต้นแบบ:
// แต่ละกลุ่มมีหัวข้อ+คำอธิบายอยู่คอลัมน์ซ้าย ช่องกรอกอยู่คอลัมน์ขวา
//
// ต่างจากต้นแบบโดยตั้งใจ 2 อย่าง:
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
  isAutoLateFeeEnabled: false,
  isVatEnabled: false
}

const DUE_DATE_DAYS = Array.from({ length: MAX_DUE_DATE_DAY }, (_, i) => i + 1)

export default function ApartmentFormPage({ apartmentId, onDone, onCancel }) {
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
          <div className="field">
            <label htmlFor="nameTh">
              ชื่อหอพัก (ภาษาไทย) <Required />
            </label>
            <input
              id="nameTh"
              value={form.nameTh}
              onChange={(e) => set('nameTh', e.target.value)}
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="addressTh">
              ที่อยู่ (ภาษาไทย) <Required />
            </label>
            <textarea
              id="addressTh"
              rows={2}
              value={form.addressTh}
              onChange={(e) => set('addressTh', e.target.value)}
            />
          </div>

          <hr className="divider" />

          <div className="field">
            <label htmlFor="nameEn">ชื่อหอพัก (อังกฤษ)</label>
            <input
              id="nameEn"
              value={form.nameEn}
              onChange={(e) => set('nameEn', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="addressEn">ที่อยู่ (อังกฤษ)</label>
            <textarea
              id="addressEn"
              rows={2}
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
          <h2>กำหนดชำระและค่าปรับ</h2>
          <p>วันที่ที่ระบบจะเริ่มคิดค่าปรับ หากเลยกำหนดชำระเงิน</p>
        </div>

        <div className="form-section-body">
          <div className="field">
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
            {/* เหตุผลที่หยุดที่ 28 อยู่ใน db/apartments.js — เดือน ก.พ. ไม่มีวันที่ 29-31 */}
            <p className="field-hint">เลือกได้ถึงวันที่ {MAX_DUE_DATE_DAY} เพื่อให้มีวันนี้ครบทุกเดือน</p>
          </div>

          <div className="field">
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
            <p className="field-hint">หอที่ไม่คิดค่าปรับ ให้ใส่ 0</p>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.isAutoLateFeeEnabled}
              onChange={(e) => set('isAutoLateFeeEnabled', e.target.checked)}
            />
            <span>ให้ระบบเพิ่มค่าปรับอัตโนมัติเมื่อเลยกำหนดชำระ</span>
          </label>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-head">
          <h2>ภาษีมูลค่าเพิ่ม (VAT)</h2>
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
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          ยกเลิก
        </button>
        <button type="submit" className="btn" disabled={busy}>
          <Icon name="check" />
          <span>{busy ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'สร้างหอพัก'}</span>
        </button>
      </div>
    </form>
  )
}

function Required() {
  return <span className="required">* จำเป็น</span>
}
