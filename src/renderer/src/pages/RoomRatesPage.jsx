import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import Modal from '../components/Modal.jsx'
import { formatBaht } from '../format.js'
import { ROOM_STATUSES, ROOM_STATUS_LABELS } from '../constants.js'
import {
  attachServices,
  detachServices,
  listFloors,
  setRoomRates,
  setRoomStatus
} from '../services/roomService.js'
import { listServices } from '../services/apartmentServiceService.js'

// ขั้นที่ 6-8 ของการตั้งค่าหอ — ค่าห้อง / สถานะห้อง / ค่าบริการรายห้อง
//
// สามเรื่องนี้อยู่ไฟล์เดียวกันเพราะวิธีใช้เหมือนกันเป๊ะตามต้นแบบ: เลือกห้อง (ทีละห้อง
// หรือทั้งชั้น) → กดปุ่มที่แถบล่าง → กรอกค่าในหน้าต่างซ้อน → สั่งทีเดียวทุกห้องที่เลือก
// หอ 40 ห้องส่วนใหญ่ราคาเท่ากันหมด ถ้าให้กรอกทีละห้องคือพิมพ์เลขเดิม 40 รอบ
//
// only: ล็อกไว้โหมดเดียวและซ่อนแท็บ ใช้ตอนอยู่ใน wizard ที่แยกเป็นคนละขั้นตามต้นแบบ
const MODES = {
  rate: { tab: 'ตั้งค่าห้อง', action: 'ระบุค่าห้อง' },
  status: { tab: 'ตั้งสถานะห้อง', action: null }, // สถานะกดปุ่มตรงๆ ไม่ต้องเปิดหน้าต่าง
  services: { tab: 'ค่าบริการรายห้อง', action: 'เพิ่มค่าบริการ' }
}

