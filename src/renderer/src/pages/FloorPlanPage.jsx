import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import ToggleSwitch from '../components/ToggleSwitch.jsx'
import { MAX_FLOORS, MAX_ROOMS_PER_FLOOR } from '../constants.js'
import {
  addFloor,
  addRoom,
  deleteFloor,
  deleteRoom,
  generateFloorPlan,
  listFloors,
  renameFloor,
  updateRoom
} from '../services/roomService.js'

// ขั้นที่ 4-5 ของการตั้งค่าหอ — จัดการชั้น แล้วได้ผังห้องออกมา
//
// หอที่ยังไม่มีชั้นเลยจะเห็น "ตัวสร้างผังห้อง" (เลือกจำนวนชั้น แล้วกรอกจำนวนห้องต่อชั้น)
// ระบบสร้างเลขห้องให้อัตโนมัติ 101/102/201/202 — เจ้าของหอ 40 ห้องไม่ต้องพิมพ์ทีละห้อง
// พอมีผังแล้วหน้าจะเปลี่ยนเป็นโหมดแก้ไข เพิ่ม/ลบ/แก้รายห้องได้
// stage: ใช้ตอนอยู่ใน wizard ที่แยกขั้น "จัดการชั้น" กับ "ผังห้อง" ออกจากกันตามต้นแบบ
//   builder = ขั้นกำหนดจำนวนชั้น/ห้อง (ถ้าสร้างไปแล้วแสดงสรุปแทน)
//   editor  = ขั้นแก้ผังห้องที่ได้มา
//   ไม่ระบุ = แสดงตามสถานะจริง (ใช้ในหน้าตั้งค่าปกติ)
export default function FloorPlanPage({ apartment, stage }) {
  const [floors, setFloors] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await listFloors(apartment.apartmentId)
    if (!res.success) return setError(res.error)
    setError('')
    setFloors(res.data)
  }, [apartment.apartmentId])

  useEffect(() => {
    load()
  }, [load])

  // ทุกคำสั่งคืนผังทั้งก้อนกลับมา จึงเอามาแทนของเดิมได้เลย ไม่ต้องโหลดใหม่
  async function act(fn) {
    setError('')
    const res = await fn()
    if (!res.success) return setError(res.error)
    setFloors(res.data)
  }

  if (floors === null) return <p className="muted">กำลังโหลด...</p>

  return (
    <>
      <div className="info-banner">
        <strong>ผังห้องพัก</strong>
        <p>
          ระบุจำนวนชั้นและจำนวนห้องในแต่ละชั้น ระบบจะตั้งเลขห้องให้อัตโนมัติ (101, 102, 201, ...)
          แก้ไขทีหลังได้ทุกห้อง
        </p>
      </div>

      <Alert>{error}</Alert>

      {floors.length === 0 ? (
        <FloorPlanBuilder
          onGenerate={(specs) => act(() => generateFloorPlan(apartment.apartmentId, specs))}
        />
      ) : stage === 'builder' ? (
        // ขั้น "จัดการชั้น" ที่สร้างผังไปแล้ว — สรุปให้ดูแล้วให้กดต่อไป
        // ไม่แสดงตัวสร้างซ้ำ เพราะสร้างได้ครั้งเดียว (ฝั่ง main กันไว้)
        <section className="panel">
          <p className="muted">
            สร้างผังห้องแล้ว — {floors.length} ชั้น{' '}
            {floors.reduce((sum, f) => sum + f.rooms.length, 0)} ห้อง
            <br />
            กด "ต่อไป" เพื่อตรวจและแก้ไขผังห้องรายห้อง
          </p>
        </section>
      ) : (
        <FloorPlanEditor
          floors={floors}
          apartmentId={apartment.apartmentId}
          act={act}
        />
      )}
    </>
  )
}

