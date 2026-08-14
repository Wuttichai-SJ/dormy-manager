import React, { useState } from 'react'
import Alert from '../components/Alert.jsx'
import { showToast } from '../components/Toast.jsx'
import ApartmentFormPage from './ApartmentFormPage.jsx'
import { deleteApartment } from '../services/apartmentService.js'

// ตั้งค่า > ข้อมูลหอพัก — ฟอร์มแก้ข้อมูลหอ ปิดท้ายด้วยโซนลบหอ
//
// ปุ่มลบอยู่ที่นี่ ไม่ได้อยู่บนการ์ดในหน้ารวมหอ (ตามต้นแบบ) — ซึ่งแปลว่าต้องเดินตัวช่วย
// ตั้งค่าให้ครบก่อนถึงจะเข้ามาลบได้ เพราะหน้าที่มีเมนูข้างถูกล็อกไว้จนกว่าจะตั้งค่าเสร็จ
// ยอมรับข้อจำกัดนี้โดยตั้งใจ: หอที่สร้างค้างไว้ให้กด "จัดการ" เพื่อเดินให้จบก่อน
export default function ApartmentInfoPage({ apartment, user, onDeleted }) {
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function remove() {
    setError('')
    setBusy(true)
    const res = await deleteApartment(apartment.apartmentId)
    setBusy(false)
    if (!res.success) return setError(res.error)
    showToast('ลบหอพักเรียบร้อยแล้ว')
    onDeleted()
  }

  return (
    <>
      <ApartmentFormPage
        apartmentId={apartment.apartmentId}
        onDone={() => showToast('แก้ไขข้อมูลสำเร็จ')}
      />

      {/* โซนลบหอไม่แสดงกับพนักงานเลย — คำสั่งนี้ลากผู้เช่า สัญญา บิล และใบเสร็จของทั้งหอ
          ไปด้วยในครั้งเดียว (main บังคับที่ apartment:delete อีกชั้น) */}
      {user?.isOwner && (
      <section className="form-section danger-zone">
        <div className="form-section-head">
          <h2>ลบหอพัก</h2>
          <p>ยกเลิกการใช้งานข้อมูลหอพักของคุณแบบถาวร</p>
        </div>

        <div className="form-section-body">
          <Alert>{error}</Alert>

          <p className="muted">
            หลังจากที่ลบหอพักแล้ว ข้อมูลที่เกี่ยวข้องจะไม่สามารถเข้าถึงได้อีก
            กรุณาตรวจสอบให้แน่ใจก่อนทำการลบ
          </p>

          {/* ยืนยันสองจังหวะในที่เดียว ไม่ใช้ window.confirm — กล่องของเบราว์เซอร์
              บล็อกทั้งหน้าต่าง Electron และหน้าตาไม่เข้ากับส่วนอื่นของแอป */}
          {confirming ? (
            <div className="danger-confirm">
              <strong>ลบ "{apartment.nameTh}" จริงหรือไม่?</strong>
              <div className="danger-confirm-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                  ยกเลิก
                </button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={remove}>
                  {busy ? 'กำลังลบ...' : 'ยืนยันลบหอพัก'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
              ลบหอพัก
            </button>
          )}
        </div>
      </section>
      )}
    </>
  )
}
