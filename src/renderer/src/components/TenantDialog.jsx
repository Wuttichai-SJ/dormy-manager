import React from 'react'
import Modal from './Modal.jsx'

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

export default function TenantDialog({ value, onChange, onClose, onSubmit, busy }) {
  const set = (key, v) => onChange({ ...value, [key]: v })

  return (
    <Modal
      title={value.tenantId ? 'แก้ไขข้อมูลผู้เช่า' : 'เพิ่มผู้เช่า'}
      busy={busy}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <div className="field-row">
        <div className="field field-required">
          <label htmlFor="firstName">
            ชื่อ <span className="required">* จำเป็น</span>
          </label>
          <input
            id="firstName"
            value={value.firstName}
            onChange={(e) => set('firstName', e.target.value)}
            autoFocus
          />
        </div>
        <div className="field field-required">
          <label htmlFor="lastName">
            นามสกุล <span className="required">* จำเป็น</span>
          </label>
          <input
            id="lastName"
            value={value.lastName}
            onChange={(e) => set('lastName', e.target.value)}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field field-required">
          <label htmlFor="phone">
            เบอร์โทรศัพท์ <span className="required">* จำเป็น</span>
          </label>
          <input
            id="phone"
            value={value.phone}
            onChange={(e) => set('phone', e.target.value)}
            inputMode="tel"
          />
        </div>
        <div className="field">
          <label htmlFor="idCardNo">เลขบัตรประชาชน</label>
          <input
            id="idCardNo"
            value={value.idCardNo ?? ''}
            onChange={(e) => set('idCardNo', e.target.value)}
            inputMode="numeric"
          />
          <p className="field-hint">เว้นว่างได้ ถ้ายังไม่ได้เอกสาร — เติมทีหลังได้</p>
        </div>
      </div>

      <div className="field">
        <label htmlFor="address">ที่อยู่ตามทะเบียนบ้าน</label>
        <input
          id="address"
          value={value.address ?? ''}
          onChange={(e) => set('address', e.target.value)}
        />
      </div>

      <hr className="divider" />

      <p className="field-hint">ผู้ติดต่อฉุกเฉิน — ใช้ตอนติดต่อผู้เช่าไม่ได้</p>

      <div className="field-row">
        <div className="field">
          <label htmlFor="emergencyContactName">ชื่อผู้ติดต่อ</label>
          <input
            id="emergencyContactName"
            value={value.emergencyContactName ?? ''}
            onChange={(e) => set('emergencyContactName', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="emergencyRelation">ความสัมพันธ์</label>
          <input
            id="emergencyRelation"
            value={value.emergencyRelation ?? ''}
            onChange={(e) => set('emergencyRelation', e.target.value)}
            placeholder="เช่น บิดา มารดา"
          />
        </div>
        <div className="field">
          <label htmlFor="emergencyPhone">เบอร์โทรศัพท์</label>
          <input
            id="emergencyPhone"
            value={value.emergencyPhone ?? ''}
            onChange={(e) => set('emergencyPhone', e.target.value)}
            inputMode="tel"
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="note">หมายเหตุ</label>
        <input id="note" value={value.note ?? ''} onChange={(e) => set('note', e.target.value)} />
      </div>
    </Modal>
  )
}

// แสดงผลเท่านั้น — ฐานข้อมูลเก็บตัวเลขล้วน
export function formatPhone(digits) {
  if (digits?.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  return digits
}

export function formatIdCard(digits) {
  if (digits?.length !== 13) return digits
  return `${digits[0]}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits[12]}`
}
