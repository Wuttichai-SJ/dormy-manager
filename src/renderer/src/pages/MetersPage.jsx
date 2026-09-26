import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from '../components/FieldError.jsx'
import InfoTip from '../components/InfoTip.jsx'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
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

export default function MetersPage({ apartment }) {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [readingDate, setReadingDate] = useState(today())
  const createForm = useFormErrors(['readingDate'])
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
    createForm.reset()
    setBusy(true)
    const res = await createMeterBatch(apartment.apartmentId, readingDate)
    setBusy(false)
    if (!res.success) return createForm.fromResult(res)
    setCreating(false)
    setReadingDate(today())
    showToast(`สร้างใบจดมิเตอร์วันที่ ${formatDate(res.data.readingDate)} แล้ว`)
    load()
  }

  async function remove(batch) {
    const res = await deleteMeterBatch(batch.batchId)
    if (!res.success) return res
    setDeleting(null)
    showToast(`ลบใบจดมิเตอร์วันที่ ${formatDate(batch.readingDate)} แล้ว`)
    load()
    return res
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
      <section className="panel">
        <Alert>{error}</Alert>

        <div className="panel-head-row">
          <h2 className="panel-title">
            รายการใบจดมิเตอร์
            <InfoTip
              title="ใบจดมิเตอร์"
              points={[
                'สร้างหนึ่งใบต่อรอบการจด',
                'กดค่าน้ำหรือค่าไฟเพื่อกรอกเลขทุกห้อง',
                'ใบที่ออกบิลไปแล้ว แก้ไขและลบไม่ได้'
              ]}
            />
          </h2>
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

                  {batch.isUsedForBilling ? (
                    <span className="tag">ออกบิลแล้ว</span>
                  ) : (
                    <button
                      type="button"
                      className="link-btn link-danger table-action icon-only"
                      onClick={() => setDeleting(batch)}
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

      {deleting && (
        <ConfirmDialog
          title={`ลบใบจดมิเตอร์วันที่ ${formatDate(deleting.readingDate)}`}
          message="เลขมิเตอร์ที่จดไว้ในใบนี้ทุกห้องจะหายไป กู้คืนไม่ได้"
          confirmLabel="ลบใบจด"
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}

      {creating && (
        <Modal
          title="สร้างใบจดมิเตอร์"
          icon="meters"
          busy={busy}
          error={createForm.formError}
          onClose={() => {
            setCreating(false)
            createForm.reset()
          }}
          onSubmit={submitCreate}
        >
          <div className={fieldClass('field', createForm.errors.readingDate)}>
            <label htmlFor="readingDate">
              วันที่จดมิเตอร์ <span className="required">* จำเป็น</span>
            </label>
            <DateField
              id="readingDate"
              value={readingDate}
              onChange={(v) => {
                setReadingDate(v)
                createForm.clear('readingDate')
              }}
            />
            {createForm.errors.readingDate ? (
              <FieldError id="readingDate-error" message={createForm.errors.readingDate} />
            ) : (
              <p className="field-hint">หนึ่งวันมีใบจดได้ใบเดียว</p>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

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
        // เก็บเป็นข้อความ — ลบจนว่างต้องไม่เด้งเป็น 0
        currentInput: room.currentReading === null ? '' : String(room.currentReading),
        // สามสถานะเลือกได้ทีละอย่าง — เก็บเป็นค่าเดียว
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

  // Enter = ไปห้องถัดไป
  const inputsRef = useRef(new Map())

  function focusNextRoom(roomId) {
    const index = rows.findIndex((r) => r.roomId === roomId)
    const next = rows[index + 1]
    if (!next) return

    const el = inputsRef.current.get(next.roomId)
    if (!el) return
    el.focus()
    el.select()
  }

  // ส่งเฉพาะห้องที่กรอกเลขปัจจุบัน — ว่าง = ยังไม่ได้จด (ไม่ใช่ 0)
  const filled = useMemo(() => rows.filter((r) => r.currentInput.trim() !== ''), [rows])

  async function save() {
    setError('')
    setBusy(true)
    const res = await saveMeterReadings(
      batchId,
      side,
      // ไม่ส่งเลขครั้งก่อน — main คิดเอง
      filled.map((r) => ({
        roomId: r.roomId,
        roomNumber: r.roomNumber,
        currentReading: Number(r.currentInput || 0),
        isOverCycle: r.meterEvent === 'over_cycle',
        isMeterReplaced: r.meterEvent === 'replaced',
        // ส่งข้อความตามที่พิมพ์ — ช่องว่างต้องไปถึง main
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

      <section className="panel">
        <h2 className="panel-title">
          จด{meta.label} — รอบวันที่ {sheet ? formatDate(sheet.readingDate) : '...'}
          <InfoTip
            title="วิธีจด"
            points={[
              '“จดครั้งก่อน” คือเลขปิดรอบที่แล้ว',
              'ห้องที่เปลี่ยนผู้เช่า เริ่มจากเลขวันเข้าพักในสัญญา',
              'เว้นช่อง “ปัจจุบัน” = ไม่บันทึกห้องนั้น',
              'กด Enter เพื่อไปห้องถัดไป'
            ]}
          />
        </h2>
        <Alert>{error}</Alert>

        {sheet?.hiddenRooms?.length > 0 && (
          <Alert kind="warn">
            ห้อง {sheet.hiddenRooms.join(', ')} ถูกปิดใช้งาน จึงไม่อยู่ในใบนี้ — เปิดได้ที่ ตั้งค่า →
            ผังห้อง
          </Alert>
        )}

        {sheet?.newTenantRooms?.length > 0 && (
          <Alert kind="warn">
            <strong>ห้องที่เปลี่ยนผู้เช่า — เริ่มนับเลขใหม่</strong>
            <ul className="meter-new-tenant-list">
              {sheet.newTenantRooms.map((r) => (
                <li key={r.roomNumber}>
                  ห้อง {r.roomNumber}: เริ่มจาก <strong>{r.previousReading}</strong> (เข้าพัก{' '}
                  {formatDate(r.contractStartDate)}) แทน {r.supersededReading}
                </li>
              ))}
            </ul>
            ถ้าไม่ตรงหน้าปัดจริง ให้แก้ที่สัญญาก่อนบันทึก
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
                  <th className="align-right">
                    ปัจจุบัน
                    {sheet && (
                      <InfoTip
                        title={`มิเตอร์ ${sheet.meterDigits} หลัก (สูงสุด ${(10 ** sheet.meterDigits - 1).toLocaleString()})`}
                        points={[
                          'เลขน้อยกว่าครั้งก่อน ต้องเลือกกรณี:',
                          '“เกินรอบมิเตอร์” = ลูกเดิมวนกลับศูนย์',
                          '“เปลี่ยนมิเตอร์ใหม่” = ถอดลูกเก่า ติดลูกใหม่',
                          'สองกรณีคิดหน่วยคนละแบบ เลือกผิดบิลผิด'
                        ]}
                      />
                    )}
                  </th>
                  <th className="align-right">หน่วย</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  // ยังไม่กรอก ≠ กรอกแล้วคำนวณไม่ได้
                  const pending = row.currentInput.trim() === ''
                  const replaced = row.meterEvent === 'replaced'
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
                  const problem =
                    !pending && units === null ? meterProblem(row, sheet.meterDigits, overDial) : null
                  const problemId = `meter-problem-${row.roomId}`
                  return (
                    <tr key={row.roomId}>
                      <td>{row.roomNumber}</td>
                      <td>
                        <span className={`room-badge status-${row.status}`}>
                          {ROOM_STATUS_LABELS[row.status] ?? row.status}
                        </span>
                      </td>
                      {/* อ่านอย่างเดียว — เลขปิดรอบก่อนคือเลขเปิดรอบนี้ */}
                      <td className="align-right meter-previous">
                        {row.previousReading}
                        {row.supersededReading !== null &&
                          row.supersededReading !== undefined && (
                            <span
                              className="meter-new-tenant-tag"
                              title={`ผู้เช่าใหม่เข้าพัก ${formatDate(row.contractStartDate)} — เลขปิดรอบก่อนของผู้เช่าคนเดิมคือ ${row.supersededReading}`}
                            >
                              ผู้เช่าใหม่
                            </span>
                          )}
                      </td>
                      <td className="align-right">
                        <div className="meter-entry">
                          <input
                            className="meter-input"
                            inputMode="decimal"
                            value={row.currentInput}
                            onChange={(e) => setRow(row.roomId, { currentInput: e.target.value })}
                            aria-label={`เลขมิเตอร์ปัจจุบัน ห้อง ${row.roomNumber}`}
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={problem ? problemId : undefined}
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
                        </div>

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

                        {problem && (
                          <p id={problemId} className="meter-row-warn">
                            {problem}
                          </p>
                        )}
                      </td>
                      <td className="align-right">
                        {pending ? (
                          <span className="muted">—</span>
                        ) : units === null ? (
                          <span className="meter-units-bad" role="img" aria-label="คำนวณหน่วยไม่ได้">
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

// ลำดับเดียวกับ previewUnitsUsed (constants.js)
function meterProblem(row, meterDigits, overDial) {
  const current = Number(row.currentInput)
  if (!Number.isFinite(current) || current < 0) return 'กรอกเป็นตัวเลขเท่านั้น'
  if (overDial) {
    return `เกินหน้าปัด ${meterDigits} หลัก (สูงสุด ${(10 ** meterDigits - 1).toLocaleString()})`
  }
  if (row.meterEvent === 'replaced') return 'กรอกเลขถอดลูกเก่าและเลขเริ่มลูกใหม่ให้ครบและถูกต้อง'
  return 'เลขน้อยกว่าครั้งก่อน — เลือก “เกินรอบมิเตอร์” หรือ “เปลี่ยนมิเตอร์ใหม่”'
}
