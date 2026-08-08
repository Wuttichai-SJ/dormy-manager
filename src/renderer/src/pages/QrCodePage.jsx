import React, { useCallback, useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
import { showToast } from '../components/Toast.jsx'
import { getQrImage, removeQrImage, uploadQrImage } from '../services/imageService.js'

// ตั้งค่า → QR Code รับเงิน
//
// **ผู้ใช้อัปโหลดรูป QR ที่ธนาคารสร้างให้ ระบบไม่ได้สร้าง QR เอง** (ตัดสินใจตั้งแต่วางขอบเขต)
// การสร้าง QR พร้อมเพย์ให้ถูกต้องต้องเข้ารหัสตามมาตรฐาน EMVCo + CRC ซึ่งต้องพึ่งไลบรารี
// เพิ่มอีกตัว ขัดกับนโยบาย dependency ขั้นต่ำ — และธนาคารทุกแห่งสร้างรูปให้ดาวน์โหลดอยู่แล้ว
//
// รูปเก็บเป็น BLOB ในตาราง images (ดู migration 011) จึงติดไปกับไฟล์สำรองข้อมูลด้วย
// ไม่ใช่ path ที่ชี้ไปไฟล์นอกฐานข้อมูลซึ่งจะหายไปเวลาย้ายเครื่อง
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
      <div className="info-banner">
        <strong>QR Code รับเงิน</strong>
        <p>
          อัปโหลดรูป QR พร้อมเพย์ที่ธนาคารสร้างให้ · รูปนี้จะไปแสดงบนใบแจ้งหนี้ ผู้เช่าที่ได้รับ
          ไฟล์ทางแชตจะสแกนจ่ายได้เลยโดยไม่ต้องพิมพ์เลขบัญชี
        </p>
      </div>

      <section className="panel">
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
              รองรับ png, jpg, webp, gif · ไม่เกิน 3 MB · แนะนำรูปสี่เหลี่ยมจัตุรัสที่คมพอให้
              สแกนจากหน้าจอมือถือได้
            </p>
          </div>
        )}
      </section>
    </>
  )
}
