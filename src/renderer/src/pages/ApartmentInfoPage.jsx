import React, { useState } from 'react'
import Alert from '../components/Alert.jsx'
import { showToast } from '../components/Toast.jsx'
import ApartmentFormPage from './ApartmentFormPage.jsx'
import { deleteApartment } from '../services/apartmentService.js'

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

      {/* โซนลบหอไม่แสดงกับพนักงาน */}
      {user?.isOwner && (
      <section className="form-section danger-zone">
        <div className="form-section-head">
          <h2>ลบหอพัก</h2>
          <p>ยกเลิกการใช้งานข้อมูลหอพักของคุณแบบถาวร</p>
        </div>

        <div className="form-section-body">
          <Alert>{error}</Alert>

          <p className="muted">
            ลบแล้วเข้าถึงข้อมูลของหอนี้ไม่ได้อีก
          </p>

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
