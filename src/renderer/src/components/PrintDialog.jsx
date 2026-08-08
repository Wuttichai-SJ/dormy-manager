import React, { useEffect, useState } from 'react'
import Alert from './Alert.jsx'
import Modal from './Modal.jsx'
import { listPrinters, previewDocument, printDocument } from '../services/printService.js'

// กล่องพิมพ์เอกสาร — ตัวอย่างหน้ากระดาษจริงอยู่ตรงกลาง เลือกเครื่องพิมพ์อยู่ข้างล่าง
//
// ต้นแบบทำแบบนี้: กด "พิมพ์" แล้วเห็นเอกสารเป็นหน้ากระดาษก่อน ต่อให้ยังไม่ได้ต่อเครื่องพิมพ์
// ก็ยังตรวจได้ว่าหน้าตาถูกไหม ตกขอบไหม กี่หน้า
//
// ตัวอย่างที่เห็นมาจาก printToPDF ตัวเดียวกับที่ปุ่ม "บันทึก PDF" ใช้ และเป็นตัวเดียวกับ
// ที่เครื่องพิมพ์จะได้ จึงไม่ใช่ "ของที่คล้ายกัน" แต่เป็นของชิ้นเดียวกัน
export default function PrintDialog({ onClose, onPrinted, title = 'พิมพ์ใบแจ้งหนี้', maxPages = 1 }) {
  const [pdfUrl, setPdfUrl] = useState('')
  // สัดส่วนที่ฝั่ง main ใช้ย่อเอกสารให้ลงหน้าเดียว — 1 = ไม่ได้ย่อ
  const [scale, setScale] = useState(1)
  const [printers, setPrinters] = useState(null)
  const [deviceName, setDeviceName] = useState('')
  const [copies, setCopies] = useState('1')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // สร้างตัวอย่างเป็น blob แล้วให้ <iframe> ชี้มาที่ blob นั้น
  // ใช้ blob ไม่ใช่ data: URL เพราะไฟล์ PDF ยาวเป็นแสนตัวอักษรเมื่อเข้ารหัส base64
  // ยัดลง URL ตรงๆ แล้วช้าและติดเพดานความยาวของ URL
  useEffect(() => {
    let url = ''
    ;(async () => {
      const res = await previewDocument(maxPages)
      if (!res.success) return setError(res.error)

      const bytes = Uint8Array.from(atob(res.data.base64), (c) => c.charCodeAt(0))
      url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      setPdfUrl(url)
      setScale(res.data.scale ?? 1)
    })()

    // คืนหน่วยความจำของ blob เมื่อปิดกล่อง ไม่งั้นไฟล์ค้างอยู่จนกว่าจะปิดแอป
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      const res = await listPrinters()
      if (!res.success) {
        setPrinters([])
        return setError(res.error)
      }
      setPrinters(res.data)
      const preferred = res.data.find((p) => p.isDefault) ?? res.data[0]
      if (preferred) setDeviceName(preferred.name)
    })()
  }, [])

  async function submit() {
    setError('')
    setBusy(true)
    const res = await printDocument({ deviceName, copies: Number(copies), maxPages })
    setBusy(false)
    if (!res.success) return setError(res.error)
    onPrinted()
  }

  const hasRealPrinter = (printers ?? []).some((p) => !p.isVirtual)
  const noPrinter = printers !== null && printers.length === 0

  return (
    <Modal
      title={title}
      icon="printer"
      submitLabel="พิมพ์"
      wide
      busy={busy || !deviceName}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert>{error}</Alert>

      <div className="print-preview">
        {/* ข้อความอยู่ "ใต้" iframe เสมอ ไม่ได้สลับกัน — ถ้าตัวอ่าน PDF แสดงผลไม่ได้
            (เช่นถูก CSP บล็อก หรือ plugins ปิดอยู่) ผู้ใช้จะยังเห็นข้อความค้างแทนกล่องเทา
            เปล่าๆ ที่ไม่บอกอะไรเลย — เคยเจอมาแล้วตอน frame-src ยังไม่อนุญาต blob: */}
        <p className="muted print-preview-status">
          {pdfUrl ? 'ไม่สามารถแสดงตัวอย่างได้ — ใช้ปุ่ม “บันทึก PDF” เพื่อดูไฟล์แทน' : 'กำลังเตรียมตัวอย่างเอกสาร...'}
        </p>
        {pdfUrl && (
          // ตัวอ่าน PDF ของ Chromium มาพร้อมแถบเครื่องมือของมันเอง (ย่อ/ขยาย เลื่อนหน้า
          // ดาวน์โหลด) จึงไม่ต้องทำปุ่มพวกนั้นเองซ้ำ
          <iframe src={pdfUrl} title="ตัวอย่างเอกสารก่อนพิมพ์" />
        )}
      </div>

      {/* บอกตรงๆ ว่าเอกสารถูกย่อ ไม่ให้ผู้ใช้เจอกระดาษที่ตัวอักษรเล็กกว่าที่คาดโดยไม่รู้สาเหตุ */}
      {scale < 1 && (
        <p className="field-hint print-scale-note">
          เนื้อหายาวเกินหน้ากระดาษ ระบบย่อเอกสารเหลือ {Math.round(scale * 100)}%
          เพื่อให้อยู่ครบใน {maxPages === 1 ? 'แผ่นเดียว' : `${maxPages} แผ่น`}
        </p>
      )}

      {noPrinter ? (
        <Alert kind="warn">
          ไม่พบเครื่องพิมพ์ในเครื่องนี้ — ต่อเครื่องพิมพ์แล้วติดตั้งไดรเวอร์ก่อน
          หรือใช้ปุ่ม “บันทึก PDF” เพื่อเก็บไฟล์ไว้ส่งต่อ
        </Alert>
      ) : (
        <>
          {/* เครื่องพิมพ์เสมือนที่ Windows แถมมาจะออกมาเป็นไฟล์ ไม่ใช่กระดาษ
              ถ้าไม่มีตัวจริงเลย ต้องบอกตรงๆ ไม่งั้นกดพิมพ์แล้วงงว่ากระดาษไม่ออก */}
          {printers !== null && !hasRealPrinter && (
            <Alert kind="warn">
              เครื่องนี้ยังไม่ได้ต่อเครื่องพิมพ์จริง — รายการข้างล่างเป็นเครื่องพิมพ์เสมือนของ Windows
              ที่ผลลัพธ์ออกมาเป็นไฟล์ ไม่ใช่กระดาษ
            </Alert>
          )}

          <div className="print-options">
            <div className="field field-required">
              <label htmlFor="printerName">
                เครื่องพิมพ์ <span className="required">* จำเป็น</span>
              </label>
              <select
                id="printerName"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                disabled={printers === null}
              >
                {(printers ?? []).map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName}
                    {p.isVirtual ? ' (เครื่องพิมพ์เสมือน)' : ''}
                    {p.isDefault ? ' — ค่าเริ่มต้น' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="field print-copies">
              <label htmlFor="printCopies">จำนวนชุด</label>
              <input
                id="printCopies"
                inputMode="numeric"
                value={copies}
                onChange={(e) => setCopies(e.target.value.replace(/\D/g, '').slice(0, 2))}
              />
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