export default function RoomRatesPage({ apartment, only }) {
  const [floors, setFloors] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  // แท็บใช้เฉพาะตอนเปิดหน้านี้เดี่ยวๆ จากเมนูตั้งค่า ส่วนใน wizard โหมดมาจาก prop `only`
  // ห้ามเอา `only` ไปตั้งเป็นค่าเริ่มต้นของ useState เด็ดขาด — ค่าเริ่มต้นถูกอ่านครั้งเดียว
  // ตอน mount แรก พอ wizard เปลี่ยนขั้นแล้วส่ง only ใหม่มา state จะยังค้างค่าเก่า
  const [tab, setTab] = useState('rate')
  const mode = only ?? tab
  const [error, setError] = useState('')
  const [catalogue, setCatalogue] = useState([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [floorRes, serviceRes] = await Promise.all([
      listFloors(apartment.apartmentId),
      listServices(apartment.apartmentId)
    ])
    if (!floorRes.success) return setError(floorRes.error)
    setError('')
    setFloors(floorRes.data)
    if (serviceRes.success) setCatalogue(serviceRes.data)
  }, [apartment.apartmentId])

  useEffect(() => {
    load()
  }, [load])

  // error ของหน้าต่างขึ้นในหน้าต่างเอง (ส่ง error ลงไป) — ปิดแล้วล้าง ไม่ให้ค้างบนหน้า
  function closeDialog() {
    setDialogOpen(false)
    setError('')
  }

  async function act(fn) {
    setError('')
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (!res.success) return setError(res.error)
    setFloors(res.data)
    setDialogOpen(false)
    // ล้างการเลือกหลังสั่งสำเร็จ กันการกดซ้ำโดยไม่ตั้งใจกับชุดเดิม
    setSelected(new Set())
  }

  function toggleRoom(roomId) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(roomId) ? next.delete(roomId) : next.add(roomId)
      return next
    })
  }

  function toggleFloor(floor, select) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const room of floor.rooms) {
        select ? next.add(room.roomId) : next.delete(room.roomId)
      }
      return next
    })
  }

  if (floors === null) return <p className="muted">กำลังโหลด...</p>

  if (floors.length === 0) {
    return (
      <section className="panel empty-state">
        <h2>ยังไม่มีผังห้อง</h2>
        <p className="muted">สร้างผังห้องก่อนที่ ตั้งค่า → ผังห้อง</p>
      </section>
    )
  }

  const roomIds = [...selected]

  return (
    <>
      <Alert>{error}</Alert>

      {!only && (
        <nav className="mode-tabs">
          {Object.entries(MODES).map(([key, m]) => (
            <button
              key={key}
              type="button"
              className={'mode-tab' + (mode === key ? ' active' : '')}
              onClick={() => {
                setTab(key)
                setSelected(new Set())
              }}
            >
              {m.tab}
            </button>
          ))}
        </nav>
      )}

      {floors.map((floor) => {
        const allSelected =
          floor.rooms.length > 0 && floor.rooms.every((r) => selected.has(r.roomId))
        return (
          <section className="floor-group" key={floor.floorId}>
            <header className="floor-group-head">
              <h3 className="floor-group-title">{floor.floorName}</h3>
              <div className="floor-group-tools">
                <button
                  type="button"
                  className="btn-outline"
                  disabled={floor.rooms.length === 0 || allSelected}
                  onClick={() => toggleFloor(floor, true)}
                >
                  <Icon name="check" />
                  <span>เลือกทั้งชั้น</span>
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={!floor.rooms.some((r) => selected.has(r.roomId))}
                  onClick={() => toggleFloor(floor, false)}
                >
                  <Icon name="minusCircle" />
                  <span>ยกเลิกเลือกทั้งชั้น</span>
                </button>
              </div>
            </header>

            <div className="floor-group-body">
              <div className="room-cards">
                {floor.rooms.map((room) => (
                  <button
                    type="button"
                    key={room.roomId}
                    className={'room-card' + (selected.has(room.roomId) ? ' selected' : '')}
                    onClick={() => toggleRoom(room.roomId)}
                  >
                    <span className="room-card-number">ห้อง {room.roomNumber}</span>
                    <RoomCardDetail mode={mode} room={room} />
                  </button>
                ))}
              </div>
            </div>
          </section>
        )
      })}

      {/* หอที่ไม่มีค่าบริการเลยข้ามขั้นนี้ได้ ไม่ต้องกลับไปกรอกขั้นที่ 1 ก่อน
          ต้นแบบก็ไม่บังคับ — หอหลายแห่งไม่มีค่าบริการเพิ่มเติมอะไรเลยจริงๆ */}
      {mode === 'services' && catalogue.length === 0 && (
        <p className="muted step-optional">
          หอพักนี้ยังไม่มีค่าบริการเพิ่มเติม — ข้ามขั้นนี้ได้เลย
          หรือกลับไปเพิ่มที่ขั้นตอนที่ 1 "ค่าบริการ" ถ้าต้องการ
        </p>
      )}

      <div className="select-bar">
        <span className="select-bar-count">
          {mode === 'status' ? 'เลือก' : 'จำนวนห้องที่เลือก'}
          <strong>{roomIds.length}</strong>
          ห้อง
        </span>

        {mode === 'status' ? (
          // สถานะมีไม่กี่ค่า ต้นแบบจึงวางเป็นปุ่มตรงๆ ไม่ต้องเปิดหน้าต่างให้เสียจังหวะ
          ROOM_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className="btn"
              disabled={roomIds.length === 0 || busy}
              onClick={() => act(() => setRoomStatus(roomIds, status))}
            >
              {ROOM_STATUS_LABELS[status]}
            </button>
          ))
        ) : (
          <button
            type="button"
            className="btn"
            // ขั้นค่าบริการรายห้องข้ามได้ ถ้าหอนี้ไม่มีค่าบริการเลย (ต้นแบบก็ไม่บังคับ)
            disabled={roomIds.length === 0 || (mode === 'services' && catalogue.length === 0)}
            onClick={() => setDialogOpen(true)}
          >
            {MODES[mode].action}
          </button>
        )}
      </div>

      {dialogOpen && mode === 'rate' && (
        <RateDialog
          busy={busy}
          error={error}
          onClose={closeDialog}
          onSubmit={(values) => act(() => setRoomRates(roomIds, values))}
        />
      )}

      {dialogOpen && mode === 'services' && (
        <ServiceDialog
          catalogue={catalogue}
          rooms={floors.flatMap((f) => f.rooms).filter((r) => selected.has(r.roomId))}
          busy={busy}
          error={error}
          onClose={closeDialog}
          onSubmit={(serviceId) => act(() => attachServices(roomIds, [serviceId]))}
          onDetach={(serviceId) => act(() => detachServices(roomIds, [serviceId]))}
        />
      )}
    </>
  )
}

// รายละเอียดใต้เลขห้อง เปลี่ยนตามขั้นที่กำลังอยู่ — ค่าเช่า / สถานะ / ค่าบริการที่ผูกไว้
function RoomCardDetail({ mode, room }) {
  if (mode === 'rate') {
    return (
      <span className="room-card-lines">
        <span className="room-card-line">
          <span>รายเดือน:</span>
          <span>{formatBaht(room.monthlyRentCents)} บาท</span>
        </span>
        <span className="room-card-line">
          <span>รายวัน:</span>
          <span>{room.dailyRentCents === null ? 'ไม่รับ' : `${formatBaht(room.dailyRentCents)} บาท`}</span>
        </span>
      </span>
    )
  }

  if (mode === 'status') {
    return (
      <span className="room-card-badge">
        <span className={`room-badge status-${room.status}`}>
          {ROOM_STATUS_LABELS[room.status] ?? room.status}
        </span>
      </span>
    )
  }

  return (
    <span className="room-card-note">
      {room.services.length === 0 ? 'ไม่มีค่าบริการ' : room.services.map((s) => s.name).join(', ')}
    </span>
  )
}

