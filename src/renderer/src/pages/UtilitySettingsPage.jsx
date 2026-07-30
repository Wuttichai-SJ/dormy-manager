import React, { useCallback, useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
import { centsToInput } from '../format.js'
import { BILLING_TYPE_LABELS, BILLING_TYPES } from '../constants.js'
import { getUtilityDefaults, saveUtilityDefaults } from '../services/utilityService.js'

// ขั้นที่ 2 ของการตั้งค่าหอ — วิธีคิดค่าน้ำและค่าไฟ
//
// ค่าที่ตั้งที่นี่เป็น "ค่าเริ่มต้นของหอ" ห้องที่สร้างใหม่จะได้ค่านี้ไป
// การแก้ทีหลังไม่ย้อนไปเปลี่ยนห้องที่มีอยู่แล้ว (กันไม่ให้ราคาพิเศษรายห้องถูกทับหาย)
//
// น้ำกับไฟตั้งแยกกันได้อิสระ เพราะหอส่วนใหญ่คิดคนละแบบ
// (น้ำเหมาจ่าย 100 บาท/เดือน แต่ไฟคิดตามมิเตอร์ เป็นรูปแบบที่พบบ่อยที่สุด)
const EMPTY_SIDE = {
  enabled: true,
  billingType: 'actual',
  unitPrice: '',
  minCharge: '',
  flatRate: '',
  showReadingInInvoice: true
}

function toFormSide(side) {
  return {
    enabled: side.enabled,
    billingType: side.billingType,
    unitPrice: side.unitPriceCents ? centsToInput(side.unitPriceCents) : '',
    minCharge: side.minChargeCents ? centsToInput(side.minChargeCents) : '',
    flatRate: side.flatRateCents ? centsToInput(side.flatRateCents) : '',
    showReadingInInvoice: side.showReadingInInvoice
  }
}

export default function UtilitySettingsPage({ apartment }) {
  const [water, setWater] = useState(EMPTY_SIDE)
  const [electric, setElectric] = useState(EMPTY_SIDE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getUtilityDefaults(apartment.apartmentId)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setWater(toFormSide(res.data.water))
    setElectric(toFormSide(res.data.electric))
  }, [apartment.apartmentId])

  useEffect(() => {
    load()
  }, [load])

  async function submit(e) {
    e.preventDefault()
    setError('')
    setSaved(false)
    setBusy(true)
    const res = await saveUtilityDefaults(apartment.apartmentId, { water, electric })
    setBusy(false)
    if (!res.success) return setError(res.error)
    setSaved(true)
  }

  if (loading) return <p className="muted">กำลังโหลด...</p>

  return (
    <>
      <div className="info-banner">
        <strong>การคำนวณค่าน้ำ / ค่าไฟมี 3 รูปแบบ</strong>
        <p>
          คิดตามหน่วยที่ใช้จริงจากมิเตอร์ · คิดตามหน่วยที่ใช้จริงแบบมีขั้นต่ำ · คิดแบบเหมาจ่ายรายเดือน
        </p>
      </div>

      <form onSubmit={submit}>
        <Alert>{error}</Alert>
        {saved && <Alert kind="success">บันทึกวิธีคิดค่าน้ำ/ค่าไฟเรียบร้อยแล้ว</Alert>}

        <div className="utility-grid">
          <UtilitySide title="ค่าน้ำ" unitLabel="หน่วย" value={water} onChange={setWater} />
          <UtilitySide title="ค่าไฟ" unitLabel="หน่วย" value={electric} onChange={setElectric} />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>

      <p className="field-hint utility-footnote">
        ค่าเหล่านี้เป็นค่าเริ่มต้นของหอพัก ห้องที่สร้างใหม่จะได้ค่านี้ไปใช้
        ส่วนห้องที่มีอยู่แล้วจะไม่ถูกเปลี่ยนตาม — แก้รายห้องได้ที่หน้าห้องพัก
      </p>
    </>
  )
}

function UtilitySide({ title, unitLabel, value, onChange }) {
  function set(key, v) {
    onChange({ ...value, [key]: v })
  }

  return (
    <section className="panel utility-card">
      <h2 className="panel-title">{title}</h2>

      <label className="checkbox-row utility-toggle">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => set('enabled', e.target.checked)}
        />
        <span>มีการคิด{title}</span>
      </label>

      {/* ปิดการคิดแล้วไม่ต้องแสดงช่องอื่นเลย — หอที่รวมค่าน้ำไว้ในค่าเช่าจะได้ไม่ต้องเห็น
          ช่องที่ไม่เกี่ยวข้องกับตัวเอง */}
      {value.enabled && (
        <>
          <div className="field">
            <label htmlFor={`${title}-type`}>ประเภทการคิดเงิน</label>
            <select
              id={`${title}-type`}
              value={value.billingType}
              onChange={(e) => set('billingType', e.target.value)}
            >
              {BILLING_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BILLING_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          {(value.billingType === 'actual' || value.billingType === 'minimum') && (
            <div className="field">
              <label htmlFor={`${title}-unit`}>
                ราคาต่อหน่วย <span className="required">* จำเป็น</span>
              </label>
              <div className="input-with-suffix">
                <input
                  id={`${title}-unit`}
                  value={value.unitPrice}
                  onChange={(e) => set('unitPrice', e.target.value)}
                  inputMode="decimal"
                />
                <span className="input-suffix">บาท / {unitLabel}</span>
              </div>
            </div>
          )}

          {value.billingType === 'minimum' && (
            <div className="field">
              <label htmlFor={`${title}-min`}>
                ขั้นต่ำเรียกเก็บ <span className="required">* จำเป็น</span>
              </label>
              <div className="input-with-suffix">
                <input
                  id={`${title}-min`}
                  value={value.minCharge}
                  onChange={(e) => set('minCharge', e.target.value)}
                  inputMode="decimal"
                />
                <span className="input-suffix">บาท</span>
              </div>
              {/* ย้ำหน่วยให้ชัด เพราะคนมักเข้าใจว่าขั้นต่ำคือ "จำนวนหน่วย" */}
              <p className="field-hint">
                เป็นจำนวน<strong>เงิน</strong>ขั้นต่ำ ไม่ใช่จำนวนหน่วย — ใช้น้อยกว่านี้ก็เก็บเท่านี้
              </p>
            </div>
          )}

          {value.billingType === 'flat' && (
            <div className="field">
              <label htmlFor={`${title}-flat`}>
                เหมาจ่ายต่อเดือน <span className="required">* จำเป็น</span>
              </label>
              <div className="input-with-suffix">
                <input
                  id={`${title}-flat`}
                  value={value.flatRate}
                  onChange={(e) => set('flatRate', e.target.value)}
                  inputMode="decimal"
                />
                <span className="input-suffix">บาท / เดือน</span>
              </div>
            </div>
          )}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={value.showReadingInInvoice}
              onChange={(e) => set('showReadingInInvoice', e.target.checked)}
            />
            <span>แสดงเลขมิเตอร์ในใบแจ้งหนี้</span>
          </label>
        </>
      )}
    </section>
  )
}
