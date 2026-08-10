import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import Modal from '../components/Modal.jsx'
import DateField from '../components/DateField.jsx'
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
            <DateField id="readingDate" value={readingDate} onChange={setReadingDate} />
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
        currentInput: room.currentReading === null ? '' : String(room.currentReading),
        // สามสถานะที่เลือกได้ทีละอย่าง เก็บเป็นค่าเดียวไม่ใช่ boolean สองตัว — สองตัวติ๊ก
        // พร้อมกันได้ แล้วต้องมาตัดสินทีหลังว่าอันไหนชนะ
        meterEvent: room.isMeterReplaced ? 'replaced' : room.isOverCycle ? 'over_cycle' : 'normal',
        removedInput: room.removedReading === null ? '' : String(room.removedReading),
        newStartInput: room.newStartReading === null ? '' : String(room.newStartReading)
      }))
    )
  }, [batchId, side])

  useEffect(() => {
    load()
  }, [load])

  function setRow(roomId, patch) {
    setRows((list) => list.map((r) => (r.roomId === roomId ? { ...r, ...patch } : r)))
  }

  // กด Enter แล้วลงไปกรอกห้องถัดไปต่อได้เลย — คนจดมิเตอร์ถือกระดาษเดินไล่ห้องแล้วพิมพ์
  // ตัวเลขรวดเดียว ถ้าต้องละมือไปคลิกทีละช่องจะช้ากว่าการพิมพ์มาก
  //
  // เลื่อนไปเสมอแม้แถวนั้นยังคำนวณไม่ได้ (เลขลดลงโดยไม่ติ๊กเกินรอบ) ไม่งั้นจะกลายเป็น
  // กักคนไว้ในช่องที่เขาอาจตั้งใจย้อนกลับมาแก้ทีหลัง — เครื่องหมายเตือนในคอลัมน์หน่วย
  // บอกอยู่แล้วว่าแถวไหนยังไม่เรียบร้อย และฝั่ง main ก็ไม่ยอมให้บันทึกอยู่ดี
  const inputsRef = useRef(new Map())

  function focusNextRoom(roomId) {
    const index = rows.findIndex((r) => r.roomId === roomId)
    const next = rows[index + 1]
    if (!next) return

    const el = inputsRef.current.get(next.roomId)
    if (!el) return
    el.focus()
    // เลือกข้อความเดิมไว้ให้ด้วย พิมพ์ทับได้เลยโดยไม่ต้องลบก่อน (ห้องที่เคยจดไว้แล้ว
    // จะมีเลขเก่าค้างอยู่ในช่อง)
    el.select()
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
      // ไม่ส่งเลขครั้งก่อนไป — ฝั่ง main คิดเองจากเลขปิดของรอบก่อน (ส่งไปก็ไม่ถูกใช้)
      filled.map((r) => ({
        roomId: r.roomId,
        roomNumber: r.roomNumber,
        currentReading: Number(r.currentInput || 0),
        isOverCycle: r.meterEvent === 'over_cycle',
        isMeterReplaced: r.meterEvent === 'replaced',
        // ส่งเป็นข้อความไปตามที่พิมพ์ — ช่องว่างต้องไปถึงฝั่ง main เพื่อให้มันเป็นคน
        // บอกว่า "ต้องกรอกเลขตอนถอดมิเตอร์เก่า" ไม่ใช่กลายเป็น 0 เงียบๆ ระหว่างทาง
        removedReading: r.removedInput,
        newStartReading: r.newStartInput
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
          “จดครั้งก่อน” คือเลขปิดของรอบที่แล้ว (หรือเลขมิเตอร์วันเข้าพักในสัญญา ถ้ายังไม่เคยจด)
          ระบบกำหนดให้เอง แก้ไม่ได้ · ห้องที่เว้นช่อง “ปัจจุบัน” ไว้จะไม่ถูกบันทึก ·{' '}
          <strong>กด Enter เพื่อลงไปกรอกห้องถัดไป</strong>
        </p>
        <p>
          มิเตอร์ของหอนี้ตั้งไว้ <strong>{sheet?.meterDigits ?? '...'} หลัก</strong>{' '}
          จึงอ่านได้สูงสุด {sheet ? (10 ** sheet.meterDigits - 1).toLocaleString() : '...'} —
          เลขที่เกินกว่านี้ระบบจะไม่รับ (แก้จำนวนหลักได้ที่หน้าตั้งค่าหอพัก)
        </p>
        <p>
          ถ้าเลขปัจจุบันน้อยกว่าครั้งก่อน ให้เลือกว่าเกิดอะไรขึ้น —{' '}
          <strong>เกินรอบมิเตอร์</strong> คือมิเตอร์ลูกเดิมวิ่งจนสุดหน้าปัดแล้ววนกลับมาศูนย์ ส่วน{' '}
          <strong>เปลี่ยนมิเตอร์ใหม่</strong> คือถอดลูกเก่าออกแล้วติดลูกใหม่
          สองกรณีนี้คิดหน่วยคนละแบบ เลือกผิดบิลจะผิดไปมาก
        </p>
      </div>

      <section className="panel">
        <Alert>{error}</Alert>

        {/* ห้องที่มีผู้เช่าแต่ถูกปิดใช้งานไว้ จะไม่อยู่ในตารางนี้ — ต้องบอกว่าห้องไหนหายไป
            และหายเพราะอะไร ไม่ใช่ปล่อยให้ไปนับห้องเอาเองว่าครบหรือไม่ */}
        {sheet?.hiddenRooms?.length > 0 && (
          <Alert kind="warn">
            ห้อง {sheet.hiddenRooms.join(', ')} มีผู้เช่าอยู่แต่ถูกปิดใช้งานไว้
            จึงไม่อยู่ในใบจดมิเตอร์นี้ — ถ้ายังใช้งานห้องอยู่ ให้เปิดใช้งานที่ ตั้งค่า → ผังห้อง
          </Alert>
        )}

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
                  const replaced = row.meterEvent === 'replaced'
                  // แยกกรณี "พิมพ์เกินหลัก" ออกมาเพื่อให้คำเตือนบอกตรงเหตุ — เป็นความผิดพลาด
                  // ที่เกิดบ่อยสุดตอนไล่พิมพ์เร็วๆ ทั้งหอ (กด 0 เกินไปหนึ่งตัว)
                  const overDial = !pending && Number(row.currentInput) >= 10 ** sheet.meterDigits
                  const units = pending
                    ? null
                    : previewUnitsUsed(row.previousReading, row.currentInput, {
                        isOverCycle: row.meterEvent === 'over_cycle',
                        isMeterReplaced: replaced,
                        removedReading: row.removedInput,
                        newStartReading: row.newStartInput,
                        meterDigits: sheet?.meterDigits
                      })
                  return (
                    <tr key={row.roomId}>
                      <td>{row.roomNumber}</td>
                      <td>
                        <span className={`room-badge status-${row.status}`}>
                          {ROOM_STATUS_LABELS[row.status] ?? row.status}
                        </span>
                      </td>
                      {/* อ่านอย่างเดียว — เลขปิดของรอบก่อนคือเลขเปิดของรอบนี้ ไม่ใช่ตัวเลข
                          ที่กรอกทับได้ แก้ได้เมื่อไหร่โซ่มิเตอร์ก็ขาดได้เมื่อนั้น */}
                      <td className="align-right meter-previous">{row.previousReading}</td>
                      <td className="align-right">
                        <input
                          className="meter-input"
                          inputMode="decimal"
                          value={row.currentInput}
                          onChange={(e) => setRow(row.roomId, { currentInput: e.target.value })}
                          aria-label={`เลขมิเตอร์ปัจจุบัน ห้อง ${row.roomNumber}`}
                          ref={(el) => {
                            if (el) inputsRef.current.set(row.roomId, el)
                            else inputsRef.current.delete(row.roomId)
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return
                            e.preventDefault()
                            focusNextRoom(row.roomId)
                          }}
                        />
                        {/* สองเหตุการณ์ที่ทำให้เลขปัจจุบันน้อยกว่าครั้งก่อนได้โดยไม่ได้จดผิด
                            และคิดหน่วยคนละสูตรกัน จึงเป็นตัวเลือกที่เลือกได้ทีละอย่าง
                            ไม่ใช่ช่องติ๊กสองช่องที่ติ๊กพร้อมกันได้ */}
                        <select
                          className={
                            row.meterEvent === 'normal'
                              ? 'meter-event'
                              : 'meter-event meter-event-special'
                          }
                          value={row.meterEvent}
                          onChange={(e) => setRow(row.roomId, { meterEvent: e.target.value })}
                          aria-label={`กรณีพิเศษของมิเตอร์ ห้อง ${row.roomNumber}`}
                        >
                          <option value="normal">มิเตอร์ปกติ</option>
                          <option value="over_cycle">เกินรอบมิเตอร์</option>
                          <option value="replaced">เปลี่ยนมิเตอร์ใหม่</option>
                        </select>

                        {/* เลขสองตัวนี้ต้องเก็บไว้ ไม่ใช่แค่ใช้คำนวณแล้วทิ้ง — ปีหน้ามีคนถามแน่
                            ว่าทำไมเลขมิเตอร์ห้องนี้กระโดด แล้วต้องตอบได้จากข้อมูลที่มี */}
                        {replaced && (
                          <div className="meter-replace-fields">
                            <label>
                              <span>เลขตอนถอดลูกเก่า</span>
                              <input
                                className="meter-input"
                                inputMode="decimal"
                                value={row.removedInput}
                                onChange={(e) =>
                                  setRow(row.roomId, { removedInput: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              <span>เลขเริ่มลูกใหม่</span>
                              <input
                                className="meter-input"
                                inputMode="decimal"
                                value={row.newStartInput}
                                onChange={(e) =>
                                  setRow(row.roomId, { newStartInput: e.target.value })
                                }
                              />
                            </label>
                          </div>
                        )}
                      </td>
                      <td className="align-right">
                        {pending ? (
                          <span className="muted">—</span>
                        ) : units === null ? (
                          <span
                            className="meter-units-bad"
                            title={
                              overDial
                                ? `เลขที่กรอกเกินหน้าปัดมิเตอร์ ${sheet.meterDigits} หลัก ซึ่งอ่านได้สูงสุด ${10 ** sheet.meterDigits - 1}`
                                : replaced
                                  ? 'ยังกรอกเลขตอนถอดลูกเก่า/เลขเริ่มลูกใหม่ไม่ครบ หรือเลขไม่สมเหตุสมผล'
                                  : 'เลขปัจจุบันน้อยกว่าครั้งก่อน — ถ้ามิเตอร์หมุนครบรอบ เลือก “เกินรอบมิเตอร์” ถ้าเปลี่ยนมิเตอร์ลูกใหม่ เลือก “เปลี่ยนมิเตอร์ใหม่”'
                            }
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