// -----------------------------------------------------
// หน้าต่างซ้อน
// -----------------------------------------------------
function RateDialog({ onClose, onSubmit, busy, error }) {
  const [monthlyRent, setMonthlyRent] = useState('')
  const [dailyRent, setDailyRent] = useState('')

  return (
    <Modal
      title="ระบุค่าห้อง"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={() => onSubmit({ monthlyRent, dailyRent })}
    >
      <div className="field field-required">
        <label htmlFor="monthlyRent">
          ราคาค่าเช่ารายเดือน <span className="required">* จำเป็น</span>
        </label>
        <div className="input-with-suffix">
          <input
            id="monthlyRent"
            value={monthlyRent}
            onChange={(e) => setMonthlyRent(e.target.value)}
            inputMode="decimal"
            autoFocus
          />
          <span className="input-suffix">บาท / เดือน</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="dailyRent">ราคาค่าเช่ารายวัน</label>
        <div className="input-with-suffix">
          <input
            id="dailyRent"
            value={dailyRent}
            onChange={(e) => setDailyRent(e.target.value)}
            inputMode="decimal"
          />
          <span className="input-suffix">บาท / วัน</span>
        </div>
      </div>
    </Modal>
  )
}

// รายการในช่องเลือกมาจากค่าบริการที่กรอกไว้ในขั้นที่ 1 ของหอนี้ (apartment_services)
// ไม่ใช่รายการตายตัว — ตั้งชื่ออะไรไว้ที่ขั้นแรกก็เห็นอันนั้นที่นี่
//
// ต้นแบบมีแค่ปุ่ม "บันทึก" (เพิ่มอย่างเดียว) แต่เราเพิ่ม "นำออก" ไว้ด้วย ไม่งั้น
// ผูกผิดห้องแล้วแก้ไม่ได้เลย — ยังไม่มีหน้าอื่นในระบบที่ถอดค่าบริการออกจากห้องได้
//
// ช่องเลือกโชว์เฉพาะบริการที่ยัง "เพิ่มได้" (โอ๊คสั่ง 2026-09-25 ลดการกดซ้ำ)
//   · ทุกห้องที่เลือกมีแล้ว → ไม่อยู่ในช่องเลือก ไปอยู่ในรายการ "ผูกอยู่แล้ว" ข้างล่างแทน
//   · มีแค่บางห้อง → ยังเลือกได้ (เติมให้ห้องที่ยังขาด) และบอกว่ามีแล้วกี่ห้อง
// การนำออกย้ายมาเป็นปุ่มรายบริการในรายการ "ผูกอยู่แล้ว" — เดิมอาศัยช่องเลือกเดียวกัน
// ถ้าซ่อนบริการที่มีครบแล้วจากช่องเลือก จะไม่มีทางนำออกได้เลย
function ServiceDialog({ catalogue, rooms, onClose, onSubmit, onDetach, busy, error }) {
  const [serviceId, setServiceId] = useState('')

  const total = rooms.length
  const countOf = (id) => rooms.filter((r) => r.services.some((s) => s.serviceId === id)).length
  const withCount = catalogue.map((s) => ({ ...s, count: countOf(s.serviceId) }))
  const addable = withCount.filter((s) => s.count < total)
  const attached = withCount.filter((s) => s.count > 0)

  return (
    <Modal
      title="ระบุค่าบริการเพิ่มเติม"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={() => serviceId && onSubmit(Number(serviceId))}
    >
      <div className="field field-required">
        <label htmlFor="serviceId">
          บริการ <span className="required">* จำเป็น</span>
        </label>
        {addable.length === 0 ? (
          <p className="muted">ห้องที่เลือกมีครบทุกบริการแล้ว</p>
        ) : (
          <select
            id="serviceId"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            autoFocus
          >
            <option value="">เลือกค่าบริการ</option>
            {addable.map((s) => (
              // <option> รับได้แค่ข้อความล้วน — ประกอบเป็นสตริงเดียว ไม่ใช้ `cond && ...` ในนี้
              <option key={s.serviceId} value={s.serviceId}>
                {`${s.name} (${formatBaht(s.priceCents)} บาท)` +
                  (s.count > 0 ? ` · มีแล้ว ${s.count}/${total} ห้อง` : '')}
              </option>
            ))}
          </select>
        )}
      </div>

      {attached.length > 0 && (
        <div className="service-attached">
          <h4 className="service-attached-title">ผูกอยู่แล้ว</h4>
          <ul className="service-attached-list">
            {attached.map((s) => (
              <li key={s.serviceId}>
                <span>
                  {s.name}
                  {s.count < total && (
                    <span className="muted"> · {s.count}/{total} ห้อง</span>
                  )}
                </span>
                <button
                  type="button"
                  className="link-btn link-danger"
                  disabled={busy}
                  onClick={() => onDetach(s.serviceId)}
                >
                  นำออก
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}
