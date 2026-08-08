import React, { useEffect, useState } from 'react'
import Alert from './Alert.jsx'
import Modal from './Modal.jsx'
import { listPrinters, printDocument } from '../services/printService.js'

// กล่องเลือกเครื่องพิมพ์ของเราเอง แทนกล่องของ Windows
//
// Electron เปิดกล่องระบบได้ก็จริง แต่มันเป็นภาษาอังกฤษล้วนในแอปที่เป็นไทยทั้งตัว
// และขึ้นข้อความ "This app doesn't support print preview" ซึ่งอ่านแล้วเหมือนแอปพัง
// ทั้งที่ตัวอย่างเอกสารคือหน้าที่ผู้ใช้มองอยู่ตรงหน้าอยู่แล้ว
//
// ได้เพิ่มมาอีกอย่าง: บอกได้ว่า "ยังไม่ได้ต่อเครื่องพิมพ์จริง" ซึ่งกล่องของ Windows
// ไม่มีทางบอก — มันขึ้นเครื่องพิมพ์เสมือนปนมาโดยไม่แยกให้
export default function PrintDialog({ onClose, onPrinted }) {
  const [printers, setPrinters] = useState(null)
  const [deviceName, setDeviceName] = useState('')
  const [copies, setCopies] = useState('1')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const res = await listPrinters()
      if (!res.success) {
        setPrinters([])
        return setError(res.error)
      }
      setPrinters(res.data)
      // เลือกเครื่องที่ Windows ตั้งเป็นค่าเริ่มต้นให้ ถ้าไม่มีก็เอาตัวแรก
      const preferred = res.data.find((p) => p.isDefault) ?? res.data[0]
      if (preferred) setDeviceName(preferred.name)
    })()
  }, [])

  async function submit() {
    setError('')
    setBusy(true)
    const res = await printDocument({ deviceName, copies: Number(copies) })
    setBusy(false)
    if (!res.success) return setError(res.error)
    onPrinted()
  }

  const hasRealPrinter = (printers ?? []).some((p) => !p.isVirtual)

  return (
    <Modal
      title="พิมพ์เอกสาร"
      icon="printer"
      submitLabel="พิมพ์"
      busy={busy || !deviceName}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert>{error}</Alert>

      {printers === null ? (
        <p className="muted">กำลังค้นหาเครื่องพิมพ์...</p>
      ) : printers.length === 0 ? (
        <div className="empty-state">
          <p>ไม่พบเครื่องพิมพ์ในเครื่องนี้</p>
          <p className="muted">ต่อเครื่องพิมพ์แล้วติดตั้งไดรเวอร์ก่อน แล้วลองใหม่อีกครั้ง</p>
        </div>
      ) : (
        <>
          {/* เครื่องพิมพ์เสมือนที่ Windows แถมมาจะออกมาเป็นไฟล์ ไม่ใช่กระดาษ —
              ถ้าไม่มีตัวจริงเลย ต้องบอกตรงๆ ไม่งั้นผู้ใช้กดพิมพ์แล้วงงว่ากระดาษไม่ออก */}
          {!hasRealPrinter && (
            <Alert kind="warn">
              เครื่องนี้ยังไม่ได้ต่อเครื่องพิมพ์จริง — รายการข้างล่างเป็นเครื่องพิมพ์เสมือนของ Windows
              ที่ผลลัพธ์ออกมาเป็นไฟล์ ไม่ใช่กระดาษ ถ้าต้องการไฟล์ ใช้ปุ่ม “บันทึก PDF” จะตรงกว่า
            </Alert>
          )}

          <div className="field field-required">
            <label htmlFor="printerName">
              เครื่องพิมพ์ <span className="required">* จำเป็น</span>
            </label>
            <select
              id="printerName"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
            >
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName}
                  {p.isVirtual ? ' (เครื่องพิมพ์เสมือน)' : ''}
                  {p.isDefault ? ' — ค่าเริ่มต้น' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="printCopies">จำนวนชุด</label>
            <input
              id="printCopies"
              inputMode="numeric"
              value={copies}
              onChange={(e) => setCopies(e.target.value.replace(/\D/g, '').slice(0, 2))}
            />
            <p className="field-hint">
              กระดาษ A4 แนวตั้ง · เอกสารที่จะพิมพ์คือใบที่แสดงอยู่บนหน้าจอนี้
            </p>
          </div>
        </>
      )}
    </Modal>
  )
}
