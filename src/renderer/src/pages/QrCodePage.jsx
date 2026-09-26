import React, { useCallback, useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
import InfoTip from '../components/InfoTip.jsx'
import { showToast } from '../components/Toast.jsx'
import { getQrImage, removeQrImage, uploadQrImage } from '../services/imageService.js'

// อัปโหลดรูป QR จากธนาคาร — ระบบไม่สร้าง QR เอง
export default function QrCodePage({ apartment }) {
  const [dataUrl, setDataUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getQrImage(apartment.apartmentId)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setDataUrl(res.data.dataUrl)
  }, [apartment.apartmentId])

  useEffect(() => {
    load()
  }, [load])

  async function upload() {
    setError('')
    setBusy(true)
    const res = await uploadQrImage(apartment.apartmentId)
    setBusy(false)
    if (!res.success) return setError(res.error)
    if (res.data.cancelled) return

    setDataUrl(res.data.dataUrl)
    showToast('อัปโหลด QR Code แล้ว')
  }

  async function remove() {
    setError('')
    setBusy(true)
    const res = await removeQrImage(apartment.apartmentId)
    setBusy(false)
    if (!res.success) return setError(res.error)
    setDataUrl(null)
    showToast('ลบ QR Code แล้ว')
  }

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">
          QR Code รับเงิน
          <InfoTip
            title="QR Code รับเงิน"
            points={['ใช้รูป QR พร้อมเพย์ที่ธนาคารสร้างให้', 'แสดงบนใบแจ้งหนี้ ผู้เช่าสแกนจ่ายได้เลย']}
          />
        </h2>
        <Alert>{error}</Alert>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : (
          <div className="qr-box">
            {dataUrl ? (
              <img className="qr-preview" src={dataUrl} alt="QR Code รับเงินของหอพัก" />
            ) : (
              <div className="qr-empty">
                <p>ยังไม่มี QR Code</p>
                <p className="muted">ใบแจ้งหนี้จะยังไม่มี QR ให้ผู้เช่าสแกน</p>
              </div>
            )}

            <div className="qr-actions">
              <button type="button" className="btn" onClick={upload} disabled={busy}>
                {dataUrl ? 'เปลี่ยนรูป' : 'เลือกไฟล์'}
              </button>
              {dataUrl && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={remove}
                  disabled={busy}
                >
                  ลบรูป
                </button>
              )}
            </div>

            <p className="field-hint">
              png, jpg, webp, gif · ไม่เกิน 3 MB · รูปสี่เหลี่ยมจัตุรัส
            </p>
          </div>
        )}
      </section>
    </>
  )
}
