import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { showToast } from '../components/Toast.jsx'
import ApartmentFormPage from './ApartmentFormPage.jsx'
import { deleteApartment, listApartments } from '../services/apartmentService.js'

// หน้าหอพัก — โครงตามหน้า "จัดการอพาร์ตเมนต์" ของต้นแบบ: การ์ดหนึ่งใบต่อหนึ่งหอ
// บอกจำนวนห้องว่าง/ทั้งหมด แล้วมีทางเข้าไปจัดการต่อ
//
// ตัวเลข "บิลค้างชำระ" ของต้นแบบยังไม่ใส่ เพราะตาราง invoices ยังไม่มีข้อมูล (Phase 3)
// จงใจไม่โชว์ 0 ไปก่อน — เลข 0 ที่ไม่ได้มาจากการนับจริงทำให้เจ้าของหอเข้าใจผิดว่า
// "ไม่มีใครค้างเลย" ทั้งที่ระบบยังไม่ได้เริ่มออกบิล
export default function ApartmentsPage({ onOpen, onCreated, onSetup }) {
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
          onDone={(apartment) => {
            setView({ mode: 'list' })
            // ข้อความแจ้งผลลอยมุมจอเหมือนต้นแบบ — ต้องสั่งจากตรงนี้ ไม่ใช่ในฟอร์ม
            // เพราะฟอร์มถูกถอดออกจากจอทันทีหลังบันทึก (ดู components/Toast.jsx)
            showToast(view.mode === 'create' ? 'เพิ่มข้อมูลสำเร็จ' : 'แก้ไขข้อมูลสำเร็จ')
            // สร้างหอใหม่ = พาเข้าตัวช่วยตั้งค่าทันที (ตามต้นแบบ) ไม่ใช่ทิ้งไว้ที่รายการหอ
            // แล้วให้เจ้าของเดาเองว่าต้องไปตั้งอะไรต่อที่ไหน
            if (view.mode === 'create') onCreated?.(apartment)
            else load()
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
              onOpen={() => onOpen(a)}
              onSetup={() => onSetup?.(a)}
              onEdit={() => setView({ mode: 'edit', apartmentId: a.apartmentId })}
              onDelete={() => remove(a)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function ApartmentCard({ apartment, onOpen, onSetup, onEdit, onDelete }) {
  // หอที่ยังไม่มีห้องเลย = ยังตั้งค่าไม่เสร็จ ต้องเห็นทางกลับเข้าตัวช่วยตั้งค่า
  // ไม่ใช่ปล่อยให้กด "จัดการ" เข้าไปเจอหน้าเปล่าๆ แล้วงงว่าต้องทำอะไรต่อ
  const needsSetup = apartment.totalRooms === 0

  return (
    <article className={'apartment-card' + (needsSetup ? ' needs-setup' : '')}>
      <header>
        {apartment.nameTh}
        {needsSetup && <span className="tag tag-warn">ยังตั้งค่าไม่เสร็จ</span>}
      </header>

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
          {/* ทางเข้าหลักของการ์ด — กดแล้วเข้าไปทำงานในบริบทของหอนี้ (มีเมนูข้าง)
              ส่วน "แก้ไข" คือแก้ข้อมูลหอเอง ซึ่งเป็นคนละเรื่องกัน */}
          {needsSetup ? (
            <button type="button" className="btn btn-sm" onClick={onSetup}>
              ตั้งค่าต่อ
            </button>
          ) : (
            <button type="button" className="btn btn-sm" onClick={onOpen}>
              จัดการ
            </button>
          )}
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
