import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { useConfirm } from '../components/ConfirmDialog.jsx'
import InfoTip from '../components/InfoTip.jsx'
import ToggleSwitch from '../components/ToggleSwitch.jsx'
import { MAX_FLOORS, MAX_ROOMS_PER_FLOOR } from '../constants.js'
import {
  addFloor,
  addRoom,
  deleteFloor,
  deleteRoom,
  generateFloorPlan,
  listFloors,
  updateFloor,
  updateRoom
} from '../services/roomService.js'

// ขั้น 4-5: ยังไม่มีชั้น = ตัวสร้างผัง · มีแล้ว = โหมดแก้ไข · stage: builder | editor | ไม่ระบุ
export default function FloorPlanPage({ apartment, stage, registerNext }) {
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

  // คืนผังทั้งก้อนมาแทนของเดิม · คืน false = wizard ห้ามเลื่อนขั้น
  const act = useCallback(async (fn) => {
    setError('')
    const res = await fn()
    if (!res.success) {
      setError(res.error)
      return false
    }
    setFloors(res.data)
    return true
  }, [])

  // เหมือน act แต่คืนผลเต็มให้หน้าต่างยืนยัน
  const run = useCallback(async (fn) => {
    setError('')
    const res = await fn()
    if (res.success) setFloors(res.data)
    return res
  }, [])

  // useCallback — ใช้ใน useEffect ที่ลงทะเบียนปุ่ม "ต่อไป"
  const generate = useCallback(
    (specs) => act(() => generateFloorPlan(apartment.apartmentId, specs)),
    [act, apartment.apartmentId]
  )

  if (floors === null) return <p className="muted">กำลังโหลด...</p>

  return (
    <>
      <Alert>{error}</Alert>

      {floors.length === 0 ? (
        <FloorPlanBuilder registerNext={registerNext} onGenerate={generate} />
      ) : stage === 'builder' ? (
        <section className="panel">
          <p className="muted">
            สร้างผังห้องแล้ว — {floors.length} ชั้น{' '}
            {floors.reduce((sum, f) => sum + f.rooms.length, 0)} ห้อง · กด "ต่อไป" เพื่อแก้รายห้อง
          </p>
        </section>
      ) : (
        <FloorPlanEditor
          floors={floors}
          apartmentId={apartment.apartmentId}
          act={act}
          run={run}
        />
      )}
    </>
  )
}

const EMPTY_SPEC = { buildingName: '', numberPrefix: '', roomCount: '' }

