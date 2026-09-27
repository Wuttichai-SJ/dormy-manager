import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import InfoTip from '../components/InfoTip.jsx'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { showToast } from '../components/Toast.jsx'
import {
  createBackup,
  deleteBackup,
  exportBackup,
  importBackup,
  listBackups,
  restoreBackup,
  revealBackupFolder
} from '../services/backupService.js'

export default function BackupsPage({ user }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [labelling, setLabelling] = useState(null)
  const [deleting, setDeleting] = useState(null)

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
    // ยืนยันกู้คืนด้วยกล่องของระบบฝั่ง main — หน้านี้จะถูก reload
    const res = await restoreBackup(backup.fileName)
    if (!res.success) return setError(res.error)
  }

  async function exportOne(backup) {
    setError('')
    const res = await exportBackup(backup.fileName)
    if (!res.success) return setError(res.error)
    if (res.data.cancelled) return
    showToast(`ส่งออกไฟล์สำรองไปที่ ${res.data.filePath} แล้ว`)
  }

  async function importOne() {
    setError('')
    setBusy(true)
    const res = await importBackup()
    setBusy(false)
    if (!res.success) return setError(res.error)
    if (res.data.cancelled) return
    showToast(`นำเข้าไฟล์สำรองแล้ว (ข้อมูล ${res.data.apartments} หอ)`)
    load()
  }

  async function remove(backup) {
    const res = await deleteBackup(backup.fileName)
    if (!res.success) return res
    setDeleting(null)
    showToast('ลบไฟล์สำรองแล้ว')
    load()
    return res
  }

  return (
    <>
      <section className="form-section">
        <div className="form-section-head">
          <h2>
            สร้างไฟล์สำรอง
            <InfoTip
              title="สำรองข้อมูล"
              points={[
                'ข้อมูลทั้งหมดอยู่ในเครื่องนี้ ไม่มีสำเนาบนอินเทอร์เน็ต',
                'ควรสำรองก่อนทำอะไรที่ย้อนกลับไม่ได้',
                'ใช้เวลาไม่กี่วินาที'
              ]}
            />
          </h2>
          <p>คัดลอกข้อมูล ณ ตอนนี้เก็บเป็นไฟล์แยก</p>
        </div>

        <div className="form-section-body">
          <Alert>{error}</Alert>

          <div className="backup-warning">
            <Icon name="warning" />
            <p>
              <strong>ดิสก์พังจะหายไปพร้อมกัน</strong> — คัดลอกไฟล์สำรองไปไว้ USB หรือไดรฟ์อื่นด้วย
            </p>
          </div>

          <div className="backup-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => setLabelling('')}>
              {busy ? 'กำลังสำรอง...' : 'สำรองข้อมูลตอนนี้'}
            </button>
            {user?.isOwner && (
              <button type="button" className="btn btn-outline" disabled={busy} onClick={importOne}>
                <Icon name="upload" />
                <span>นำเข้าไฟล์สำรอง</span>
              </button>
            )}
            <button type="button" className="btn btn-outline" onClick={() => revealBackupFolder()}>
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
            <p className="muted">ยังไม่มีไฟล์สำรอง</p>
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
                    {/* กู้คืน/ลบ เฉพาะเจ้าของหอ · สร้างได้ทุกคน */}
                    <td className="align-right">
                      {user?.isOwner ? (
                        <>
                          <button type="button" className="link-btn" onClick={() => exportOne(b)}>
                            <Icon name="download" />
                            <span>ส่งออก</span>
                          </button>
                          <button type="button" className="link-btn" onClick={() => restore(b)}>
                            กู้คืน
                          </button>
                          <button
                            type="button"
                            className="link-btn link-danger table-action"
                            onClick={() => setDeleting(b)}
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

      {deleting && (
        <ConfirmDialog
          title="ลบไฟล์สำรอง"
          message={`ลบ ${deleting.fileName} ถาวร กู้คืนไม่ได้`}
          confirmLabel="ลบไฟล์"
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}

      {labelling !== null && (
        <Modal
          title="สำรองข้อมูล"
          busy={busy}
          submitLabel="สำรองข้อมูล"
          error={error}
          onClose={() => {
            setLabelling(null)
            setError('')
          }}
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
