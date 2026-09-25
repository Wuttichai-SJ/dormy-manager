import React, { useCallback, useEffect, useState } from 'react'
import InfoTip from '../components/InfoTip.jsx'
import Alert from '../components/Alert.jsx'
import { centsToInput, formatBaht } from '../format.js'
import {
  createService,
  deleteService,
  listServices,
  updateService
} from '../services/apartmentServiceService.js'

// ค่าบริการของหอ — ขั้นแรกของการตั้งค่าหอพัก (ตามลำดับของต้นแบบ)
//
// รายการที่นี่เป็นแค่ "แคตตาล็อก" ยังไม่ผูกกับห้องไหน การเลือกว่าห้องไหนใช้บริการอะไร
// เป็นอีกหน้าหนึ่ง (ค่าบริการรายห้อง) — แยกกันเพราะหอส่วนใหญ่มีบริการไม่กี่รายการ
// แต่มีหลายสิบห้อง ถ้าให้กรอกรายห้องตั้งแต่แรกจะพิมพ์ชื่อเดิมซ้ำหลายสิบรอบ

// ต้นแบบเขียนว่า "เลือกจากรายการที่มี หรือพิมพ์ชื่อค่าบริการเองได้"
// ใช้ datalist เพื่อให้ได้ทั้งสองอย่างในช่องเดียว โดยไม่ต้องเพิ่ม dependency dropdown
const PRESET_NAMES = [
  'ค่าอินเทอร์เน็ต',
  'ค่าที่จอดรถ',
  'ค่าส่วนกลาง',
  'ค่าเก็บขยะ',
  'ค่าทำความสะอาด',
  'ค่ารักษาความปลอดภัย',
  'ค่าเคเบิลทีวี',
  'ค่าเฟอร์นิเจอร์'
]

const EMPTY = { name: '', price: '', isMeterBased: false, isVatEnabled: false }

export default function ApartmentServicesPage({ apartment }) {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listServices(apartment.apartmentId)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setServices(res.data)
  }, [apartment.apartmentId])

  useEffect(() => {
    load()
  }, [load])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function resetForm() {
    setForm(EMPTY)
    setEditingId(null)
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = editingId
      ? await updateService(editingId, form)
      : await createService(apartment.apartmentId, form)
    setBusy(false)

    if (!res.success) return setError(res.error)
    resetForm()
    load()
  }

  function startEdit(service) {
    setEditingId(service.serviceId)
    setForm({
      name: service.name,
      price: centsToInput(service.priceCents),
      isMeterBased: service.isMeterBased,
      isVatEnabled: service.isVatEnabled
    })
  }

  async function remove(service) {
    setError('')
    const res = await deleteService(service.serviceId)
    if (!res.success) return setError(res.error)
    if (editingId === service.serviceId) resetForm()
    load()
  }

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">
          ค่าบริการเพิ่มเติม
          <InfoTip
            title="ค่าบริการเพิ่มเติม"
            points={['เช่น ค่าอินเทอร์เน็ต ค่าที่จอดรถ ค่าส่วนกลาง', 'ผูกกับห้องได้ที่ ค่าบริการอื่น ๆ']}
          />
        </h2>
        <Alert>{error}</Alert>

        {/* ต้นแบบวางช่องกรอกเรียงเป็นแถวเดียว: ชื่อ | ราคา | คิด VAT
            แล้วค่อยเป็นตัวเลือก "แปรผันตามมิเตอร์" กับปุ่มเพิ่มด้านล่าง */}
        <form className="service-form" onSubmit={submit}>
          <div className="service-form-row">
            <div className="field field-required service-form-name">
              <label htmlFor="serviceName">
                ชื่อค่าบริการ <span className="required">* จำเป็น</span>
              </label>
              <input
                id="serviceName"
                list="service-name-presets"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                autoComplete="off"
              />
              <datalist id="service-name-presets">
                {PRESET_NAMES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div className="field field-required service-form-price">
              <label htmlFor="servicePrice">
                {apartment.isVatEnabled ? 'ราคา (ก่อน Vat)' : 'ราคา'}{' '}
                <span className="required">* จำเป็น</span>
              </label>
              <div className="input-with-suffix">
                <input
                  id="servicePrice"
                  value={form.price}
                  onChange={(e) => set('price', e.target.value)}
                  inputMode="decimal"
                />
                <span className="input-suffix">{form.isMeterBased ? 'บาท/หน่วย' : 'บาท'}</span>
              </div>
            </div>

            {/* ช่อง VAT โผล่เฉพาะหอที่เปิด VAT ไว้ — หอที่ไม่ได้จด VAT ไม่ต้องเห็นตัวเลือกนี้ */}
            {apartment.isVatEnabled && (
              <div className="field service-form-vat">
                <label htmlFor="serviceVat">คำนวณ VAT</label>
                <label className="checkbox-row">
                  <input
                    id="serviceVat"
                    type="checkbox"
                    checked={form.isVatEnabled}
                    onChange={(e) => set('isVatEnabled', e.target.checked)}
                  />
                  <span>คำนวณ</span>
                </label>
              </div>
            )}
          </div>

          <label className="checkbox-row service-form-meter">
            <input
              type="checkbox"
              checked={form.isMeterBased}
              onChange={(e) => set('isMeterBased', e.target.checked)}
            />
            <span>ประเภทแปรผันตามมิเตอร์</span>
            <InfoTip
              title="แปรผันตามมิเตอร์"
              points={[
                'ติ๊ก = คิดตามหน่วยที่ใช้จริง ราคาข้างบนเป็นราคาต่อหน่วย',
                'ไม่ติ๊ก = เหมาจ่ายเท่ากันทุกเดือน'
              ]}
            />
          </label>

          <div className="service-form-submit">
            {editingId && (
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                ยกเลิก
              </button>
            )}
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'กำลังบันทึก...' : editingId ? 'บันทึก' : 'เพิ่ม'}
            </button>
          </div>
        </form>

        <hr className="divider" />

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : services.length === 0 ? (
          <p className="muted table-empty">ยังไม่มีค่าบริการ</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>รายการ</th>
                <th>คำนวณตาม</th>
                <th className="align-right">ราคา</th>
                {apartment.isVatEnabled && <th>VAT</th>}
                <th className="align-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.serviceId} className={editingId === s.serviceId ? 'row-editing' : ''}>
                  <td>{s.name}</td>
                  <td>{s.isMeterBased ? 'ตามมิเตอร์' : 'เหมาจ่าย'}</td>
                  <td className="align-right">
                    {formatBaht(s.priceCents)}
                    <span className="unit">{s.isMeterBased ? ' บาท/หน่วย' : ' บาท'}</span>
                  </td>
                  {apartment.isVatEnabled && <td>{s.isVatEnabled ? 'คำนวณ' : '—'}</td>}
                  <td className="align-right">
                    <button type="button" className="link-btn" onClick={() => startEdit(s)}>
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="link-btn link-danger table-action"
                      onClick={() => remove(s)}
                      aria-label={`ลบ ${s.name}`}
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
