import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { showToast } from '../components/Toast.jsx'
import ApartmentFormPage from './ApartmentFormPage.jsx'
import { listApartments } from '../services/apartmentService.js'

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
              // หอที่ยังเดินตัวช่วยตั้งค่าไม่ครบ 8 ขั้น เข้าหน้าทำงานที่มีเมนูข้างไม่ได้
              // ต้องบอกด้วยว่าทำไมถึงเข้าไม่ได้ ไม่ใช่เด้งกลับเฉยๆ ให้เดาเอง
              onOpen={() => {
                if (a.isSetupComplete) return onOpen(a)
                showToast('ยังตั้งค่าตั้งต้นไม่สมบูรณ์', 'error')
                onSetup?.(a)
              }}
              onEdit={() => setView({ mode: 'edit', apartmentId: a.apartmentId })}
            />
          ))}
        </div>
      )}
    </>
  )
}

function ApartmentCard({ apartment, onOpen, onEdit }) {
  // "ตั้งค่าเสร็จ" ต้องมาจากการกด "เสร็จสิ้น" ที่ขั้นสุดท้ายของตัวช่วยตั้งค่าเท่านั้น
  //
  // เดิมเดาจาก "มีห้องแล้ว = เสร็จ" ซึ่งผิด — หอที่สร้างผังห้องเสร็จ (ขั้น 5) แต่ยังไม่ได้
  // ตั้งค่าเช่า/สถานะ/ค่าบริการ (ขั้น 6-8) ก็มีห้องเหมือนกัน แล้วหลุดเข้าหน้าทำงานที่มี
  // เมนูข้างไปทั้งที่ค่าเช่ายังเป็น 0 ทุกห้อง — ออกบิลไปได้ศูนย์บาททั้งหอ
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
          {/* ทางเข้าหลักของการ์ด — กดแล้วเข้าไปทำงานในบริบทของหอนี้ (มีเมนูข้าง)
              ส่วน "แก้ไข" คือแก้ข้อมูลหอเอง ซึ่งเป็นคนละเรื่องกัน */}
          {/* ปุ่มเดียวเสมอ ไม่ว่าตั้งค่าเสร็จหรือยัง — หอที่ยังไม่เสร็จกดแล้วจะถูกพากลับ
              เข้าตัวช่วยตั้งค่าพร้อมข้อความแจ้งเตือน (เหมือนต้นแบบ) ไม่ใช่ซ่อนปุ่มไว้ */}
          <button type="button" className="btn btn-sm" onClick={onOpen}>
            จัดการ
          </button>
          <button type="button" className="link-btn" onClick={onEdit}>
            แก้ไข
          </button>
          {/* ปุ่มลบไม่ได้อยู่ตรงนี้ — อยู่ในหอนั้นเอง ที่ ตั้งค่า > ข้อมูลหอพัก (ตามต้นแบบ)
              จึงต้องตั้งค่าให้เสร็จก่อนถึงจะลบได้ */}
        </div>
      </div>
    </article>
  )
}
