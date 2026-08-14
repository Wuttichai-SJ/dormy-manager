import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import Modal from '../components/Modal.jsx'
import { showToast } from '../components/Toast.jsx'
import {
  createBackup,
  deleteBackup,
  listBackups,
  restoreBackup,
  revealBackupFolder
} from '../services/backupService.js'

// ตั้งค่า > สำรองข้อมูล
//
// ข้อมูลทั้งระบบอยู่ในไฟล์เดียว ไม่มีเซิร์ฟเวอร์ให้ดึงกลับ (offline-first) การสำรองจึงเป็น
// ตาข่ายนิรภัยชั้นเดียวที่มี — หน้านี้ต้องอธิบายให้ชัดว่า "สำรองไว้ในเครื่องเดียวกันยังไม่พอ"
// เพราะดิสก์พังทีเดียวหายทั้งต้นฉบับและสำเนา
export default function BackupsPage({ user }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [labelling, setLabelling] = useState(null)

  const load = useCallback(async () => {
    const res = await listBackups()
    if (!res.success) return setError(res.error)
    setError('')
    setState(res.data)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function make(label) {
    setError('')
    setBusy(true)
    const res = await createBackup(label)
    setBusy(false)
    if (!res.success) return setError(res.error)
    showToast('สำรองข้อมูลเรียบร้อยแล้ว')
    setLabelling(null)
    load()
  }

  async function restore(backup) {
    setError('')
    // คำเตือนและการยืนยันเป็นกล่องของระบบที่ฝั่ง main เพราะกดตกลงแล้วหน้านี้จะถูก reload ทิ้ง
    const res = await restoreBackup(backup.fileName)
    if (!res.success) return setError(res.error)
    // สำเร็จ = ฝั่ง main สั่ง reload หน้าจอแล้ว และล้างเซสชันไว้ จะเด้งไปหน้าเข้าสู่ระบบเอง
    // ไม่ต้องทำอะไรต่อ (จะโชว์ toast ก็ไม่ทัน เพราะหน้าถูกโหลดใหม่)
  }

  async function remove(backup) {
    setError('')
    const res = await deleteBackup(backup.fileName)
    if (!res.success) return setError(res.error)
    showToast('ลบไฟล์สำรองแล้ว')
    load()
  }

  return (
    <>
      <div className="info-banner">
        <strong>สำรองข้อมูล</strong>
        <p>
          ข้อมูลหอพักทั้งหมดอยู่ในไฟล์เดียวในเครื่องนี้ ไม่มีสำเนาบนอินเทอร์เน็ต
          ควรสำรองก่อนทำอะไรที่ย้อนกลับไม่ได้ และคัดลอกไฟล์สำรองออกไปเก็บที่อื่นเสมอ
        </p>
      </div>

      <section className="form-section">
        <div className="form-section-head">
          <h2>สร้างไฟล์สำรอง</h2>
          <p>คัดลอกข้อมูล ณ ตอนนี้เก็บไว้เป็นไฟล์แยก ใช้เวลาไม่กี่วินาที</p>
        </div>

        <div className="form-section-body">
          <Alert>{error}</Alert>

          {/* เตือนเรื่องดิสก์เดียวกันให้ชัด เพราะเป็นความเข้าใจผิดที่ทำให้สำรองแล้วยังหายอยู่ดี */}
          <div className="backup-warning">
            <Icon name="warning" />
            <p>
              ไฟล์สำรองถูกเก็บไว้ในเครื่องเดียวกับข้อมูลจริง — <strong>ถ้าดิสก์พังจะหายไปพร้อมกัน</strong>{' '}
              กด "เปิดโฟลเดอร์สำรอง" แล้วคัดลอกไฟล์ออกไปไว้ USB หรือไดรฟ์อื่นด้วย
            </p>
          </div>

          <div className="backup-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => setLabelling('')}>
              {busy ? 'กำลังสำรอง...' : 'สำรองข้อมูลตอนนี้'}
            </button>
            <button type="button" className="btn-outline" onClick={() => revealBackupFolder()}>
              เปิดโฟลเดอร์สำรอง
            </button>
          </div>

          {state?.directory && <p className="field-hint backup-path">{state.directory}</p>}
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-head">
          <h2>ไฟล์สำรองที่มี</h2>
          <p>เรียงจากใหม่ไปเก่า — กู้คืนแล้วข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด</p>
        </div>

        <div className="form-section-body">
          {state === null ? (
            <p className="muted">กำลังโหลด...</p>
          ) : state.backups.length === 0 ? (
            <p className="muted">ยังไม่มีไฟล์สำรอง — กด "สำรองข้อมูลตอนนี้" เพื่อสร้างไฟล์แรก</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>วันที่สำรอง</th>
                  <th>บันทึกช่วยจำ</th>
                  <th className="align-right">ขนาด</th>
                  <th className="align-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {state.backups.map((b) => (
                  <tr key={b.fileName}>
                    <td>{formatDateTime(b.createdAt)}</td>
                    <td>{b.label ?? <span className="muted">—</span>}</td>
                    <td className="align-right">{formatSize(b.sizeBytes)}</td>
                    {/* กู้คืน = ทับข้อมูลปัจจุบันทั้งฐาน · ลบ = ทิ้งตาข่ายนิรภัย
                        ทั้งสองอย่างเป็นของเจ้าของหอเท่านั้น (main บังคับอีกชั้น)
                        ส่วนการ "สร้าง" ไฟล์สำรอง พนักงานทำได้ตามปกติ ยิ่งมีสำเนายิ่งดี */}
                    <td className="align-right">
                      {user?.isOwner ? (
                        <>
                          <button type="button" className="link-btn" onClick={() => restore(b)}>
                            กู้คืน
                          </button>
                          <button
                            type="button"
                            className="link-btn link-danger table-action"
                            onClick={() => remove(b)}
                          >
                            ลบ
                          </button>
                        </>
                      ) : (
                        <span className="muted">เจ้าของหอเท่านั้น</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {labelling !== null && (
        <Modal
          title="สำรองข้อมูล"
          busy={busy}
          submitLabel="สำรองข้อมูล"
          onClose={() => setLabelling(null)}
          onSubmit={() => make(labelling)}
        >
          <div className="field">
            <label htmlFor="backupLabel">บันทึกช่วยจำ</label>
            <input
              id="backupLabel"
              value={labelling}
              onChange={(e) => setLabelling(e.target.value)}
              placeholder="เช่น ก่อนขึ้นค่าเช่าปี 2027"
              autoFocus
            />
            {/* วันที่อยู่ในชื่อไฟล์อยู่แล้ว ข้อความนี้ไว้บอก "ทำไมถึงสำรอง" ซึ่งสำคัญกว่า
                ตอนต้องเลือกว่าจะกู้คืนไฟล์ไหนในอีกหลายเดือนข้างหน้า */}
            <p className="field-hint">เว้นว่างได้ — ช่วยให้เลือกไฟล์ถูกตอนต้องกู้คืน</p>
          </div>
        </Modal>
      )}
    </>
  )
}

function formatDateTime(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
