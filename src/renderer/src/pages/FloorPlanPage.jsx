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
  updateFloor,
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

  // ทุกคำสั่งคืนผังทั้งก้อนกลับมา จึงเอามาแทนของเดิมได้เลย ไม่ต้องโหลดใหม่
  // คืน false เมื่อทำไม่สำเร็จ เพื่อให้ปุ่ม "ต่อไป" ของ wizard รู้ว่าห้ามเลื่อนขั้น
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

  // ห่อด้วย useCallback เพราะ FloorPlanBuilder เอาไปใส่ใน useEffect ที่ลงทะเบียนปุ่ม
  // "ต่อไป" — ถ้าฟังก์ชันเป็นตัวใหม่ทุก render effect จะวิ่งใหม่ทุกครั้งไม่จบ
  const generate = useCallback(
    (specs) => act(() => generateFloorPlan(apartment.apartmentId, specs)),
    [act, apartment.apartmentId]
  )

  if (floors === null) return <p className="muted">กำลังโหลด...</p>

  return (
    <>
      <div className="info-banner">
        <strong>ผังห้องพัก</strong>
        <p>
          ระบุจำนวนชั้นและจำนวนห้องในแต่ละชั้น ระบบจะตั้งเลขห้องให้อัตโนมัติ (101, 102, 201, ...)
          แก้ไขทีหลังได้ทุกห้อง
          <br />
          {/* หอหลายตึกต้องรู้เรื่องนี้ตั้งแต่ก่อนกรอก ไม่ใช่มารู้ตอนได้เลขห้องผิดทั้งหอ
              แล้วต้องไล่แก้ทีละห้อง */}
          <strong>หอที่มีหลายตึก:</strong> ใส่ป้ายตึกและ "เลขนำหน้า" ของแต่ละชั้นได้ — ตึก 1 ชั้น 2
          ใส่เลขนำหน้า <strong>12</strong> จะได้ห้อง 1201, 1202 · ตึก 2 ชั้น 2 ใส่{' '}
          <strong>22</strong> จะได้ห้อง 2201, 2202
        </p>
      </div>

      <Alert>{error}</Alert>

      {floors.length === 0 ? (
        <FloorPlanBuilder registerNext={registerNext} onGenerate={generate} />
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
const EMPTY_SPEC = { buildingName: '', numberPrefix: '', roomCount: '' }

function FloorPlanBuilder({ onGenerate, registerNext }) {
  const [floorCount, setFloorCount] = useState('')
  const [specs, setSpecs] = useState([])
  const [busy, setBusy] = useState(false)

  function changeFloorCount(value) {
    setFloorCount(value)
    const count = Number(value)
    if (!Number.isInteger(count) || count < 1) return setSpecs([])
    // คงค่าที่กรอกไว้แล้วเมื่อเพิ่ม/ลดจำนวนชั้น ไม่ล้างทิ้งทั้งหมด
    setSpecs((prev) => Array.from({ length: count }, (_, i) => prev[i] ?? { ...EMPTY_SPEC }))
  }

  function setSpec(index, key, value) {
    setSpecs((prev) => prev.map((spec, i) => (i === index ? { ...spec, [key]: value } : spec)))
  }

  // ไม่มีปุ่ม "สร้างผังห้อง" ของตัวเอง — ปุ่ม "ต่อไป" ของ wizard เป็นคนสั่งสร้าง
  // แล้วพาไปขั้น "ผังห้อง" ต่อในจังหวะเดียว (ต้นแบบก็มีแค่ปุ่มต่อไปปุ่มเดียว)
  //
  // ลงทะเบียนใหม่ทุกครั้งที่ค่าเปลี่ยน เพราะ closure ต้องเห็น roomCounts ล่าสุด
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

            {/* หัวคอลัมน์ครั้งเดียวด้านบน ไม่ใช่ label ซ้ำทุกแถว — สามช่องต่อชั้นคูณสิบชั้น
                จะกลายเป็นข้อความสามสิบชิ้นที่อ่านแล้วหาแถวของตัวเองไม่เจอ */}
            <div className="floor-spec-head">
              <span>ชั้น</span>
              <span>ตึก (ถ้ามี)</span>
              <span>เลขนำหน้า</span>
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
                    // ว่างไว้ = ใช้ลำดับที่ของชั้น ซึ่งเป็นพฤติกรรมเดิม จึงเอาลำดับที่
                    // มาโชว์เป็น placeholder ให้เห็นว่าถ้าไม่กรอกจะได้อะไร
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
                  {/* ตัวอย่างเลขห้องจริงของแถวนี้ — เห็นผลก่อนกด ไม่ต้องเดาว่ากฎทำงานยังไง */}
                  <span className="unit floor-spec-sample">
                    {spec.roomCount ? `เช่น ${(spec.numberPrefix || index + 1)}01` : 'ห้อง'}
                  </span>
                </div>
              ))}
            </div>
            <p className="field-hint">สูงสุด {MAX_ROOMS_PER_FLOOR} ห้องต่อชั้น</p>

            {/* ในตัวช่วยตั้งค่าไม่มีปุ่มนี้ ปุ่ม "ต่อไป" เป็นคนสั่งสร้างให้
                แต่ตอนเปิดหน้านี้เดี่ยวๆ จากเมนูตั้งค่าไม่มีปุ่มต่อไป จึงต้องมีปุ่มของตัวเอง */}
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

// -----------------------------------------------------
// โหมดแก้ไข
// -----------------------------------------------------
function FloorPlanEditor({ floors, apartmentId, act }) {
  const totalRooms = floors.reduce((sum, f) => sum + f.rooms.length, 0)
  const groups = groupByBuilding(floors)
  // หอตึกเดียว (ไม่มีใครใส่ป้ายตึก) ต้องเห็นหน้าเดิมเป๊ะๆ ไม่มีหัวข้อกลุ่มโผล่มาเกะกะ
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
            <FloorCard key={floor.floorId} floor={floor} act={act} />
          ))}

          {/* เพิ่มชั้นเข้าตึกนี้โดยตรง — ชั้นใหม่ได้ป้ายตึกเดียวกันติดมาให้เลย
              ไม่ต้องมาพิมพ์ป้ายตึกซ้ำทุกครั้งแล้วเสี่ยงพิมพ์ไม่เหมือนเดิม ("ตึก1" vs "ตึก 1")
              ซึ่งจะกลายเป็นสองตึกในสายตาระบบ */}
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

