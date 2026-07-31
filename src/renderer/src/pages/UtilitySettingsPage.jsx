import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import Modal from '../components/Modal.jsx'
import ToggleSwitch from '../components/ToggleSwitch.jsx'
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

export default function UtilitySettingsPage({ apartment }) {
  const [sides, setSides] = useState({ water: EMPTY_SIDE, electric: EMPTY_SIDE })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null) // 'water' | 'electric' | null

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
  async function persist(next) {
    setError('')
    setBusy(true)
    const res = await saveUtilityDefaults(apartment.apartmentId, next)
    setBusy(false)
    if (!res.success) {
      setError(res.error)
      return false
    }
    setSides(next)
    return true
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
              onChange={(enabled) =>
                persist({ ...sides, [key]: { ...sides[key], enabled } })
              }
            />
            <ToggleSwitch
              label="แสดงจำนวนเลขมิเตอร์ที่ใบแจ้งหนี้"
              checked={sides[key].showReadingInInvoice}
              disabled={busy || !sides[key].enabled}
              onChange={(showReadingInInvoice) =>
                persist({ ...sides, [key]: { ...sides[key], showReadingInInvoice } })
              }
            />

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

      {editing && (
        <UtilityDialog
          meta={SIDES[editing]}
          value={sides[editing]}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (side) => {
            const ok = await persist({ ...sides, [editing]: side })
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
