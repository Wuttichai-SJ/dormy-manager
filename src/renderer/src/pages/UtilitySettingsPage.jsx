import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import Modal from '../components/Modal.jsx'
import ToggleSwitch from '../components/ToggleSwitch.jsx'
import { centsToInput } from '../format.js'
import { BILLING_TYPE_LABELS, BILLING_TYPES } from '../constants.js'
import {
  applyUtilityDefaultsToRooms,
  getUtilityDefaults,
  saveUtilityDefaults
} from '../services/utilityService.js'

// ขั้นที่ 2 ของการตั้งค่าหอ — วิธีคิดค่าน้ำและค่าไฟ
//
// ค่าที่ตั้งที่นี่เป็น "ค่าเริ่มต้นของหอ" ห้องที่สร้างใหม่จะได้ค่านี้ไป
// การแก้ทีหลังไม่ย้อนไปเปลี่ยนห้องที่มีอยู่แล้ว (กันไม่ให้ราคาพิเศษรายห้องถูกทับหาย)
//
// น้ำกับไฟตั้งแยกกันได้อิสระ เพราะหอส่วนใหญ่คิดคนละแบบ
// (น้ำเหมาจ่าย 100 บาท/เดือน แต่ไฟคิดตามมิเตอร์ เป็นรูปแบบที่พบบ่อยที่สุด)
//
// โครงหน้าจอตามต้นแบบ: สองคอลัมน์ ไอคอนใหญ่นำ แล้วเป็นสวิตช์เปิด/ปิดสองอัน
// ส่วนราคาไปอยู่ในหน้าต่างซ้อนที่กดจากปุ่ม "ระบุการคิดค่าน้ำ / ค่าไฟ"
// เหตุผลที่ต้นแบบซ่อนราคาไว้ในหน้าต่าง: ช่องราคาเปลี่ยนไปตามประเภทการคิดเงิน
// ถ้าโชว์ทั้งหมดคาหน้าจอ สองคอลัมน์จะยาวไม่เท่ากันและอ่านยาก
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

const SIDES = {
  water: { title: 'ค่าน้ำ', icon: 'water', unitLabel: 'หน่วย' },
  electric: { title: 'ค่าไฟ', icon: 'electric', unitLabel: 'หน่วย' }
}

// "ระบุแล้ว" = ช่องราคาที่โหมดนั้นใช้จริงมีค่ามากกว่าศูนย์
function hasPrice(side) {
  const filled = (value) => Number(value) > 0
  if (side.billingType === 'flat') return filled(side.flatRate)
  return filled(side.unitPrice)
}

// สรุปสิ่งที่กรอกไปแล้วเป็นสองบรรทัด แบบเดียวกับต้นแบบ — เจ้าของหอต้องเห็นได้ทันที
// ว่าตัวเองตั้งอะไรไว้ โดยไม่ต้องกดเข้าหน้าต่างไปดู ต้องมีครบทั้งสามประเภทการคิดเงิน
//
//   ตามมิเตอร์ที่ใช้จริง        / 8 บาท/ยูนิต
//   ตามมิเตอร์แบบมีขั้นต่ำ 120 บาท / 30 บาท/ยูนิต
//   เหมาจ่ายรายเดือน           / 500 บาท/เดือน
function summarize(side) {
  const amount = (value) => Number(value).toLocaleString('th-TH')

  if (side.billingType === 'flat') {
    return { headline: BILLING_TYPE_LABELS.flat, detail: `${amount(side.flatRate)} บาท/เดือน` }
  }
  if (side.billingType === 'minimum') {
    return {
      headline: `${BILLING_TYPE_LABELS.minimum} ${amount(side.minCharge)} บาท`,
      detail: `${amount(side.unitPrice)} บาท/ยูนิต`
    }
  }
  return {
    headline: BILLING_TYPE_LABELS.actual,
    detail: `${amount(side.unitPrice)} บาท/ยูนิต`
  }
}

