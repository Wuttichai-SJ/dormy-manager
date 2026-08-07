import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import Modal from '../components/Modal.jsx'
import { showToast } from '../components/Toast.jsx'
import { METER_SIDES, ROOM_STATUS_LABELS, previewUnitsUsed } from '../constants.js'
import {
  createMeterBatch,
  deleteMeterBatch,
  getMeterSheet,
  listMeterBatches,
  saveMeterReadings
} from '../services/meterService.js'

// หน้าจดมิเตอร์ — โครงตามต้นแบบ (คู่มือ yeeraf หัวข้อ "จดมิเตอร์น้ำ-ไฟ"):
// รายการ "ใบจดมิเตอร์" หนึ่งใบต่อวันที่จด แล้วกดเข้าไปกรอกทีละฝั่ง (น้ำ / ไฟ)
//
// สองระดับอยู่ในหน้าเดียวกัน ไม่แยกเป็นเมนู เพราะการกรอกเลขมิเตอร์เป็นงานที่ทำรวดเดียว
// แล้วจบ — เข้าไปกรอก บันทึก ถอยกลับ ไม่ได้เป็นหน้าที่ต้องเข้าถึงตรงๆ จากที่อื่น
export default function MetersPage({ apartment }) {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [readingDate, setReadingDate] = useState(today())
  // ใบ+ฝั่งที่กำลังเปิดกรอกอยู่ — null = อยู่ที่รายการใบจด
  const [openSheet, setOpenSheet] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listMeterBatches(apartment.apartmentId)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setBatches(res.data)
  }, [apartment.apartmentId])

  useEffect(() => {
    load()
  }, [load])

  async function submitCreate() {
    setError('')
    setBusy(true)
    const res = await createMeterBatch(apartment.apartmentId, readingDate)
    setBusy(false)
    if (!res.success) return setError(res.error)
    setCreating(false)
    setReadingDate(today())
    showToast(`สร้างใบจดมิเตอร์วันที่ ${formatDate(res.data.readingDate)} แล้ว`)
    load()
  }

  async function remove(batch) {
    setError('')
    const res = await deleteMeterBatch(batch.batchId)
    if (!res.success) return setError(res.error)
    showToast(`ลบใบจดมิเตอร์วันที่ ${formatDate(batch.readingDate)} แล้ว`)
    load()
  }

  if (openSheet) {
    return (
      <MeterSheet
        batchId={openSheet.batchId}
        side={openSheet.side}
        onBack={() => {
          setOpenSheet(null)
          load()
        }}
      />
    )
  }

  return (
    <>
      <div className="info-banner">
        <strong>ใบจดมิเตอร์</strong>
        <p>
          สร้างใบจดหนึ่งใบต่อรอบการจด แล้วกดที่ปุ่มค่าน้ำหรือค่าไฟเพื่อไล่กรอกเลขมิเตอร์ทุกห้อง
          — ใบที่ถูกใช้ออกบิลไปแล้วจะแก้ไขและลบไม่ได้
        </p>
      </div>

      <section className="panel">
        <Alert>{error}</Alert>

        <div className="panel-head-row">
          <h2 className="panel-title">รายการใบจดมิเตอร์</h2>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            <span>สร้างใบจดมิเตอร์</span>
          </button>
        </div>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : batches.length === 0 ? (
          <p className="muted table-empty">ยังไม่มีใบจดมิเตอร์</p>
        ) : (
          <ul className="meter-batch-list">
            {batches.map((batch) => (
              <li key={batch.batchId} className="meter-batch">
                <div className="meter-batch-info">
                  <strong>วันที่จด: {formatDate(batch.readingDate)}</strong>
                  <span className="muted">
                    บันทึกแล้ว {batch.roomCount} ห้อง · สร้างเมื่อ {formatDateTime(batch.createdAt)}
                  </span>
                </div>

                <div className="meter-batch-actions">
                  {METER_SIDES.map((side) => (
                    <button
                      key={side.key}
                      type="button"
                      className={`btn btn-outline meter-side-btn meter-side-${side.key}`}
                      onClick={() => setOpenSheet({ batchId: batch.batchId, side: side.key })}
                    >
                      <Icon name={side.icon} />
                      <span>{side.label}</span>
                    </button>
                  ))}

                  {/* ใบที่ออกบิลไปแล้วยังเปิดดูได้ แต่ลบไม่ได้ — ปุ่มหายไปเลยดีกว่าขึ้นแล้วกดไม่ได้
                      เพราะผู้ใช้จะไม่รู้ว่าทำไม จึงบอกด้วยป้ายแทน */}
                  {batch.isUsedForBilling ? (
                    <span className="tag">ออกบิลแล้ว</span>
                  ) : (
                    <button
                      type="button"
                      className="link-btn link-danger table-action icon-only"
                      onClick={() => remove(batch)}
                      aria-label={`ลบใบจดมิเตอร์วันที่ ${formatDate(batch.readingDate)}`}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating && (
        <Modal
          title="สร้างใบจดมิเตอร์"
          icon="meters"
          busy={busy}
          onClose={() => setCreating(false)}
          onSubmit={submitCreate}
        >
          <div className="field">
            <label htmlFor="readingDate">
              วันที่จดมิเตอร์ <span className="required">* จำเป็น</span>
            </label>
            <input
              id="readingDate"
              type="date"
              value={readingDate}
              onChange={(e) => setReadingDate(e.target.value)}
            />
            <p className="field-hint">หนึ่งวันมีใบจดได้ใบเดียว</p>
          </div>
        </Modal>
      )}
    </>
  )
}

// ------------------------------------------------------------------
// ตารางกรอกเลขมิเตอร์ของฝั่งหนึ่ง
// ------------------------------------------------------------------
// ต้นแบบให้กรอกทั้งตารางแล้วกดบันทึกครั้งเดียว ฝั่ง main ก็เขียนทั้งใบในธุรกรรมเดียว
// (แถวเดียวผิด = ไม่มีแถวไหนถูกเขียน) หน้าจอจึงต้องถือค่าที่กำลังแก้ไว้ทั้งตาราง
function MeterSheet({ batchId, side, onBack }) {
  const [sheet, setSheet] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const meta = METER_SIDES.find((s) => s.key === side)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getMeterSheet(batchId, side)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setSheet(res.data)
    setRows(
      res.data.rooms.map((room) => ({
        ...room,
        // ช่องกรอกเก็บเป็นข้อความ ไม่ใช่ตัวเลข — ไม่งั้นลบเลขจนว่างแล้วจะเด้งเป็น 0
        // ทันทีจนพิมพ์ต่อไม่ได้
        previousInput: String(room.previousReading ?? 0),
        currentInput: room.currentReading === null ? '' : String(room.currentReading)
      }))
    )
  }, [batchId, side])

  useEffect(() => {
    load()
  }, [load])

  function setRow(roomId, patch) {
    setRows((list) => list.map((r) => (r.roomId === roomId ? { ...r, ...patch } : r)))
  }

  // บันทึกเฉพาะห้องที่กรอกเลขปัจจุบันมาจริงๆ — ห้องที่เว้นว่างแปลว่ายังไม่ได้ไปจด
  // ไม่ใช่จดได้ 0 การส่ง 0 ไปให้ทุกห้องจะทำให้บิลของห้องที่ยังไม่ได้จดออกมาเป็น 0 หน่วย
  // ทั้งที่ความจริงคือยังไม่มีข้อมูล
  const filled = useMemo(() => rows.filter((r) => r.currentInput.trim() !== ''), [rows])

  async function save() {
    setError('')
    setBusy(true)
    const res = await saveMeterReadings(
      batchId,
      side,
      filled.map((r) => ({
        roomId: r.roomId,
        roomNumber: r.roomNumber,
        previousReading: Number(r.previousInput || 0),
        currentReading: Number(r.currentInput || 0),
        isOverCycle: r.isOverCycle
      }))
    )
    setBusy(false)
    if (!res.success) return setError(res.error)
    showToast(`บันทึกเลข${meta.label}แล้ว ${filled.length} ห้อง`)
    load()
  }

  return (
    <>
      <div className="page-back">
        <button type="button" className="link-btn" onClick={onBack}>
          <Icon name="back" />
          <span>กลับไปรายการใบจดมิเตอร์</span>
        </button>
      </div>

      <div className="info-banner">
        <strong>
          จด{meta.label} — รอบวันที่ {sheet ? formatDate(sheet.readingDate) : '...'}
        </strong>
        <p>
          ช่อง “จดครั้งก่อน” ระบบเติมให้จากรอบก่อนหน้า (หรือเลขมิเตอร์วันเข้าพักในสัญญา)
          แก้ไขได้ · ห้องที่เว้นช่อง “ปัจจุบัน” ไว้จะไม่ถูกบันทึก
        </p>
      </div>

      <section className="panel">
        <Alert>{error}</Alert>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : (
          <>
            <table className="data-table meter-table">
              <thead>
                <tr>
                  <th>ห้อง</th>
                  <th>สถานะห้อง</th>
                  <th className="align-right">จดครั้งก่อน</th>
                  <th className="align-right">ปัจจุบัน</th>
                  <th className="align-right">หน่วย</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  // ยังไม่กรอกกับกรอกแล้วคำนวณไม่ได้ ต้องแสดงคนละอย่าง — ถ้ารวมเป็นกรณีเดียว
                  // ห้องที่ยังไม่ได้ไปจดจะขึ้นเครื่องหมายเตือนสีแดงทั้งตารางตั้งแต่เปิดหน้ามา
                  const pending = row.currentInput.trim() === ''
                  const units = pending
                    ? null
                    : previewUnitsUsed(row.previousInput, row.currentInput, row.isOverCycle)
                  return (
                    <tr key={row.roomId}>
                      <td>{row.roomNumber}</td>
                      <td>
                        <span className={`room-badge status-${row.status}`}>
                          {ROOM_STATUS_LABELS[row.status] ?? row.status}
                        </span>
                      </td>
                      <td className="align-right">
                        <input
                          className="meter-input"
                          inputMode="decimal"
                          value={row.previousInput}
                          onChange={(e) => setRow(row.roomId, { previousInput: e.target.value })}
                          aria-label={`เลขมิเตอร์ครั้งก่อน ห้อง ${row.roomNumber}`}
                        />
                      </td>
                      <td className="align-right">
                        <input
                          className="meter-input"
                          inputMode="decimal"
                          value={row.currentInput}
                          onChange={(e) => setRow(row.roomId, { currentInput: e.target.value })}
                          aria-label={`เลขมิเตอร์ปัจจุบัน ห้อง ${row.roomNumber}`}
                        />
                        {/* มิเตอร์วิ่งจนสุดหน้าปัดแล้วหมุนกลับไป 0 ทำให้เลขปัจจุบันน้อยกว่า
                            ครั้งก่อนทั้งที่ใช้ไปจริง — ติ๊กช่องนี้เพื่อบอกระบบว่าไม่ได้กรอกผิด */}
                        <label className="meter-overcycle">
                          <input
                            type="checkbox"
                            checked={row.isOverCycle}
                            onChange={(e) =>
                              setRow(row.roomId, { isOverCycle: e.target.checked })
                            }
                          />
                          <span>เกินรอบมิเตอร์</span>
                        </label>
                      </td>
                      <td className="align-right">
                        {pending ? (
                          <span className="muted">—</span>
                        ) : units === null ? (
                          <span
                            className="meter-units-bad"
                            title="เลขปัจจุบันน้อยกว่าครั้งก่อน — ถ้ามิเตอร์หมุนครบรอบ ให้ติ๊ก “เกินรอบมิเตอร์”"
                          >
                            <Icon name="warning" />
                          </span>
                        ) : (
                          <strong className="meter-units">{units}</strong>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="card-foot">
              <span className="muted">กรอกแล้ว {filled.length} จาก {rows.length} ห้อง</span>
              <button type="button" className="btn" onClick={save} disabled={busy}>
                {busy ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </>
        )}
      </section>
    </>
  )
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

function formatDateTime(iso) {
  if (!iso) return '-'
  const at = new Date(iso)
  return `${pad2(at.getDate())}/${pad2(at.getMonth() + 1)}/${at.getFullYear()} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`
}
