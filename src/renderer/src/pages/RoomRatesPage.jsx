import React, { useCallback, useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
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

// ขั้นที่ 6-7 ของการตั้งค่าหอ — ค่าห้อง และสถานะห้อง
//
// สองเรื่องนี้อยู่หน้าเดียวกันเพราะใช้วิธีเดียวกันเป๊ะ: ติ๊กเลือกห้อง แล้วสั่งทีเดียว
// หอ 40 ห้องส่วนใหญ่ราคาเท่ากันหมด ถ้าให้กรอกทีละห้องคือพิมพ์เลขเดิม 40 รอบ
// (ต้นแบบแยกเป็นสองขั้น แต่หน้าจอเหมือนกันจนไม่มีเหตุผลให้เขียนซ้ำสองไฟล์)
// only: ล็อกไว้โหมดเดียวและซ่อนแท็บ ใช้ตอนอยู่ใน wizard ที่แยกเป็นคนละขั้นตามต้นแบบ
export default function RoomRatesPage({ apartment, only }) {
  const [floors, setFloors] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  // แท็บใช้เฉพาะตอนเปิดหน้านี้เดี่ยวๆ จากเมนูตั้งค่า ส่วนใน wizard โหมดมาจาก prop `only`
  // ห้ามเอา `only` ไปตั้งเป็นค่าเริ่มต้นของ useState เด็ดขาด — ค่าเริ่มต้นถูกอ่านครั้งเดียว
  // ตอน mount แรก พอ wizard เปลี่ยนขั้นแล้วส่ง only ใหม่มา state จะยังค้างค่าเก่า
  const [tab, setTab] = useState('rate') // rate | status | services
  const mode = only ?? tab
  const [error, setError] = useState('')
  const [monthlyRent, setMonthlyRent] = useState('')
  const [dailyRent, setDailyRent] = useState('')
  const [catalogue, setCatalogue] = useState([])
  const [pickedServices, setPickedServices] = useState(() => new Set())

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

  async function act(fn) {
    setError('')
    const res = await fn()
    if (!res.success) return setError(res.error)
    setFloors(res.data)
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
        <p className="muted">กรุณาสร้างผังห้องที่หัวข้อ "จัดการชั้นและห้องพัก" ก่อน</p>
      </section>
    )
  }

  const roomIds = [...selected]

  return (
    <>
      <div className="info-banner">
        <strong>ค่าห้องและสถานะห้อง</strong>
        <p>เลือกห้องที่ต้องการ (เลือกทั้งชั้นได้) แล้วตั้งค่าพร้อมกันทีเดียว</p>
      </div>

      <Alert>{error}</Alert>

      {!only && (
        <nav className="mode-tabs">
          <button
            type="button"
            className={'mode-tab' + (mode === 'rate' ? ' active' : '')}
            onClick={() => setTab('rate')}
          >
            ตั้งค่าห้อง
          </button>
          <button
            type="button"
            className={'mode-tab' + (mode === 'status' ? ' active' : '')}
            onClick={() => setTab('status')}
          >
            ตั้งสถานะห้อง
          </button>
          <button
            type="button"
            className={'mode-tab' + (mode === 'services' ? ' active' : '')}
            onClick={() => setTab('services')}
          >
            ค่าบริการรายห้อง
          </button>
        </nav>
      )}

      {floors.map((floor) => {
        const allSelected = floor.rooms.length > 0 && floor.rooms.every((r) => selected.has(r.roomId))
        return (
          <section className="panel floor-card" key={floor.floorId}>
            <header className="floor-card-head">
              <h3 className="floor-title">{floor.floorName}</h3>
              <button
                type="button"
                className="link-btn"
                onClick={() => toggleFloor(floor, !allSelected)}
              >
                {allSelected ? 'ยกเลิกเลือกทั้งชั้น' : 'เลือกทั้งชั้น'}
              </button>
            </header>

            <div className="room-grid">
              {floor.rooms.map((room) => (
                <button
                  type="button"
                  key={room.roomId}
                  className={'room-chip selectable' + (selected.has(room.roomId) ? ' selected' : '')}
                  onClick={() => toggleRoom(room.roomId)}
                >
                  <span className="room-chip-number">{room.roomNumber}</span>
                  {mode === 'rate' ? (
                    <>
                      <span className="room-chip-type">
                        รายเดือน: {formatBaht(room.monthlyRentCents)}
                      </span>
                      <span className="room-chip-type">
                        รายวัน:{' '}
                        {room.dailyRentCents === null ? 'ไม่รับ' : formatBaht(room.dailyRentCents)}
                      </span>
                    </>
                  ) : mode === 'status' ? (
                    <span className={`status-badge status-${room.status}`}>
                      {ROOM_STATUS_LABELS[room.status] ?? room.status}
                    </span>
                  ) : room.services.length === 0 ? (
                    <span className="room-chip-type">ไม่มีค่าบริการ</span>
                  ) : (
                    <span className="room-chip-type">
                      {room.services.map((s) => s.name).join(', ')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )
      })}

      {/* แถบล่างค้างจอ บอกจำนวนที่เลือกและปุ่มลงมือ — ตามต้นแบบ
          ผู้ใช้เลื่อนดูห้องได้เรื่อยๆ โดยไม่ต้องเลื่อนกลับขึ้นไปกดปุ่ม */}
      <div className="bulk-bar">
        <span className="bulk-count">
          เลือกแล้ว <strong>{roomIds.length}</strong> ห้อง
        </span>

        {mode === 'rate' ? (
          <div className="bulk-fields">
            <div className="input-with-suffix">
              <input
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value)}
                placeholder="ค่าเช่ารายเดือน"
                inputMode="decimal"
                aria-label="ค่าเช่ารายเดือน"
              />
              <span className="input-suffix">บาท/เดือน</span>
            </div>
            <div className="input-with-suffix">
              <input
                value={dailyRent}
                onChange={(e) => setDailyRent(e.target.value)}
                placeholder="ค่าเช่ารายวัน (ไม่บังคับ)"
                inputMode="decimal"
                aria-label="ค่าเช่ารายวัน"
              />
              <span className="input-suffix">บาท/วัน</span>
            </div>
            <button
              type="button"
              className="btn"
              disabled={roomIds.length === 0}
              onClick={() => act(() => setRoomRates(roomIds, { monthlyRent, dailyRent }))}
            >
              ระบุค่าห้อง
            </button>
          </div>
        ) : mode === 'status' ? (
          <div className="bulk-fields">
            {ROOM_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className="btn"
                disabled={roomIds.length === 0}
                onClick={() => act(() => setRoomStatus(roomIds, status))}
              >
                {ROOM_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        ) : (
          <div className="bulk-fields">
            {catalogue.length === 0 ? (
              <span className="muted">
                ยังไม่มีค่าบริการในหอพักนี้ — เพิ่มได้ที่หัวข้อ "ค่าบริการ"
              </span>
            ) : (
              <>
                <div className="service-picker">
                  {catalogue.map((s) => (
                    <label key={s.serviceId} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={pickedServices.has(s.serviceId)}
                        onChange={() =>
                          setPickedServices((prev) => {
                            const next = new Set(prev)
                            next.has(s.serviceId)
                              ? next.delete(s.serviceId)
                              : next.add(s.serviceId)
                            return next
                          })
                        }
                      />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={roomIds.length === 0 || pickedServices.size === 0}
                  onClick={() => act(() => attachServices(roomIds, [...pickedServices]))}
                >
                  เพิ่มค่าบริการ
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={roomIds.length === 0 || pickedServices.size === 0}
                  onClick={() => act(() => detachServices(roomIds, [...pickedServices]))}
                >
                  นำออก
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