export default function UtilitySettingsPage({ apartment }) {
  const [sides, setSides] = useState({ water: EMPTY_SIDE, electric: EMPTY_SIDE })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null) // 'water' | 'electric' | null
  // จำนวนห้องที่เพิ่งถูกทับราคา — null = ยังไม่ได้กดในรอบนี้
  const [applied, setApplied] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getUtilityDefaults(apartment.apartmentId)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setSides({ water: toFormSide(res.data.water), electric: toFormSide(res.data.electric) })
  }, [apartment.apartmentId])

  useEffect(() => {
    load()
  }, [load])

  // บันทึกทันทีที่สลับสวิตช์หรือกดบันทึกในหน้าต่างซ้อน — หน้านี้ไม่มีปุ่มบันทึกรวม
  // (ต้นแบบก็ไม่มี) ถ้าเก็บไว้รอกดทีเดียว คนจะกด "ต่อไป" แล้วค่าหายโดยไม่รู้ตัว
  //
  // ส่งไปเฉพาะ "ฝั่งที่แก้" และเฉพาะ "ช่องที่แก้" ฝั่ง main จะเอาไปผสมกับของเดิมเอง
  // ถ้าส่งทั้งก้อนทุกครั้ง ฝั่งที่ยังไม่ได้กรอกราคาจะทำให้การตรวจล้มแล้วบล็อกอีกฝั่ง
  async function persist(key, patch) {
    setError('')
    setBusy(true)
    const res = await saveUtilityDefaults(apartment.apartmentId, { [key]: patch })
    setBusy(false)
    if (!res.success) {
      setError(res.error)
      return false
    }
    setSides({ water: toFormSide(res.data.water), electric: toFormSide(res.data.electric) })
    return true
  }

  async function applyToRooms() {
    setError('')
    setApplied(null)
    setBusy(true)
    const res = await applyUtilityDefaultsToRooms(apartment.apartmentId)
    setBusy(false)
    if (!res.success) return setError(res.error)
    setApplied(res.data.updatedRooms)
  }

  if (loading) return <p className="muted">กำลังโหลด...</p>

  return (
    <>
      <Alert>{error}</Alert>

      <div className="utility-grid">
        {Object.entries(SIDES).map(([key, meta]) => (
          <section className={`utility-side utility-${key}`} key={key}>
            <span className={`utility-mark utility-mark-${key}`}>
              <Icon name={meta.icon} />
            </span>

            <ToggleSwitch
              label={`มีการคิด${meta.title}`}
              checked={sides[key].enabled}
              disabled={busy}
              onChange={(enabled) => persist(key, { enabled })}
            />
            <ToggleSwitch
              label="แสดงจำนวนเลขมิเตอร์ที่ใบแจ้งหนี้"
              checked={sides[key].showReadingInInvoice}
              disabled={busy || !sides[key].enabled}
              onChange={(showReadingInInvoice) => persist(key, { showReadingInInvoice })}
            />

            {/* กรอกแล้ว = สรุปให้เห็นว่าตั้งอะไรไว้ / ยังไม่กรอก = เตือนว่าออกบิลจะได้ 0 บาท
                ทั้งสองกรณีต้องเห็นตั้งแต่หน้านี้ ไม่ใช่ต้องกดเข้าหน้าต่างไปดูเอง */}
            {sides[key].enabled &&
              (hasPrice(sides[key]) ? (
                <div className="utility-summary">
                  <strong>{summarize(sides[key]).headline}</strong>
                  <span>{summarize(sides[key]).detail}</span>
                </div>
              ) : (
                <div className="utility-summary utility-summary-empty">
                  <strong>ยังไม่ได้ระบุการคิด{meta.title}</strong>
                  <span>ออกบิลตอนนี้จะคิดเป็น 0 บาท</span>
                </div>
              ))}

            <div className="utility-side-action">
              <button
                type="button"
                className="btn-outline"
                disabled={!sides[key].enabled}
                onClick={() => setEditing(key)}
              >
                ระบุการคิด{meta.title}
              </button>
            </div>
          </section>
        ))}
      </div>

      <p className="field-hint utility-footnote">
        ค่าเหล่านี้เป็นค่าเริ่มต้นของหอพัก ห้องที่สร้างใหม่จะได้ค่านี้ไปใช้
        ส่วนห้องที่มีอยู่แล้วจะไม่ถูกเปลี่ยนตาม — แก้รายห้องได้ที่หน้าห้องพัก
      </p>

      {/* ทางออกสำหรับห้องที่ถูกสร้างก่อนหอจะมีราคา — ห้องพวกนั้นถือ "ราคา 0" ติดตัวอยู่
          แล้วออกบิลมาเป็น 0 บาทอย่างเงียบๆ ต้องมีวิธีดันราคาลงไปให้ครบทุกห้อง
          ให้กดสั่งเอง ไม่ทำอัตโนมัติ เพราะมันทับราคาพิเศษที่ตั้งไว้รายห้องด้วย */}
      <section className="panel utility-apply">
        <h3 className="panel-title">นำราคานี้ไปใช้กับห้องที่มีอยู่</h3>
        <p className="field-hint">
          ห้องเก็บราคาของตัวเองไว้ตั้งแต่ตอนถูกสร้าง การแก้ราคาที่หน้านี้จึงไม่ย้อนไปเปลี่ยนห้องเดิม
          — ถ้าห้องถูกสร้างไว้ก่อนจะตั้งราคา ห้องจะยังคิดเป็น 0 บาทอยู่ กดปุ่มนี้เพื่อทับราคาของ
          <strong> ทุกห้อง</strong> ด้วยราคาปัจจุบัน (ราคาพิเศษที่ตั้งไว้รายห้องจะถูกทับไปด้วย)
        </p>

        {applied !== null && (
          <Alert kind="success">นำราคาไปใช้กับห้องแล้ว {applied} ห้อง</Alert>
        )}

        <div className="card-foot">
          <button type="button" className="btn btn-outline" disabled={busy} onClick={applyToRooms}>
            นำไปใช้กับทุกห้อง
          </button>
        </div>
      </section>

      {editing && (
        <UtilityDialog
          meta={SIDES[editing]}
          value={sides[editing]}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (side) => {
            const ok = await persist(editing, side)
            if (ok) setEditing(null)
          }}
        />
      )}
    </>
  )
}

