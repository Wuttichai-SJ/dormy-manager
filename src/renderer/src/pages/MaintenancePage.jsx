import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from '../components/FieldError.jsx'
import InfoTip from '../components/InfoTip.jsx'
import DateField from '../components/DateField.jsx'
import Modal from '../components/Modal.jsx'
import ConfirmDialog, { useConfirm } from '../components/ConfirmDialog.jsx'
import { showToast } from '../components/Toast.jsx'
import { MAINTENANCE_STATUS_FILTERS } from '../constants.js'
import { centsToInput, formatBaht } from '../format.js'
import { listFloors } from '../services/roomService.js'
import {
  addMaintenanceImage,
  cancelMaintenance,
  completeMaintenance,
  createMaintenance,
  deleteMaintenance,
  getMaintenance,
  getMaintenanceImage,
  listMaintenance,
  removeMaintenanceImage,
  reopenMaintenance,
  updateMaintenance
} from '../services/maintenanceService.js'

// หน้าแจ้งซ่อม — รายการงานของทั้งหอ + ทางเข้ารับแจ้งงานใหม่
//
// **งานซ่อมผูกกับ "ห้อง" ไม่ใช่สัญญา** — ห้องว่างก็แจ้งซ่อมได้ และควรแจ้งด้วยซ้ำ
// (ซ่อมตอนว่างคือช่วงเดียวที่ซ่อมได้โดยไม่รบกวนใคร) ชื่อผู้เช่าที่แสดงจึงเป็นคนที่อยู่
// ในห้องนั้น *ตอนนี้* เอาไว้ให้ติดต่อได้ ไม่ใช่ส่วนหนึ่งของตัวงาน
//
// **ค่าซ่อมที่บันทึกยังเป็นแค่บันทึกว่าหอจ่ายอะไรไป ยังไม่ไหลไปเป็นเงินที่ไหน** —
// รอคำตอบจากเจ้าของหอว่าค่าซ่อมระหว่างผู้เช่ายังอยู่ เรียกเก็บจากผู้เช่าได้ไหม
export default function MaintenancePage({ apartment }) {
  const [filters, setFilters] = useState({ status: 'open', search: '' })
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  // งานที่กำลังเปิดดูรายละเอียด — null = อยู่ที่ตาราง
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listMaintenance(apartment.apartmentId, {
      status: filters.status || undefined,
      search: filters.search || undefined
    })
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setReport(res.data)
  }, [apartment.apartmentId, filters])

  useEffect(() => {
    load()
  }, [load])

  if (openId) {
    return (
      <MaintenanceDetail
        maintenanceId={openId}
        onBack={() => setOpenId(null)}
        onChanged={load}
      />
    )
  }

  const rows = report?.requests ?? []

  return (
    <>
      <section className="panel">
        <Alert>{error}</Alert>

        <div className="room-stats">
          <div className="stat-card highlight">
            <div className="stat-card-value">{report?.openCount ?? 0}</div>
            <div className="stat-card-label">งานที่ยังค้าง</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{report?.countByStatus?.scheduled ?? 0}</div>
            <div className="stat-card-label">นัดช่างแล้ว</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{report?.countByStatus?.done ?? 0}</div>
            <div className="stat-card-label">ซ่อมเสร็จแล้ว</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{formatBaht(report?.repairCostTotalCents ?? 0)}</div>
            <div className="stat-card-label">ค่าซ่อมรวม (บาท)</div>
          </div>
        </div>

        <div className="invoice-filters">
          <div className="field">
            <label htmlFor="maintenanceStatus">สถานะ</label>
            <select
              id="maintenanceStatus"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            >
              {MAINTENANCE_STATUS_FILTERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="maintenanceSearch">เลขห้อง หรืออาการ</label>
            <input
              id="maintenanceSearch"
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="เช่น 101 หรือ น้ำรั่ว"
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setFilters({ status: 'open', search: '' })}
            >
              รีเซ็ต
            </button>
          </div>
        </div>

        <div className="panel-head-row">
          <h2 className="panel-title">รายการแจ้งซ่อม</h2>
          <button type="button" className="btn btn-sm" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            <span>รับแจ้งซ่อม</span>
          </button>
        </div>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <p className="muted table-empty">
            {filters.status === 'open' && !filters.search
              ? 'ไม่มีงานซ่อมค้างอยู่'
              : 'ไม่พบงานซ่อมตามเงื่อนไขที่เลือก'}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="invoice-col-no">#</th>
                <th>วันที่แจ้ง</th>
                <th>ห้อง</th>
                <th>ผู้เช่า</th>
                <th>อาการ</th>
                <th>นัดช่าง</th>
                <th>สถานะ</th>
                <th className="align-right">ค่าซ่อม</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.maintenanceId} className={row.isOpen ? undefined : 'receipt-row-cancelled'}>
                  <td className="invoice-col-no">{index + 1}</td>
                  <td>{formatDate(row.reportedDate)}</td>
                  <td>{row.roomNumber}</td>
                  <td>{row.tenantName ?? '-'}</td>
                  <td className="maintenance-description">
                    {row.description}
                    {row.imageCount > 0 && (
                      <span className="room-badge">รูป {row.imageCount}</span>
                    )}
                  </td>
                  {/* "—" ไม่ได้แปลว่าไม่มีวันนัด แต่แปลว่า "ยังไม่ได้นัด" ซึ่งคือสิ่งที่
                      ต้องไปทำต่อ (migration 028 ทำให้ช่องนี้ว่างได้ด้วยเหตุผลนี้) */}
                  <td>{row.appointmentDate ? formatDate(row.appointmentDate) : '—'}</td>
                  <td>{row.statusLabel}</td>
                  <td className="align-right">
                    {row.repairCostCents === null ? (
                      <span className="muted">-</span>
                    ) : (
                      formatBaht(row.repairCostCents)
                    )}
                  </td>
                  <td className="align-right">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setOpenId(row.maintenanceId)}
                    >
                      รายละเอียด
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {creating && (
        <ReportDialog
          apartment={apartment}
          onClose={() => setCreating(false)}
          onCreated={(request) => {
            setCreating(false)
            showToast(`รับแจ้งซ่อมห้อง ${request.roomNumber} แล้ว`)
            setOpenId(request.maintenanceId)
            load()
          }}
        />
      )}
    </>
  )
}