// -----------------------------------------------------
// โหมดสร้างครั้งแรก
// -----------------------------------------------------
function FloorPlanBuilder({ onGenerate }) {
  const [floorCount, setFloorCount] = useState('')
  const [roomCounts, setRoomCounts] = useState([])
  const [busy, setBusy] = useState(false)

  function changeFloorCount(value) {
    setFloorCount(value)
    const count = Number(value)
    if (!Number.isInteger(count) || count < 1) return setRoomCounts([])
    // คงค่าที่กรอกไว้แล้วเมื่อเพิ่ม/ลดจำนวนชั้น ไม่ล้างทิ้งทั้งหมด
    setRoomCounts((prev) => Array.from({ length: count }, (_, i) => prev[i] ?? ''))
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    await onGenerate(roomCounts.map((count) => ({ roomCount: Number(count) })))
    setBusy(false)
  }

  return (
    <section className="panel">
      <form onSubmit={submit}>
        <div className="field field-narrow">
          <label htmlFor="floorCount">
            จำนวนชั้น <span className="required">* จำเป็น</span>
          </label>
          <select id="floorCount" value={floorCount} onChange={(e) => changeFloorCount(e.target.value)}>
            <option value="">เลือกจำนวนชั้น</option>
            {Array.from({ length: MAX_FLOORS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {roomCounts.length > 0 && (
          <>
            <hr className="divider" />
            <div className="floor-count-grid">
              {roomCounts.map((value, index) => (
                <div className="floor-count-row" key={index}>
                  <label htmlFor={`floor-${index}`}>ชั้นที่ {index + 1}</label>
                  <input
                    id={`floor-${index}`}
                    value={value}
                    inputMode="numeric"
                    onChange={(e) => {
                      const next = [...roomCounts]
                      next[index] = e.target.value
                      setRoomCounts(next)
                    }}
                  />
                  <span className="unit">ห้อง</span>
                </div>
              ))}
            </div>
            <p className="field-hint">สูงสุด {MAX_ROOMS_PER_FLOOR} ห้องต่อชั้น</p>

            <div className="form-actions">
              <button type="submit" className="btn" disabled={busy}>
                {busy ? 'กำลังสร้าง...' : 'สร้างผังห้อง'}
              </button>
            </div>
          </>
        )}
      </form>
    </section>
  )
}

// -----------------------------------------------------
// โหมดแก้ไข
// -----------------------------------------------------
function FloorPlanEditor({ floors, apartmentId, act }) {
  const totalRooms = floors.reduce((sum, f) => sum + f.rooms.length, 0)

  return (
    <>
      <p className="muted plan-summary">
        ทั้งหมด {floors.length} ชั้น {totalRooms} ห้อง
      </p>

      {floors.map((floor) => (
        <FloorCard key={floor.floorId} floor={floor} act={act} />
      ))}

      {/* ปุ่มเต็มความกว้างปิดท้ายรายการชั้น ตามต้นแบบ — ชั้นใหม่เกิดมาว่างเปล่า
          แล้วค่อยกด "เพิ่มห้อง" ในชั้นนั้น ไม่ต้องกรอกจำนวนห้องล่วงหน้า */}
      <button
        type="button"
        className="btn btn-block plan-add-floor"
        onClick={() => act(() => addFloor(apartmentId, { roomCount: 0 }))}
      >
        เพิ่มชั้น
      </button>
    </>
  )
}

// การ์ดหนึ่งใบต่อหนึ่งชั้น — หัวการ์ดพื้นเทาที่แก้ชื่อชั้นได้ในตัว แล้วห้องเรียงเป็นแถว
// ห้องละบรรทัด (เลขห้อง / ประเภทห้อง / สวิตช์เปิดใช้งาน) ตามต้นแบบ
function FloorCard({ floor, act }) {
  const [name, setName] = useState(floor.floorName)

  return (
    <section className="plan-floor">
      <header className="plan-floor-head">
        <label htmlFor={`floor-name-${floor.floorId}`}>ชั้น</label>
        <input
          id={`floor-name-${floor.floorId}`}
          className="plan-floor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== floor.floorName && act(() => renameFloor(floor.floorId, name))}
        />
        {/* ปุ่มลบชั้นโผล่เฉพาะชั้นที่ไม่มีห้องแล้ว — ฝั่ง main กันไว้อีกชั้นพร้อมข้อความอธิบาย */}
        {floor.rooms.length === 0 && (
          <button
            type="button"
            className="link-btn link-danger plan-floor-delete"
            onClick={() => act(() => deleteFloor(floor.floorId))}
          >
            ลบชั้นนี้
          </button>
        )}
      </header>

      <div className="plan-floor-body">
        {floor.rooms.map((room) => (
          <RoomRow key={room.roomId} room={room} act={act} />
        ))}

        <hr className="divider" />

        <button
          type="button"
          className="btn-outline"
          onClick={() => act(() => addRoom(floor.floorId, {}))}
        >
          เพิ่มห้อง
        </button>
      </div>
    </section>
  )
}

// แก้ได้ในที่ ไม่ต้องกดเข้าโหมดแก้ไขก่อน — บันทึกตอนออกจากช่อง (onBlur) หรือตอนสลับสวิตช์
// ต้นแบบก็ทำแบบนี้: ทั้งชั้นเป็นฟอร์มเดียวที่พิมพ์ทับได้เลย
function RoomRow({ room, act }) {
  const [form, setForm] = useState({
    roomNumber: room.roomNumber,
    roomTypeName: room.roomTypeName ?? '',
    isActive: room.isActive
  })

  function save(next) {
    setForm(next)
    return act(() => updateRoom(room.roomId, next))
  }

  return (
    <div className="plan-room">
      <div className="field field-required">
        <label htmlFor={`room-no-${room.roomId}`}>
          ห้อง <span className="required">*</span>
        </label>
        <input
          id={`room-no-${room.roomId}`}
          value={form.roomNumber}
          onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
          onBlur={() => form.roomNumber !== room.roomNumber && save(form)}
        />
      </div>

      <div className="field">
        <label htmlFor={`room-type-${room.roomId}`}>ประเภทห้อง</label>
        <input
          id={`room-type-${room.roomId}`}
          value={form.roomTypeName}
          onChange={(e) => setForm({ ...form, roomTypeName: e.target.value })}
          onBlur={() => form.roomTypeName !== (room.roomTypeName ?? '') && save(form)}
        />
      </div>

      <ToggleSwitch
        label="เปิดใช้งาน"
        checked={form.isActive}
        onChange={(isActive) => save({ ...form, isActive })}
      />

      <button
        type="button"
        className="link-btn link-danger plan-room-delete"
        onClick={() => act(() => deleteRoom(room.roomId))}
        aria-label={`ลบห้อง ${room.roomNumber}`}
      >
        <Icon name="trash" />
      </button>
    </div>
  )
}