function FloorPlanBuilder({ onGenerate, registerNext }) {
  const [floorCount, setFloorCount] = useState('')
  const [specs, setSpecs] = useState([])
  const [busy, setBusy] = useState(false)

  function changeFloorCount(value) {
    setFloorCount(value)
    const count = Number(value)
    if (!Number.isInteger(count) || count < 1) return setSpecs([])
    setSpecs((prev) => Array.from({ length: count }, (_, i) => prev[i] ?? { ...EMPTY_SPEC }))
  }

  function setSpec(index, key, value) {
    setSpecs((prev) => prev.map((spec, i) => (i === index ? { ...spec, [key]: value } : spec)))
  }

  // ปุ่ม "ต่อไป" ของ wizard เป็นคนสั่งสร้างผัง
  useEffect(() => {
    if (!registerNext) return
    registerNext(async () => {
      const res = await onGenerate(toFloorSpecs(specs))
      return res !== false
    })
  }, [registerNext, onGenerate, specs])

  return (
    <section className="panel">
      <form onSubmit={(e) => e.preventDefault()}>
        <div className="field field-narrow">
          <label htmlFor="floorCount">
            จำนวนชั้น <span className="required">* จำเป็น</span>
            <InfoTip
              title="ผังห้อง"
              points={['ระบบตั้งเลขห้องให้อัตโนมัติ (101, 102, 201, ...)', 'แก้ไขทีหลังได้ทุกห้อง']}
            />
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

        {specs.length > 0 && (
          <>
            <hr className="divider" />

            <div className="floor-spec-head">
              <span>ชั้น</span>
              <span>ตึก (ถ้ามี)</span>
              <span>
                เลขนำหน้า
                <InfoTip
                  title="หอที่มีหลายตึก"
                  points={[
                    'ตึก 1 ชั้น 2 ใส่ 12 → ห้อง 1201, 1202',
                    'ตึก 2 ชั้น 2 ใส่ 22 → ห้อง 2201, 2202',
                    'เว้นว่าง = ใช้ลำดับชั้น'
                  ]}
                />
              </span>
              <span>จำนวนห้อง</span>
            </div>

            <div className="floor-spec-grid">
              {specs.map((spec, index) => (
                <div className="floor-spec-row" key={index}>
                  <span className="floor-spec-label">ชั้นที่ {index + 1}</span>
                  <input
                    aria-label={`ตึกของชั้นที่ ${index + 1}`}
                    placeholder="เช่น ตึก 1"
                    value={spec.buildingName}
                    onChange={(e) => setSpec(index, 'buildingName', e.target.value)}
                  />
                  <input
                    aria-label={`เลขนำหน้าห้องของชั้นที่ ${index + 1}`}
                    // ว่าง = ใช้ลำดับที่ของชั้น
                    placeholder={String(index + 1)}
                    value={spec.numberPrefix}
                    onChange={(e) => setSpec(index, 'numberPrefix', e.target.value)}
                  />
                  <input
                    aria-label={`จำนวนห้องของชั้นที่ ${index + 1}`}
                    value={spec.roomCount}
                    inputMode="numeric"
                    onChange={(e) => setSpec(index, 'roomCount', e.target.value)}
                  />
                  <span className="unit floor-spec-sample">
                    {spec.roomCount ? `เช่น ${(spec.numberPrefix || index + 1)}01` : 'ห้อง'}
                  </span>
                </div>
              ))}
            </div>
            <p className="field-hint">สูงสุด {MAX_ROOMS_PER_FLOOR} ห้องต่อชั้น</p>

            {!registerNext && (
              <div className="form-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    await onGenerate(toFloorSpecs(specs))
                    setBusy(false)
                  }}
                >
                  {busy ? 'กำลังสร้าง...' : 'สร้างผังห้อง'}
                </button>
              </div>
            )}
          </>
        )}
      </form>
    </section>
  )
}