// ------------------------------------------------------------------
// รับแจ้งงานใหม่
// ------------------------------------------------------------------
// ชื่อช่องตรงกับ key ใน FieldError ของ src/main/db/maintenance.js
const REPORT_FIELDS = ['roomId', 'reportedDate', 'description', 'appointmentDate']

function ReportDialog({ apartment, onClose, onCreated }) {
  const [rooms, setRooms] = useState([])
  const [form, setForm] = useState({
    roomId: '',
    reportedDate: todayIso(),
    description: '',
    appointmentDate: ''
  })
  const [busy, setBusy] = useState(false)
  const { errors, formError, fromResult, clear, reset } = useFormErrors(REPORT_FIELDS)

  // แก้ช่องไหน error ของช่องนั้นหายทันที
  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    clear(key)
  }

  useEffect(() => {
    let cancelled = false
    listFloors(apartment.apartmentId).then((res) => {
      if (cancelled) return
      if (!res.success) return fromResult(res)
      // แบนชั้นทั้งหมดเป็นรายการห้องเดียว — คนแจ้งรู้เลขห้อง ไม่ได้คิดเป็นชั้น
      setRooms(res.data.flatMap((floor) => floor.rooms.map((r) => ({ ...r, floor: floor.floorName }))))
    })
    return () => {
      cancelled = true
    }
  }, [apartment.apartmentId, fromResult])

  async function submit() {
    reset()
    if (!form.roomId) return fromResult({ fields: { roomId: 'กรุณาเลือกห้อง' } })
    setBusy(true)
    const res = await createMaintenance({
      roomId: Number(form.roomId),
      reportedDate: form.reportedDate,
      description: form.description,
      appointmentDate: form.appointmentDate || null
    })
    setBusy(false)
    if (!res.success) return fromResult(res)
    onCreated(res.data)
  }

  return (
    <Modal
      title="รับแจ้งซ่อม"
      icon="maintenance"
      submitLabel="บันทึกการแจ้ง"
      busy={busy}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className={fieldClass('field field-required', errors.roomId)}>
        <label htmlFor="maintenanceRoom">
          ห้อง <span className="required">* จำเป็น</span>
        </label>
        <select
          id="maintenanceRoom"
          value={form.roomId}
          onChange={(e) => set('roomId', e.target.value)}
          {...invalidProps('maintenanceRoom', errors.roomId)}
        >
          <option value="">— เลือกห้อง —</option>
          {rooms.map((room) => (
            <option key={room.roomId} value={room.roomId}>
              {room.roomNumber} ({room.floor})
            </option>
          ))}
        </select>
        <FieldError id="maintenanceRoom-error" message={errors.roomId} />
      </div>

      <div className={fieldClass('field field-required', errors.reportedDate)}>
        <label htmlFor="maintenanceReported">
          วันที่แจ้ง <span className="required">* จำเป็น</span>
        </label>
        <DateField
          id="maintenanceReported"
          value={form.reportedDate}
          onChange={(v) => set('reportedDate', v)}
        />
        <FieldError id="maintenanceReported-error" message={errors.reportedDate} />
      </div>

      <div className={fieldClass('field field-required', errors.description)}>
        <label htmlFor="maintenanceDescription">
          อาการ / สิ่งที่ต้องซ่อม <span className="required">* จำเป็น</span>
        </label>
        <textarea
          id="maintenanceDescription"
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="เช่น ก๊อกน้ำในห้องน้ำรั่ว / แอร์ไม่เย็น / หลอดไฟหน้าห้องขาด"
          {...invalidProps('maintenanceDescription', errors.description)}
        />
        <FieldError id="maintenanceDescription-error" message={errors.description} />
      </div>

      <div className={fieldClass('field', errors.appointmentDate)}>
        <label htmlFor="maintenanceAppointment">
          วันนัดช่าง
          <InfoTip
            title="ยังไม่ได้นัด?"
            points={['เว้นว่างได้ งานจะขึ้นเป็น “รอดำเนินการ”', 'มาใส่วันนัดทีหลังได้']}
          />
        </label>
        <DateField
          id="maintenanceAppointment"
          value={form.appointmentDate}
          onChange={(v) => set('appointmentDate', v)}
        />
        <FieldError id="maintenanceAppointment-error" message={errors.appointmentDate} />
      </div>

      <p className="field-hint">แนบรูปได้หลังบันทึก</p>
    </Modal>
  )
}

