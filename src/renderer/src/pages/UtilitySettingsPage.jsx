import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from '../components/FieldError.jsx'
import InfoTip from '../components/InfoTip.jsx'
import Modal from '../components/Modal.jsx'
import ToggleSwitch from '../components/ToggleSwitch.jsx'
import { centsToInput } from '../format.js'
import { BILLING_TYPE_LABELS, BILLING_TYPES } from '../constants.js'
import {
  applyUtilityDefaultsToRooms,
  getUtilityDefaults,
  saveUtilityDefaults
} from '../services/utilityService.js'

// ค่าตั้งต้นของหอ — ห้องใหม่ได้ค่านี้ แก้ทีหลังไม่ย้อนไปทับห้องเดิม
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

// ระบุแล้ว = ช่องราคาที่โหมดนั้นใช้มีค่ามากกว่า 0
function hasPrice(side) {
  const filled = (value) => Number(value) > 0
  if (side.billingType === 'flat') return filled(side.flatRate)
  return filled(side.unitPrice)
}

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
  const [editing, setEditing] = useState(null) /* 'water' | 'electric' | null */
  const dialogForm = useFormErrors(['billingType', 'unitPrice', 'minCharge', 'flatRate'])
  // null = ยังไม่ได้กดในรอบนี้
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

  // บันทึกทันทีเฉพาะฝั่งและช่องที่แก้ · fromDialog → error ขึ้นในหน้าต่าง
  async function persist(key, patch, { fromDialog = false } = {}) {
    setError('')
    dialogForm.reset()
    setBusy(true)
    const res = await saveUtilityDefaults(apartment.apartmentId, { [key]: patch })
    setBusy(false)
    if (!res.success) {
      if (fromDialog) dialogForm.fromResult(res)
      else setError(res.error)
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

      {/* ดันราคาของหอลงทุกห้อง — ทับราคาพิเศษรายห้อง */}
      <section className="panel utility-apply">
        <h3 className="panel-title">
          นำราคานี้ไปใช้กับห้องที่มีอยู่
          <InfoTip
            title="ใช้เมื่อไหร่"
            points={[
              'แก้ราคาที่หน้านี้ไม่ย้อนไปเปลี่ยนห้องเดิม',
              'ห้องที่สร้างก่อนตั้งราคาจะคิดเป็น 0 บาท'
            ]}
          />
        </h3>
        <p className="field-hint">
          ทับราคาของ<strong>ทุกห้อง</strong> รวมราคาพิเศษรายห้องด้วย
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
          form={dialogForm}
          onClose={() => {
            setEditing(null)
            dialogForm.reset()
          }}
          onSave={async (side) => {
            const ok = await persist(editing, side, { fromDialog: true })
            if (ok) setEditing(null)
          }}
        />
      )}
    </>
  )
}

function UtilityDialog({ meta, value, onClose, onSave, busy, form }) {
  const [side, setSide] = useState(value)
  const { errors } = form
  const set = (key, v) => {
    setSide((s) => ({ ...s, [key]: v }))
    form.clear(key)
  }

  return (
    <Modal
      title={meta.title}
      icon={meta.icon}
      busy={busy}
      error={form.formError}
      onClose={onClose}
      onSubmit={() => onSave(side)}
    >
      <div className={fieldClass('field field-required', errors.billingType)}>
        <label htmlFor="billingType">
          ประเภทการคิดเงิน <span className="required">* จำเป็น</span>
        </label>
        <select
          id="billingType"
          value={side.billingType}
          onChange={(e) => set('billingType', e.target.value)}
          autoFocus
          {...invalidProps('billingType', errors.billingType)}
        >
          {BILLING_TYPES.map((type) => (
            <option key={type} value={type}>
              {BILLING_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <FieldError id="billingType-error" message={errors.billingType} />
      </div>

      {(side.billingType === 'actual' || side.billingType === 'minimum') && (
        <div className={fieldClass('field field-required', errors.unitPrice)}>
          <label htmlFor="unitPrice">
            ราคาต่อหน่วย <span className="required">* จำเป็น</span>
          </label>
          <div className="input-with-suffix">
            <input
              id="unitPrice"
              value={side.unitPrice}
              onChange={(e) => set('unitPrice', e.target.value)}
              inputMode="decimal"
              {...invalidProps('unitPrice', errors.unitPrice)}
            />
            <span className="input-suffix">บาท / {meta.unitLabel}</span>
          </div>
          <FieldError id="unitPrice-error" message={errors.unitPrice} />
        </div>
      )}

      {side.billingType === 'minimum' && (
        <div className={fieldClass('field field-required', errors.minCharge)}>
          <label htmlFor="minCharge">
            ขั้นต่ำเรียกเก็บ <span className="required">* จำเป็น</span>
          </label>
          <div className="input-with-suffix">
            <input
              id="minCharge"
              value={side.minCharge}
              onChange={(e) => set('minCharge', e.target.value)}
              inputMode="decimal"
              {...invalidProps('minCharge', errors.minCharge)}
            />
            <span className="input-suffix">บาท</span>
          </div>
          {errors.minCharge ? (
            <FieldError id="minCharge-error" message={errors.minCharge} />
          ) : (
            <p className="field-hint">
              เป็นจำนวน<strong>เงิน</strong> ไม่ใช่จำนวนหน่วย
            </p>
          )}
        </div>
      )}

      {side.billingType === 'flat' && (
        <div className={fieldClass('field field-required', errors.flatRate)}>
          <label htmlFor="flatRate">
            เหมาจ่ายต่อเดือน <span className="required">* จำเป็น</span>
          </label>
          <div className="input-with-suffix">
            <input
              id="flatRate"
              value={side.flatRate}
              onChange={(e) => set('flatRate', e.target.value)}
              inputMode="decimal"
              {...invalidProps('flatRate', errors.flatRate)}
            />
            <span className="input-suffix">บาท / เดือน</span>
          </div>
          <FieldError id="flatRate-error" message={errors.flatRate} />
        </div>
      )}
    </Modal>
  )
}
