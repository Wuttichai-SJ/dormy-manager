import React, { useState } from 'react'
import Modal from './Modal.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from './FieldError.jsx'
import { formatIdCardInput, formatPhoneInput } from '../inputMasks.js'
import { createTenant, updateTenant } from '../services/tenantService.js'

export const EMPTY_TENANT = {
  firstName: '',
  lastName: '',
  phone: '',
  idCardNo: '',
  address: '',
  emergencyContactName: '',
  emergencyRelation: '',
  emergencyPhone: '',
  note: ''
}

const TENANT_FIELDS = ['firstName', 'lastName', 'phone', 'idCardNo', 'address']

// ฟิลด์ที่มี mask — ค่าจากฐานข้อมูลเป็นตัวเลขล้วน
const MASKS = {
  phone: formatPhoneInput,
  idCardNo: formatIdCardInput,
  emergencyPhone: formatPhoneInput
}

export default function TenantDialog({ tenant, onClose, onSaved }) {
  const editing = Boolean(tenant?.tenantId)
  const [form, setForm] = useState(() => {
    const initial = { ...EMPTY_TENANT }
    for (const key of Object.keys(EMPTY_TENANT)) {
      const value = tenant?.[key] ?? ''
      initial[key] = MASKS[key] ? MASKS[key](value) : value
    }
    return initial
  })
  const [busy, setBusy] = useState(false)
  const { errors, formError, fromResult, clear, reset } = useFormErrors(TENANT_FIELDS)

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: MASKS[key] ? MASKS[key](value) : value }))
    clear(key)
  }

  async function submit() {
    reset()
    setBusy(true)
    const res = editing ? await updateTenant(tenant.tenantId, form) : await createTenant(form)
    setBusy(false)
    if (!res.success) return fromResult(res)
    onSaved(res.data)
  }

  return (
    <Modal
      title={editing ? `แก้ไขข้อมูล ${tenant.fullName}` : 'เพิ่มผู้เช่า'}
      icon="account"
      busy={busy}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="field-row">
        <RequiredField id="firstName" label="ชื่อ" error={errors.firstName}>
          <input
            id="firstName"
            value={form.firstName}
            onChange={(e) => set('firstName', e.target.value)}
            autoFocus
            {...invalidProps('firstName', errors.firstName)}
          />
        </RequiredField>
        <RequiredField id="lastName" label="นามสกุล" error={errors.lastName}>
          <input
            id="lastName"
            value={form.lastName}
            onChange={(e) => set('lastName', e.target.value)}
            {...invalidProps('lastName', errors.lastName)}
          />
        </RequiredField>
      </div>

      <div className="field-row">
        <RequiredField id="phone" label="เบอร์โทรศัพท์" error={errors.phone}>
          <input
            id="phone"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            inputMode="tel"
            {...invalidProps('phone', errors.phone)}
          />
        </RequiredField>
        <RequiredField id="idCardNo" label="เลขบัตรประชาชน" error={errors.idCardNo}>
          <input
            id="idCardNo"
            value={form.idCardNo}
            onChange={(e) => set('idCardNo', e.target.value)}
            inputMode="numeric"
            {...invalidProps('idCardNo', errors.idCardNo)}
          />
        </RequiredField>
      </div>

      <RequiredField id="address" label="ที่อยู่ตามทะเบียนบ้าน" error={errors.address}>
        <input
          id="address"
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
          {...invalidProps('address', errors.address)}
        />
      </RequiredField>

      <hr className="divider" />

      <p className="field-hint">ผู้ติดต่อฉุกเฉิน — ใช้ตอนติดต่อผู้เช่าไม่ได้</p>

      <div className="field-row">
        <div className="field">
          <label htmlFor="emergencyContactName">ชื่อผู้ติดต่อ</label>
          <input
            id="emergencyContactName"
            value={form.emergencyContactName}
            onChange={(e) => set('emergencyContactName', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="emergencyRelation">ความสัมพันธ์</label>
          <input
            id="emergencyRelation"
            value={form.emergencyRelation}
            onChange={(e) => set('emergencyRelation', e.target.value)}
            placeholder="เช่น บิดา มารดา"
          />
        </div>
        <div className="field">
          <label htmlFor="emergencyPhone">เบอร์โทรศัพท์</label>
          <input
            id="emergencyPhone"
            value={form.emergencyPhone}
            onChange={(e) => set('emergencyPhone', e.target.value)}
            inputMode="tel"
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="note">หมายเหตุ</label>
        <input id="note" value={form.note} onChange={(e) => set('note', e.target.value)} />
      </div>
    </Modal>
  )
}

function RequiredField({ id, label, error, children }) {
  return (
    <div className={fieldClass('field field-required', error)}>
      <label htmlFor={id}>
        {label} <span className="required">* จำเป็น</span>
      </label>
      {children}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

// สำเนาของ main/db/tenants.js — แก้คู่กัน
export function thaiIdCardError(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return 'กรุณากรอกเลขบัตรประชาชน'
  if (digits.length !== 13) return 'เลขบัตรประชาชนต้องมี 13 หลัก'
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(digits[12]) ? null : 'เลขบัตรประชาชนไม่ถูกต้อง'
}

// แสดงผลเท่านั้น — ฐานข้อมูลเก็บตัวเลขล้วน · เบอร์เก่าที่ยาวเกินแสดงตามเดิม
export function formatPhone(digits) {
  if (digits?.length === 9 || digits?.length === 10) return formatPhoneInput(digits)
  return digits
}
