import React, { useCallback, useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
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
  const [newFloorRooms, setNewFloorRooms] = useState('')
  const totalRooms = floors.reduce((sum, f) => sum + f.rooms.length, 0)

  return (
    <>
      <p className="muted plan-summary">
        ทั้งหมด {floors.length} ชั้น {totalRooms} ห้อง
      </p>

      {floors.map((floor) => (
        <FloorCard key={floor.floorId} floor={floor} act={act} />
      ))}

      <section className="panel add-floor">
        <div className="field field-narrow">
          <label htmlFor="newFloorRooms">เพิ่มชั้นใหม่ — จำนวนห้อง</label>
          <input
            id="newFloorRooms"
            value={newFloorRooms}
            inputMode="numeric"
            onChange={(e) => setNewFloorRooms(e.target.value)}
            placeholder="0"
          />
        </div>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            await act(() => addFloor(apartmentId, { roomCount: Number(newFloorRooms || 0) }))
            setNewFloorRooms('')
          }}
        >
          เพิ่มชั้น
        </button>
      </section>
    </>
  )
}

function FloorCard({ floor, act }) {
  const [name, setName] = useState(floor.floorName)
  const [newRoom, setNewRoom] = useState('')

  return (
    <section className="panel floor-card">
      <header className="floor-card-head">
        <input
          className="floor-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== floor.floorName && act(() => renameFloor(floor.floorId, name))}
          aria-label="ชื่อชั้น"
        />
        <span className="muted">{floor.rooms.length} ห้อง</span>
        {/* ปุ่มลบชั้นโผล่เฉพาะชั้นที่ไม่มีห้องแล้ว — ฝั่ง main กันไว้อีกชั้นพร้อมข้อความอธิบาย */}
        {floor.rooms.length === 0 && (
          <button
            type="button"
            className="link-btn link-danger"
            onClick={() => act(() => deleteFloor(floor.floorId))}
          >
            ลบชั้นนี้
          </button>
        )}
      </header>

      <div className="room-grid">
        {floor.rooms.map((room) => (
          <RoomChip key={room.roomId} room={room} act={act} />
        ))}
      </div>

      <div className="add-room-row">
        <input
          value={newRoom}
          onChange={(e) => setNewRoom(e.target.value)}
          placeholder="เลขห้อง"
          aria-label="เลขห้องใหม่"
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            if (!newRoom.trim()) return
            await act(() => addRoom(floor.floorId, { roomNumber: newRoom }))
            setNewRoom('')
          }}
        >
          เพิ่มห้อง
        </button>
      </div>
    </section>
  )
}

function RoomChip({ room, act }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    roomNumber: room.roomNumber,
    roomTypeName: room.roomTypeName ?? '',
    isActive: room.isActive
  })

  if (!editing) {
    return (
      <button
        type="button"
        className={'room-chip' + (room.isActive ? '' : ' inactive')}
        onClick={() => setEditing(true)}
        title="กดเพื่อแก้ไข"
      >
        <span className="room-chip-number">{room.roomNumber}</span>
        <span className="room-chip-type">{room.roomTypeName || '—'}</span>
        {!room.isActive && <span className="room-chip-flag">ปิดใช้งาน</span>}
      </button>
    )
  }

  return (
    <div className="room-chip editing">
      <input
        value={form.roomNumber}
        onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
        aria-label="เลขห้อง"
      />
      <input
        value={form.roomTypeName}
        onChange={(e) => setForm({ ...form, roomTypeName: e.target.value })}
        placeholder="ประเภทห้อง"
        aria-label="ประเภทห้อง"
      />
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
        />
        <span>เปิดใช้งาน</span>
      </label>
      <div className="room-chip-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            await act(() => updateRoom(room.roomId, form))
            setEditing(false)
          }}
        >
          บันทึก
        </button>
        <button type="button" className="link-btn" onClick={() => setEditing(false)}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="link-btn link-danger"
          onClick={() => act(() => deleteRoom(room.roomId))}
        >
          ลบ
        </button>
      </div>
    </div>
  )
}