// หน้าต่างซ้อน "ค่าน้ำ" / "ค่าไฟ" — ช่องที่ต้องกรอกเปลี่ยนตามประเภทการคิดเงินที่เลือก
function UtilityDialog({ meta, value, onClose, onSave, busy }) {
  const [side, setSide] = useState(value)
  const set = (key, v) => setSide((s) => ({ ...s, [key]: v }))

  return (
    <Modal
      title={meta.title}
      icon={meta.icon}
      busy={busy}
      onClose={onClose}
      onSubmit={() => onSave(side)}
    >
      <div className="field field-required">
        <label htmlFor="billingType">
          ประเภทการคิดเงิน <span className="required">* จำเป็น</span>
        </label>
        <select
          id="billingType"
          value={side.billingType}
          onChange={(e) => set('billingType', e.target.value)}
          autoFocus
        >
          {BILLING_TYPES.map((type) => (
            <option key={type} value={type}>
              {BILLING_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      {(side.billingType === 'actual' || side.billingType === 'minimum') && (
        <div className="field field-required">
          <label htmlFor="unitPrice">
            ราคาต่อหน่วย <span className="required">* จำเป็น</span>
          </label>
          <div className="input-with-suffix">
            <input
              id="unitPrice"
              value={side.unitPrice}
              onChange={(e) => set('unitPrice', e.target.value)}
              inputMode="decimal"
            />
            <span className="input-suffix">บาท / {meta.unitLabel}</span>
          </div>
        </div>
      )}

      {side.billingType === 'minimum' && (
        <div className="field field-required">
          <label htmlFor="minCharge">
            ขั้นต่ำเรียกเก็บ <span className="required">* จำเป็น</span>
          </label>
          <div className="input-with-suffix">
            <input
              id="minCharge"
              value={side.minCharge}
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

      {side.billingType === 'flat' && (
        <div className="field field-required">
          <label htmlFor="flatRate">
            เหมาจ่ายต่อเดือน <span className="required">* จำเป็น</span>
          </label>
          <div className="input-with-suffix">
            <input
              id="flatRate"
              value={side.flatRate}
              onChange={(e) => set('flatRate', e.target.value)}
              inputMode="decimal"
            />
            <span className="input-suffix">บาท / เดือน</span>
          </div>
        </div>
      )}
    </Modal>
  )
}