// ------------------------------------------------------------------
// รายละเอียดงาน
// ------------------------------------------------------------------
function MaintenanceDetail({ maintenanceId, onBack, onChanged }) {
  // หน้าต่างยืนยันก่อนลบ/ยกเลิก — ดู components/ConfirmDialog.jsx
  const [confirmDialog, ask] = useConfirm()
  const [request, setRequest] = useState(null)
  const [images, setImages] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState(null) // null | 'edit' | 'complete' | 'cancel' | 'delete'

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getMaintenance(maintenanceId)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setRequest(res.data)
  }, [maintenanceId])

  useEffect(() => {
    load()
  }, [load])

  // ดึงรูปทีละใบหลังรู้ว่ามี image_id อะไรบ้าง — ไม่ได้ส่งไบต์มากับตัวงาน
  // เพราะตารางรายการไม่ต้องใช้รูป และรูปหกใบต่องานคือข้อมูลก้อนใหญ่ที่สุดของหน้านี้
  useEffect(() => {
    if (!request) return
    let cancelled = false
    Promise.all(
      request.imageIds.map(async (imageId) => {
        const res = await getMaintenanceImage(imageId)
        return [imageId, res.success ? res.data.dataUrl : null]
      })
    ).then((pairs) => {
      if (!cancelled) setImages(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [request])

  async function attachImage() {
    setError('')
    setBusy(true)
    const res = await addMaintenanceImage(maintenanceId)
    setBusy(false)
    if (!res.success) return setError(res.error)
    if (res.data.cancelled) return
    showToast('แนบรูปแล้ว')
    setRequest(res.data.request)
  }

  function detachImage(imageId) {
    ask({
      title: 'ลบรูปนี้?',
      message: 'รูปจะหายจากงานซ่อมนี้ กู้คืนไม่ได้',
      confirmLabel: 'ลบรูป',
      onConfirm: async () => {
        const res = await removeMaintenanceImage(maintenanceId, imageId)
        if (res.success) setRequest(res.data)
        return res
      }
    })
  }

  async function reopen() {
    setError('')
    const res = await reopenMaintenance(maintenanceId)
    if (!res.success) return setError(res.error)
    showToast('เปิดงานนี้ใหม่แล้ว')
    setRequest(res.data)
    onChanged?.()
  }

  // เรียกจากหน้าต่างยืนยันเท่านั้น — ล้มเหลวคืนผลให้หน้าต่างแสดง error เอง
  async function removeRequest() {
    const res = await deleteMaintenance(maintenanceId)
    if (!res.success) return res
    setDialog(null)
    showToast('ลบงานแจ้งซ่อมแล้ว')
    onChanged?.()
    onBack()
  }

  return (
    <>
      <button type="button" className="link-btn link-back-inline" onClick={onBack}>
        <Icon name="back" />
        <span>กลับไปรายการแจ้งซ่อม</span>
      </button>

      <Alert>{error}</Alert>

      {loading ? (
        <p className="muted">กำลังโหลด...</p>
      ) : !request ? (
        <section className="panel">
          <div className="empty-state">
            <p>ไม่พบงานแจ้งซ่อมนี้</p>
          </div>
        </section>
      ) : (
        <>
          <h2 className="room-detail-title">
            งานซ่อม ห้อง {request.roomNumber} — {request.statusLabel}
          </h2>

          <section className="panel">
            <dl className="detail-list">
              <div>
                <dt>วันที่แจ้ง</dt>
                <dd>{formatDate(request.reportedDate)}</dd>
              </div>
              <div>
                <dt>ผู้เช่าปัจจุบัน</dt>
                <dd>{request.tenantName ?? 'ห้องว่าง'}</dd>
              </div>
              <div>
                <dt>วันนัดช่าง</dt>
                <dd>{request.appointmentDate ? formatDate(request.appointmentDate) : 'ยังไม่ได้นัด'}</dd>
              </div>
              {request.repairedDate && (
                <div>
                  <dt>ซ่อมเสร็จ</dt>
                  <dd>{formatDate(request.repairedDate)}</dd>
                </div>
              )}
              {request.repairCostCents !== null && (
                <div>
                  <dt>ค่าซ่อม</dt>
                  <dd>{formatBaht(request.repairCostCents)} บาท</dd>
                </div>
              )}
            </dl>

            {/* หัวข้อเล็กสีจาง + ข้อความปกติ แบบเดียวกับ วันที่แจ้ง/ผู้เช่า ข้างบน
                แยกจากแถวข้อมูลด้วยเส้นคั่น — เดิมหัวข้อหนาชิดแถวบนจนดูเป็นก้อนเดียวกัน */}
            <div className="maintenance-notes">
              <div>
                <h3>อาการที่แจ้ง</h3>
                <p>{request.description}</p>
              </div>
              {request.repairDetails && (
                <div>
                  <h3>บันทึกการซ่อม</h3>
                  <p>{request.repairDetails}</p>
                </div>
              )}
            </div>

            <div className="card-foot">
              {request.isOpen ? (
                <>
                  {/* ปุ่มยกเลิกแยกไปซ้ายสุด ห่างจากปุ่มปกติ — ปุ่มหลักอยู่ขวาสุดเสมอ */}
                  <button
                    type="button"
                    className="link-btn link-danger card-foot-start"
                    onClick={() => setDialog('cancel')}
                  >
                    ยกเลิกงาน
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setDialog('edit')}
                  >
                    แก้ไข / นัดช่าง
                  </button>
                  <button type="button" className="btn" onClick={() => setDialog('complete')}>
                    <Icon name="check" />
                    <span>ปิดงาน (ซ่อมเสร็จ)</span>
                  </button>
                </>
              ) : (
                <>
                  {/* ลบทิ้งจริงมีไว้สำหรับใบที่คีย์ผิดห้อง/คีย์ซ้ำ ไม่ใช่งานที่ทำเสร็จแล้ว —
                      ประวัติว่าห้องไหนซ่อมอะไรบ่อยคือของมีค่า */}
                  <button
                    type="button"
                    className="link-btn link-danger card-foot-start"
                    onClick={() => setDialog('delete')}
                  >
                    ลบรายการนี้ทิ้ง
                  </button>
                  <button type="button" className="btn btn-outline" onClick={reopen}>
                    เปิดงานนี้ใหม่
                  </button>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head-row">
              <h2 className="panel-title">รูปประกอบ ({request.imageIds.length})</h2>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={attachImage}
                disabled={busy}
              >
                <Icon name="plus" />
                <span>{busy ? 'กำลังแนบ...' : 'แนบรูป'}</span>
              </button>
            </div>

            {request.imageIds.length === 0 ? (
              <p className="muted">
                ยังไม่มีรูป
              </p>
            ) : (
              <div className="maintenance-images">
                {request.imageIds.map((imageId) => (
                  <figure key={imageId} className="maintenance-image">
                    {images[imageId] ? (
                      <img src={images[imageId]} alt="รูปประกอบการแจ้งซ่อม" />
                    ) : (
                      <span className="muted">กำลังโหลดรูป...</span>
                    )}
                    <button
                      type="button"
                      className="link-btn link-danger"
                      onClick={() => detachImage(imageId)}
                    >
                      ลบรูปนี้
                    </button>
                  </figure>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {dialog === 'edit' && request && (
        <EditDialog
          request={request}
          onClose={() => setDialog(null)}
          onSaved={(updated) => {
            setDialog(null)
            showToast('บันทึกแล้ว')
            setRequest(updated)
            onChanged?.()
          }}
        />
      )}

      {dialog === 'complete' && request && (
        <CompleteDialog
          request={request}
          onClose={() => setDialog(null)}
          onSaved={(updated) => {
            setDialog(null)
            showToast('ปิดงานซ่อมแล้ว')
            setRequest(updated)
            onChanged?.()
          }}
        />
      )}

      {confirmDialog}

      {dialog === 'delete' && request && (
        <ConfirmDialog
          title={`ลบงานซ่อม ห้อง ${request.roomNumber}`}
          message="ลบถาวร กู้คืนไม่ได้ · ใช้กับรายการที่คีย์ผิดหรือซ้ำเท่านั้น"
          confirmLabel="ลบรายการ"
          onConfirm={removeRequest}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'cancel' && request && (
        <CancelDialog
          request={request}
          onClose={() => setDialog(null)}
          onSaved={(updated) => {
            setDialog(null)
            showToast('ยกเลิกงานซ่อมแล้ว')
            setRequest(updated)
            onChanged?.()
          }}
        />
      )}
    </>
  )
}

// ------------------------------------------------------------------
const EDIT_FIELDS = ['reportedDate', 'description', 'appointmentDate']

function EditDialog({ request, onClose, onSaved }) {
  const [form, setForm] = useState({
    reportedDate: request.reportedDate,
    description: request.description,
    appointmentDate: request.appointmentDate ?? ''
  })
  const [busy, setBusy] = useState(false)
  const { errors, formError, fromResult, clear, reset } = useFormErrors(EDIT_FIELDS)

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    clear(key)
  }

  async function submit() {
    reset()
    setBusy(true)
    const res = await updateMaintenance({
      maintenanceId: request.maintenanceId,
      reportedDate: form.reportedDate,
      description: form.description,
      appointmentDate: form.appointmentDate || null
    })
    setBusy(false)
    if (!res.success) return fromResult(res)
    onSaved(res.data)
  }

  return (
    <Modal
      title={`แก้ไขงานซ่อม ห้อง ${request.roomNumber}`}
      icon="maintenance"
      busy={busy}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className={fieldClass('field field-required', errors.reportedDate)}>
        <label htmlFor="editReported">
          วันที่แจ้ง <span className="required">* จำเป็น</span>
        </label>
        <DateField
          id="editReported"
          value={form.reportedDate}
          onChange={(v) => set('reportedDate', v)}
        />
        <FieldError id="editReported-error" message={errors.reportedDate} />
      </div>

      <div className={fieldClass('field field-required', errors.description)}>
        <label htmlFor="editDescription">
          อาการ / สิ่งที่ต้องซ่อม <span className="required">* จำเป็น</span>
        </label>
        <textarea
          id="editDescription"
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          {...invalidProps('editDescription', errors.description)}
        />
        <FieldError id="editDescription-error" message={errors.description} />
      </div>

      <div className={fieldClass('field', errors.appointmentDate)}>
        <label htmlFor="editAppointment">
          วันนัดช่าง
          <InfoTip
            title="วันนัดเปลี่ยนสถานะงาน"
            points={['ใส่วันนัด → “นัดช่างแล้ว”', 'ลบวันนัด → “รอดำเนินการ”']}
          />
        </label>
        <DateField
          id="editAppointment"
          value={form.appointmentDate}
          onChange={(v) => set('appointmentDate', v)}
        />
        <FieldError id="editAppointment-error" message={errors.appointmentDate} />
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
const COMPLETE_FIELDS = ['repairedDate', 'repairCost']

function CompleteDialog({ request, onClose, onSaved }) {
  const [form, setForm] = useState({
    repairedDate: todayIso(),
    repairCost: request.repairCostCents === null ? '' : centsToInput(request.repairCostCents),
    repairDetails: ''
  })
  const [busy, setBusy] = useState(false)
  const { errors, formError, fromResult, clear, reset } = useFormErrors(COMPLETE_FIELDS)

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    clear(key)
  }

  async function submit() {
    reset()
    setBusy(true)
    const res = await completeMaintenance({
      maintenanceId: request.maintenanceId,
      repairedDate: form.repairedDate,
      repairCost: form.repairCost,
      repairDetails: form.repairDetails
    })
    setBusy(false)
    if (!res.success) return fromResult(res)
    onSaved(res.data)
  }

  return (
    <Modal
      title={`ปิดงานซ่อม ห้อง ${request.roomNumber}`}
      icon="check"
      submitLabel="ปิดงาน"
      busy={busy}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className={fieldClass('field field-required', errors.repairedDate)}>
        <label htmlFor="repairedDate">
          วันที่ซ่อมเสร็จ <span className="required">* จำเป็น</span>
        </label>
        <DateField
          id="repairedDate"
          value={form.repairedDate}
          onChange={(v) => set('repairedDate', v)}
        />
        <FieldError id="repairedDate-error" message={errors.repairedDate} />
      </div>

      <div className={fieldClass('field', errors.repairCost)}>
        <label htmlFor="repairCost">
          ค่าซ่อม (บาท)
          <InfoTip
            title="ค่าซ่อม"
            points={['เว้นว่าง = ยังไม่รู้ยอด', 'กรอก 0 = ซ่อมแล้วไม่มีค่าใช้จ่าย']}
          />
        </label>
        <input
          id="repairCost"
          type="text"
          inputMode="decimal"
          value={form.repairCost}
          onChange={(e) => set('repairCost', e.target.value)}
          {...invalidProps('repairCost', errors.repairCost)}
        />
        <FieldError id="repairCost-error" message={errors.repairCost} />
        {/* เว้นว่าง ≠ 0 — ช่องว่างแปลว่ายังไม่รู้ค่าซ่อม ส่วน 0 แปลว่าซ่อมแล้วไม่เสียเงิน
            ถ้าเหมาช่องว่างเป็น 0 ยอดรวมค่าซ่อมของหอจะดูน้อยกว่าความจริงตลอดไป */}
      </div>

      <div className="field">
        <label htmlFor="repairDetails">บันทึกการซ่อม</label>
        <textarea
          id="repairDetails"
          rows={3}
          value={form.repairDetails}
          onChange={(e) => set('repairDetails', e.target.value)}
          placeholder="เช่น เปลี่ยนสายชำระใหม่ / ล้างแอร์และเติมน้ำยา"
        />
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// ไม่มีช่องไหนที่ main ตรวจ — error ทุกตัว (เช่น งานถูกปิดไปแล้ว) ขึ้นบนสุดของหน้าต่าง
function CancelDialog({ request, onClose, onSaved }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    setBusy(true)
    const res = await cancelMaintenance(request.maintenanceId, reason)
    setBusy(false)
    if (!res.success) return setError(res.error)
    onSaved(res.data)
  }

  return (
    <Modal
      title={`ยกเลิกงานซ่อม ห้อง ${request.roomNumber}`}
      icon="close"
      submitLabel="ยืนยันยกเลิกงาน"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert kind="warn">
        งานจะไม่ถูกลบ ยังดูประวัติย้อนหลังได้
      </Alert>

      <div className="field">
        <label htmlFor="cancelMaintenanceReason">เหตุผล</label>
        <input
          id="cancelMaintenanceReason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เช่น ผู้เช่าแจ้งว่าหายเองแล้ว / แจ้งซ้ำกับใบก่อนหน้า"
        />
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
function formatDate(value) {
  if (!value) return '-'
  const [y, m, d] = String(value).split('-')
  return `${d}/${m}/${y}`
}

function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
