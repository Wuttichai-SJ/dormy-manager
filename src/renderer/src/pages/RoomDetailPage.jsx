import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { showToast } from '../components/Toast.jsx'
import { formatPhone } from '../components/TenantDialog.jsx'
import { formatBaht } from '../format.js'
import { ROOM_STATUS_LABELS } from '../constants.js'
import { getContractsForRoom } from '../services/contractService.js'
import ContractWizard from './ContractWizard.jsx'

// หน้ารายละเอียดห้อง — ศูนย์กลางของทั้งระบบตามต้นแบบ (สำรวจหน้าจริง 2026-07-31)
//
// ห้องว่าง  → การ์ด "เพิ่มสัญญาประเภท" ให้เลือก รายเดือน / รายวัน
// ห้องไม่ว่าง → รายละเอียดสัญญา · เลขมิเตอร์วันเข้าพัก · บริการรายเดือน · ข้อมูลผู้เช่า
//
// ส่วนที่ต้นแบบมีแต่เรายังไม่ได้ทำ: แจ้งย้ายออก (Phase 4) · รายชื่อคนจองรอเข้าพัก (Phase 2.4)
// ส่วนที่ต้นแบบมีแต่เราตัดทิ้งถาวร: ข้อมูลรถ
export default function RoomDetailPage({ apartment, room, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(null) // 'monthly' | 'daily' | null

  const load = useCallback(async () => {
    const res = await getContractsForRoom(room.roomId)
    if (!res.success) return setError(res.error)
    setError('')
    setData(res.data)
  }, [room.roomId])

  useEffect(() => {
    load()
  }, [load])

  if (creating) {
    return (
      <ContractWizard
        apartment={apartment}
        room={room}
        rentType={creating}
        onCancel={() => setCreating(null)}
        onDone={() => {
          setCreating(null)
          showToast('บันทึกข้อมูลสำเร็จ')
          load()
        }}
      />
    )
  }

  const active = data?.active ?? null

  return (
    <>
      <button type="button" className="link-btn link-back-inline" onClick={onBack}>
        <Icon name="back" />
        <span>กลับไปรายการห้องพัก</span>
      </button>

      <h2 className="room-detail-title">
        ห้อง: {room.roomNumber}
        <span className={`room-badge status-${active ? 'occupied' : room.status}`}>
          {active ? ROOM_STATUS_LABELS.occupied : (ROOM_STATUS_LABELS[room.status] ?? room.status)}
        </span>
      </h2>

      <Alert>{error}</Alert>

      {data === null ? (
        <p className="muted">กำลังโหลด...</p>
      ) : (
        <div className="room-detail-grid">
          <div className="room-detail-column">
            {active ? (
              <ContractCard contract={active} />
            ) : (
              <section className="panel">
                <h3 className="panel-title">รายละเอียดสัญญา</h3>
                <p className="room-detail-empty">เพิ่มสัญญาประเภท</p>
                {/* ปุ่มใหญ่สองใบตามต้นแบบ — เลือกประเภทก่อนแล้วค่อยเข้าตัวช่วยกรอก */}
                <div className="contract-type-picker">
                  <button
                    type="button"
                    className="contract-type contract-type-monthly"
                    onClick={() => setCreating('monthly')}
                  >
                    <Icon name="bookings" />
                    <span>รายเดือน</span>
                  </button>
                  <button
                    type="button"
                    className="contract-type contract-type-daily"
                    onClick={() => setCreating('daily')}
                  >
                    <Icon name="meters" />
                    <span>รายวัน</span>
                  </button>
                </div>
              </section>
            )}

            {active && <MeterCard contract={active} />}
          </div>

          <div className="room-detail-column">
            <ServicesCard contract={active} room={room} />
            {active && <TenantsCard contract={active} />}
          </div>
        </div>
      )}
    </>
  )
}

function ContractCard({ contract }) {
  const rows = [
    ['ประเภท', contract.rentType === 'monthly' ? 'รายเดือน' : 'รายวัน'],
    ['เริ่มต้น', contract.startDate],
    ['สิ้นสุด', contract.endDate ?? '-'],
    ['ค่าห้อง', formatBaht(contract.rentAmountCents)],
    ['เงินประกัน', formatBaht(contract.depositAmountCents)]
  ]

  // เงินจอง/เงินล่วงหน้าโผล่เฉพาะเมื่อมีจริง — สัญญาที่ไม่มีเงินจองไม่ต้องเห็นแถวว่างๆ
  if (contract.bookingFeeCents > 0) rows.push(['เงินจอง', formatBaht(contract.bookingFeeCents)])
  if (contract.advancePaymentAmountCents > 0) {
    rows.push(['เงินล่วงหน้า', formatBaht(contract.advancePaymentAmountCents)])
  }

  return (
    <section className="panel">
      <h3 className="panel-title">รายละเอียดสัญญา</h3>
      <dl className="contract-rows">
        {rows.map(([label, value]) => (
          <div className="contract-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {contract.note && <p className="field-hint">{contract.note}</p>}
    </section>
  )
}

function MeterCard({ contract }) {
  return (
    <section className="panel">
      <h3 className="panel-title">เลขมิเตอร์วันเข้าพัก</h3>
      <div className="meter-start-grid">
        <div className="meter-start meter-start-water">
          <Icon name="water" />
          <strong>{contract.waterMeterStart}</strong>
          <span>ค่าน้ำ</span>
        </div>
        <div className="meter-start meter-start-electric">
          <Icon name="electric" />
          <strong>{contract.electricMeterStart}</strong>
          <span>ค่าไฟ</span>
        </div>
      </div>
      {/* เลขนี้เป็นจุดตั้งต้นของการคิดค่าน้ำ/ค่าไฟบิลแรก แก้ทีหลังแล้วบิลเพี้ยนทั้งสัญญา */}
      <p className="field-hint">ใช้เป็นเลขตั้งต้นสำหรับคิดค่าน้ำ/ค่าไฟบิลแรกของสัญญานี้</p>
    </section>
  )
}

function ServicesCard({ contract, room }) {
  // มีสัญญาแล้ว = โชว์ราคาที่ตรึงไว้ในสัญญา ไม่ใช่ราคาปัจจุบันของหอ (ดู db/contracts.js)
  const items = contract
    ? contract.services.map((s) => ({ name: s.name, price: formatBaht(s.priceCents) }))
    : room.services.map((name) => ({ name, price: null }))

  return (
    <section className="panel">
      <h3 className="panel-title">บริการรายเดือน</h3>
      <p className="panel-subtitle">ค่าบริการจะถูกเพิ่มในบิลรายเดือนอัตโนมัติ</p>

      {items.length === 0 ? (
        <p className="muted">ยังไม่มีค่าบริการผูกกับห้องนี้</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>ค่าบริการ</th>
              <th className="align-right">ราคา</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td className="align-right">
                  {item.price ?? <span className="muted">ตามราคาปัจจุบัน</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {contract && (
        <p className="field-hint">
          ราคานี้ถูกตรึงไว้ตั้งแต่วันทำสัญญา การขึ้นราคาค่าบริการของหอจะไม่กระทบสัญญานี้
        </p>
      )}
    </section>
  )
}

function TenantsCard({ contract }) {
  return (
    <section className="panel">
      <h3 className="panel-title">ข้อมูลผู้เช่า</h3>
      <p className="panel-subtitle">กรณีมีผู้เช่าหลายคน จะแสดงทุกคนที่อยู่ในสัญญานี้</p>

      <table className="data-table">
        <thead>
          <tr>
            <th>ชื่อ</th>
            <th>เบอร์ติดต่อ</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {contract.tenants.map((t) => (
            <tr key={t.tenantId}>
              <td>{t.fullName}</td>
              <td>{formatPhone(t.phone)}</td>
              <td>
                {t.isPrimary ? (
                  <span className="tag">ผู้เช่าหลัก</span>
                ) : (
                  <span className="muted">ผู้อยู่ร่วม</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
