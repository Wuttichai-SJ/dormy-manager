import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { showToast } from '../components/Toast.jsx'
import ApartmentFormPage from './ApartmentFormPage.jsx'
import { listApartments } from '../services/apartmentService.js'

export default function ApartmentsPage({ user, onOpen, onCreated, onSetup }) {
  const [apartments, setApartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState({ mode: 'list' }) /* list | create | edit */

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
            // ต้องสั่ง toast จากที่นี่ — ฟอร์มถูกถอดทันทีหลังบันทึก
            showToast(view.mode === 'create' ? 'เพิ่มข้อมูลสำเร็จ' : 'แก้ไขข้อมูลสำเร็จ')
            if (view.mode === 'create') onCreated?.(apartment)
            else load()
          }}
        />
      </>
    )
  }

  return (
    <>
      {user?.isOwner && (
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setView({ mode: 'create' })}>
            เพิ่มหอพัก
          </button>
        </div>
      )}

      <Alert>{error}</Alert>

      {loading ? (
        <p className="muted">กำลังโหลด...</p>
      ) : apartments.length === 0 ? (
        <section className="panel empty-state">
          <Icon name="apartments" />
          <h2>ยังไม่มีหอพักในระบบ</h2>
          {user?.isOwner ? (
            <>
              <p className="muted">
                เพิ่มหอพักแห่งแรกเพื่อเริ่มต้น
              </p>
              <button type="button" className="btn" onClick={() => setView({ mode: 'create' })}>
                เพิ่มหอพัก
              </button>
            </>
          ) : (
            <p className="muted">รอเจ้าของหอเพิ่มหอพักก่อน</p>
          )}
        </section>
      ) : (
        <div className="card-grid">
          {apartments.map((a) => (
            <ApartmentCard
              key={a.apartmentId}
              apartment={a}
              onOpen={() => {
                if (a.isSetupComplete) return onOpen(a)
                showToast('ยังตั้งค่าตั้งต้นไม่สมบูรณ์', 'error')
                onSetup?.(a)
              }}
              // null = ไม่มีปุ่มแก้ไข (พนักงาน)
              onEdit={
                user?.isOwner
                  ? () => setView({ mode: 'edit', apartmentId: a.apartmentId })
                  : null
              }
            />
          ))}
        </div>
      )}
    </>
  )
}

function ApartmentCard({ apartment, onOpen, onEdit }) {
  // ตั้งค่าเสร็จ = มี setupCompletedAt เท่านั้น (ไม่ใช่แค่มีห้อง)
  const needsSetup = !apartment.isSetupComplete

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
          <button type="button" className="btn btn-sm" onClick={onOpen}>
            จัดการ
          </button>
          {onEdit && (
            <button type="button" className="link-btn" onClick={onEdit}>
              แก้ไข
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
