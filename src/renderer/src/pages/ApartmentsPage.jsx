import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import ApartmentFormPage from './ApartmentFormPage.jsx'
import { deleteApartment, listApartments } from '../services/apartmentService.js'

// หน้าหอพัก — โครงตามหน้า "จัดการอพาร์ตเมนต์" ของต้นแบบ: การ์ดหนึ่งใบต่อหนึ่งหอ
// บอกจำนวนห้องว่าง/ทั้งหมด แล้วมีทางเข้าไปจัดการต่อ
//
// ตัวเลข "บิลค้างชำระ" ของต้นแบบยังไม่ใส่ เพราะตาราง invoices ยังไม่มีข้อมูล (Phase 3)
// จงใจไม่โชว์ 0 ไปก่อน — เลข 0 ที่ไม่ได้มาจากการนับจริงทำให้เจ้าของหอเข้าใจผิดว่า
// "ไม่มีใครค้างเลย" ทั้งที่ระบบยังไม่ได้เริ่มออกบิล
export default function ApartmentsPage() {
  const [apartments, setApartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState({ mode: 'list' }) // list | create | edit

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listApartments()
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setApartments(res.data)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function remove(apartment) {
    setError('')
    const res = await deleteApartment(apartment.apartmentId)
    if (!res.success) return setError(res.error)
    load()
  }

  if (view.mode === 'create' || view.mode === 'edit') {
    return (
      <>
        <button type="button" className="link-btn link-back-inline" onClick={() => setView({ mode: 'list' })}>
          <Icon name="back" />
          <span>กลับไปรายการหอพัก</span>
        </button>
        <ApartmentFormPage
          apartmentId={view.apartmentId}
          onCancel={() => setView({ mode: 'list' })}
          onDone={() => {
            setView({ mode: 'list' })
            load()
          }}
        />
      </>
    )
  }

  return (
    <>
      <div className="page-actions">
        <button type="button" className="btn" onClick={() => setView({ mode: 'create' })}>
          เพิ่มหอพัก
        </button>
      </div>

      <Alert>{error}</Alert>

      {loading ? (
        <p className="muted">กำลังโหลด...</p>
      ) : apartments.length === 0 ? (
        <section className="panel empty-state">
          <Icon name="apartments" />
          <h2>ยังไม่มีหอพักในระบบ</h2>
          <p className="muted">
            เริ่มต้นด้วยการเพิ่มหอพักแห่งแรก จากนั้นจึงตั้งค่าชั้น ห้องพัก และค่าบริการ
          </p>
          <button type="button" className="btn" onClick={() => setView({ mode: 'create' })}>
            เพิ่มหอพัก
          </button>
        </section>
      ) : (
        <div className="card-grid">
          {apartments.map((a) => (
            <ApartmentCard
              key={a.apartmentId}
              apartment={a}
              onEdit={() => setView({ mode: 'edit', apartmentId: a.apartmentId })}
              onDelete={() => remove(a)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function ApartmentCard({ apartment, onEdit, onDelete }) {
  return (
    <article className="apartment-card">
      <header>{apartment.nameTh}</header>

      <div className="apartment-card-body">
        <span className="apartment-card-icon">
          <Icon name="apartments" />
        </span>

        <div className="stat">
          <div className="stat-value">
            {apartment.vacantRooms} <span className="stat-total">/ {apartment.totalRooms}</span>
          </div>
          <div className="stat-label">ห้องว่าง / ทั้งหมด</div>
        </div>

        <div className="apartment-card-actions">
          <button type="button" className="link-btn" onClick={onEdit}>
            แก้ไข
          </button>
          {/* ลบได้เฉพาะหอที่ยังไม่มีชั้น/ห้อง — ฝั่ง main เป็นคนกันและส่งข้อความอธิบายกลับมา */}
          {apartment.totalRooms === 0 && (
            <button type="button" className="link-btn link-danger" onClick={onDelete}>
              ลบ
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
