import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import Modal from '../components/Modal.jsx'
import { showToast } from '../components/Toast.jsx'
import {
  createTenant,
  deleteTenant,
  listTenants,
  listTenantsByApartment,
  updateTenant
} from '../services/tenantService.js'

// หน้าผู้เช่าของหอหนึ่งหอ
//
// ค่าเริ่มต้นแสดง "เฉพาะผู้เช่าที่มีสัญญาในหอนี้" เพราะเจ้าของเปิดหน้านี้เพื่อดูคนที่อยู่
// ในหอตรงหน้า ไม่ใช่รายชื่อทุกคนที่เคยเช่าทั้ง 3 หอ
//
// แต่ผู้เช่าเป็นข้อมูลกลาง (ดู db/tenants.js) คนที่ย้ายมาจากหออื่นจึงมีระเบียนอยู่แล้ว
// ช่องค้นหาจึงมีสวิตช์ "ค้นทุกหอ" ไว้ให้ — จะได้ไม่เผลอสร้างคนเดิมซ้ำเป็นระเบียนที่สอง
const EMPTY = {
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

export default function TenantsPage({ apartment }) {
  const [tenants, setTenants] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [allApartments, setAllApartments] = useState(false)
  const [editing, setEditing] = useState(null) // { tenantId?, ...form }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    // ค้นหาข้ามหอเสมอเมื่อพิมพ์คำค้น — ประโยชน์ของช่องค้นหาคือหาคนที่ "ยังไม่อยู่ในรายการ"
    const res =
      allApartments || search.trim()
        ? await listTenants(search)
        : await listTenantsByApartment(apartment.apartmentId)

    if (!res.success) return setError(res.error)
    setError('')
    setTenants(res.data)
  }, [apartment.apartmentId, allApartments, search])

  useEffect(() => {
    load()
  }, [load])

  async function submit() {
    setError('')
    setBusy(true)
    const { tenantId, ...payload } = editing
    const res = tenantId ? await updateTenant(tenantId, payload) : await createTenant(payload)
    setBusy(false)
    if (!res.success) return setError(res.error)

    showToast(tenantId ? 'แก้ไขข้อมูลสำเร็จ' : 'เพิ่มข้อมูลสำเร็จ')
    setEditing(null)
    load()
  }

  async function remove(tenant) {
    setError('')
    const res = await deleteTenant(tenant.tenantId)
    if (!res.success) return setError(res.error)
    showToast('ลบผู้เช่าเรียบร้อยแล้ว')
    load()
  }

  return (
    <>
      <div className="page-actions tenants-toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาด้วยชื่อ เบอร์โทร หรือเลขบัตรประชาชน"
            aria-label="ค้นหาผู้เช่า"
          />
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={allApartments}
            onChange={(e) => setAllApartments(e.target.checked)}
          />
          <span>แสดงผู้เช่าจากทุกหอ</span>
        </label>

        <button type="button" className="btn" onClick={() => setEditing({ ...EMPTY })}>
          เพิ่มผู้เช่า
        </button>
      </div>

      <Alert>{error}</Alert>

      {tenants === null ? (
        <p className="muted">กำลังโหลด...</p>
      ) : tenants.length === 0 ? (
        <section className="panel empty-state">
          <Icon name="tenants" />
          <h2>{search.trim() ? 'ไม่พบผู้เช่าที่ค้นหา' : 'ยังไม่มีผู้เช่าในหอพักนี้'}</h2>
          <p className="muted">
            {search.trim()
              ? 'ลองค้นด้วยเบอร์โทรหรือเลขบัตรประชาชนแทน หรือเพิ่มเป็นผู้เช่ารายใหม่'
              : 'ผู้เช่าจะขึ้นที่นี่เมื่อมีสัญญาเช่าผูกกับห้องในหอนี้ — เพิ่มรายชื่อไว้ก่อนทำสัญญาได้'}
          </p>
          <button type="button" className="btn" onClick={() => setEditing({ ...EMPTY })}>
            เพิ่มผู้เช่า
          </button>
        </section>
      ) : (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>ชื่อ - นามสกุล</th>
                <th>เบอร์โทรศัพท์</th>
                <th>เลขบัตรประชาชน</th>
                <th>สถานะ</th>
                <th className="align-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.tenantId}>
                  <td>{t.fullName}</td>
                  <td>{formatPhone(t.phone)}</td>
                  <td>{t.idCardNo ? formatIdCard(t.idCardNo) : <span className="muted">—</span>}</td>
                  <td>
                    {t.activeContracts > 0 ? (
                      <span className="room-badge status-occupied">กำลังเช่า</span>
                    ) : (
                      <span className="muted">ไม่มีสัญญา</span>
                    )}
                  </td>
                  <td className="align-right">
                    <button type="button" className="link-btn" onClick={() => setEditing({ ...t })}>
                      แก้ไข
                    </button>
                    {/* ลบได้เฉพาะคนที่ไม่เคยมีสัญญา — ฝั่ง main กันอีกชั้นพร้อมเหตุผล */}
                    {t.activeContracts === 0 && (
                      <button
                        type="button"
                        className="link-btn link-danger table-action icon-only"
                        onClick={() => remove(t)}
                        aria-label={`ลบผู้เช่า ${t.fullName}`}
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {editing && (
        <TenantDialog
          value={editing}
          busy={busy}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSubmit={submit}
        />
      )}
    </>
  )
}

function TenantDialog({ value, onChange, onClose, onSubmit, busy }) {
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
          {/* บอกให้ชัดว่าเว้นได้ ไม่งั้นเจ้าหน้าที่จะกรอกเลขมั่วเพื่อให้ผ่าน */}
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

// แสดงผลให้อ่านง่ายเท่านั้น — ในฐานข้อมูลเก็บเป็นตัวเลขล้วนเสมอ (ดู db/tenants.js)
function formatPhone(digits) {
  if (digits?.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  return digits
}

function formatIdCard(digits) {
  if (digits?.length !== 13) return digits
  return `${digits[0]}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits[12]}`
}