function FloorPlanEditor({ floors, apartmentId, act, run }) {
  const totalRooms = floors.reduce((sum, f) => sum + f.rooms.length, 0)
  const groups = groupByBuilding(floors)
  const showBuildings = floors.some((floor) => floor.buildingName)

  return (
    <>
      <p className="muted plan-summary">
        ทั้งหมด {floors.length} ชั้น {totalRooms} ห้อง
        {showBuildings ? ` · ${new Set(groups.map((g) => g.name)).size} ตึก` : ''}
      </p>

      {groups.map((group, index) => (
        <React.Fragment key={`${group.name}-${index}`}>
          {showBuildings && (
            <div className="plan-building-head">
              <h3>{group.name || 'ไม่ระบุตึก'}</h3>
              <span className="muted">
                {group.floors.length} ชั้น{' '}
                {group.floors.reduce((sum, f) => sum + f.rooms.length, 0)} ห้อง
              </span>
            </div>
          )}

          {group.floors.map((floor) => (
            <FloorCard key={floor.floorId} floor={floor} act={act} run={run} />
          ))}

          {showBuildings && group.name && (
            <button
              type="button"
              className="btn-outline plan-add-floor-in-building"
              onClick={() =>
                act(() => addFloor(apartmentId, { roomCount: 0, buildingName: group.name }))
              }
            >
              <Icon name="plus" />
              <span>เพิ่มชั้นใน {group.name}</span>
            </button>
          )}
        </React.Fragment>
      ))}

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

// จัดกลุ่มตามป้ายตึกโดยไม่เรียงใหม่
function groupByBuilding(floors) {
  const groups = []
  for (const floor of floors) {
    const name = floor.buildingName ?? ''
    const last = groups[groups.length - 1]
    if (last && last.name === name) last.floors.push(floor)
    else groups.push({ name, floors: [floor] })
  }
  return groups
}

function toFloorSpecs(specs) {
  return specs.map((spec) => ({
    roomCount: Number(spec.roomCount),
    buildingName: spec.buildingName.trim() || undefined,
    numberPrefix: spec.numberPrefix.trim() || undefined
  }))
}

function FloorCard({ floor, act, run }) {
  const [confirmDialog, ask] = useConfirm()
  const [name, setName] = useState(floor.floorName)
  const [building, setBuilding] = useState(floor.buildingName ?? '')
  const [prefix, setPrefix] = useState(floor.numberPrefix ?? '')

  return (
    <section className="plan-floor">
      <header className="plan-floor-head">
        <label htmlFor={`floor-name-${floor.floorId}`}>ชั้น</label>
        <input
          id={`floor-name-${floor.floorId}`}
          className="plan-floor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() =>
            name !== floor.floorName && act(() => updateFloor(floor.floorId, { floorName: name }))
          }
        />
        {confirmDialog}
        {floor.rooms.length === 0 && (
          <button
            type="button"
            className="link-btn link-danger plan-floor-delete"
            onClick={() =>
              ask({
                title: `ลบ${floor.floorName}?`,
                message: 'ชั้นนี้ไม่มีห้องแล้ว จะหายจากผังห้อง',
                confirmLabel: 'ลบชั้น',
                onConfirm: () => run(() => deleteFloor(floor.floorId))
              })
            }
          >
            ลบชั้นนี้
          </button>
        )}
      </header>

      <div className="plan-floor-meta">
        <div className="field">
          <label htmlFor={`floor-building-${floor.floorId}`}>ตึก</label>
          <input
            id={`floor-building-${floor.floorId}`}
            placeholder="ไม่ระบุ"
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
            onBlur={() =>
              building !== (floor.buildingName ?? '') &&
              act(() => updateFloor(floor.floorId, { buildingName: building }))
            }
          />
        </div>

        <div className="field">
          <label htmlFor={`floor-prefix-${floor.floorId}`}>เลขนำหน้าห้อง</label>
          <input
            id={`floor-prefix-${floor.floorId}`}
            placeholder={floor.effectivePrefix}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            onBlur={() =>
              prefix !== (floor.numberPrefix ?? '') &&
              act(() => updateFloor(floor.floorId, { numberPrefix: prefix }))
            }
          />
        </div>

        {/* มีผลกับห้องใหม่เท่านั้น */}
        <p className="field-hint plan-floor-hint">
          ห้องใหม่จะขึ้นต้นด้วย <strong>{floor.effectivePrefix}</strong> · ไม่กระทบเลขห้องเดิม
        </p>
      </div>

      <div className="plan-floor-body">
        {floor.rooms.map((room) => (
          <RoomRow key={room.roomId} room={room} act={act} run={run} />
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

function RoomRow({ room, act, run }) {
  const [confirmDialog, ask] = useConfirm()
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

      {confirmDialog}
      <button
        type="button"
        className="link-btn link-danger plan-room-delete"
        onClick={() =>
          ask({
            title: `ลบห้อง ${room.roomNumber}?`,
            message: 'ห้องจะหายจากผังห้อง กู้คืนไม่ได้',
            confirmLabel: 'ลบห้อง',
            onConfirm: () => run(() => deleteRoom(room.roomId))
          })
        }
        aria-label={`ลบห้อง ${room.roomNumber}`}
      >
        <Icon name="trash" />
      </button>
    </div>
  )
}