// จัดกลุ่มตามป้ายตึก **โดยไม่เรียงลำดับใหม่** — ชั้นเรียงตามลำดับที่สร้าง (floor_id) ซึ่งเป็น
// ลำดับที่เจ้าของหอเห็นมาตลอด ถ้าจับกลุ่มด้วยการเรียงใหม่ ชั้นจะสลับที่ต่อหน้าโดยไม่มีใครสั่ง
// สลับตึกไปมาจะได้หัวข้อเดิมซ้ำสองครั้ง ซึ่งตรงกับความจริงว่ากรอกสลับกันไว้
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

// ช่องที่เว้นว่างต้องไม่ถูกส่งเป็นสตริงว่าง — ฝั่ง main แปลงว่างเป็น null ให้อยู่แล้ว
// แต่ส่ง undefined ชัดกว่าในความหมาย "ไม่ได้ตั้ง"
function toFloorSpecs(specs) {
  return specs.map((spec) => ({
    roomCount: Number(spec.roomCount),
    buildingName: spec.buildingName.trim() || undefined,
    numberPrefix: spec.numberPrefix.trim() || undefined
  }))
}

// การ์ดหนึ่งใบต่อหนึ่งชั้น — หัวการ์ดพื้นเทาที่แก้ชื่อชั้นได้ในตัว แล้วห้องเรียงเป็นแถว
// ห้องละบรรทัด (เลขห้อง / ประเภทห้อง / สวิตช์เปิดใช้งาน) ตามต้นแบบ
function FloorCard({ floor, act }) {
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

      {/* บรรทัดที่สองของหัวการ์ด: ตึกกับเลขนำหน้า — แยกจากบรรทัดชื่อชั้นเพราะเป็นเรื่อง
          "ห้องใหม่จะได้เลขอะไร" ไม่ใช่ชื่อที่แสดง และหอตึกเดียวไม่ต้องแตะสองช่องนี้เลย */}
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

        {/* 🔴 บอกให้ชัดว่ามีผลกับห้องใหม่เท่านั้น — คนแก้ช่องนี้คาดว่าเลขห้องเดิมจะขยับตาม
            ซึ่งเราไม่ทำ เพราะเลขห้องอยู่บนบิลและใบเสร็จที่ยื่นให้ผู้เช่าไปแล้ว */}
        <p className="field-hint plan-floor-hint">
          ห้องที่เพิ่มใหม่ในชั้นนี้จะได้เลขขึ้นต้นด้วย <strong>{floor.effectivePrefix}</strong>{' '}
          (เช่น {floor.effectivePrefix}01) · ไม่กระทบเลขห้องที่มีอยู่แล้ว
        </p>
      </div>

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
