import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { formatBaht } from '../format.js'
import { formatPhone } from '../components/TenantDialog.jsx'
import { ROOM_STATUS_LABELS } from '../constants.js'
import { listRoomsForApartment } from '../services/contractService.js'

// หน้า "ห้องพัก" — หน้าหลักของระบบตามต้นแบบ (สำรวจหน้าจริง 2026-07-31)
//
// ต้นแบบไม่มีเมนู "ผู้เช่า" หรือ "สัญญา" แยก ทุกอย่างเริ่มจากห้อง: ตารางห้องบอกว่า
// ห้องไหนมีใครอยู่ ค่าเช่าเท่าไหร่ แล้วกด "รายละเอียด" เข้าไปจัดการสัญญาของห้องนั้น
//
// การ์ดสถิติ "จองล่วงหน้า" กับ "ค้างชำระ" ยังไม่ใส่ตัวเลข เพราะตาราง room_bookings และ
// invoices ยังไม่มีข้อมูล (Phase 2.4 / Phase 3) — จงใจแสดง "—" ไม่ใช่เลข 0 ที่ไม่ได้มาจาก
// การนับจริง เพราะ 0 ทำให้เจ้าของหอเข้าใจผิดว่า "ไม่มีใครค้างเลย" ทั้งที่ยังไม่ได้เริ่มออกบิล
export default function RoomsPage({ apartment, onOpenRoom }) {
  const [rooms, setRooms] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [tenant, setTenant] = useState('')
  const [rentType, setRentType] = useState('')

  const load = useCallback(async () => {
    const res = await listRoomsForApartment(apartment.apartmentId, { search, tenant, rentType })
    if (!res.success) return setError(res.error)
    setError('')
    setRooms(res.data)
  }, [apartment.apartmentId, search, tenant, rentType])

  useEffect(() => {
    load()
  }, [load])

  // นับจากทั้งหอเสมอ ไม่ใช่นับจากผลที่กรองแล้ว — ตัวเลขสรุปต้องไม่เปลี่ยนตามคำค้น
  const [totals, setTotals] = useState({ total: 0, vacant: 0 })
  useEffect(() => {
    listRoomsForApartment(apartment.apartmentId).then((res) => {
      if (!res.success) return
      setTotals({
        total: res.data.length,
        vacant: res.data.filter((r) => r.status === 'vacant').length
      })
    })
  }, [apartment.apartmentId, rooms])

  return (
    <>
      <div className="room-stats">
        <StatCard value={totals.total} label="ห้องทั้งหมด" highlight />
        <StatCard value={totals.vacant} label="ห้องว่าง" />
        <StatCard value="—" label="จองล่วงหน้า" hint="ยังไม่ได้สร้างระบบการจอง" />
        <StatCard value="—" label="ค้างชำระ" hint="ยังไม่ได้สร้างระบบออกบิล" />
      </div>

      <div className="room-filters">
        <div className="search-field">
          <Icon name="search" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลขห้อง"
            aria-label="ค้นหาเลขห้อง"
          />
        </div>
        <div className="search-field">
          <Icon name="search" />
          <input
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="ค้นหาชื่อหรือเบอร์ผู้เช่า"
            aria-label="ค้นหาผู้เช่า"
          />
        </div>
        <select value={rentType} onChange={(e) => setRentType(e.target.value)} aria-label="ประเภทสัญญา">
          <option value="">ทุกประเภทสัญญา</option>
          <option value="monthly">รายเดือน</option>
          <option value="daily">รายวัน</option>
        </select>
      </div>

      <Alert>{error}</Alert>

      {rooms === null ? (
        <p className="muted">กำลังโหลด...</p>
      ) : rooms.length === 0 ? (
        <section className="panel empty-state">
          <Icon name="rooms" />
          <h2>{search || tenant || rentType ? 'ไม่พบห้องที่ค้นหา' : 'ยังไม่มีห้องพักในหอนี้'}</h2>
          <p className="muted">
            {search || tenant || rentType
              ? 'ลองเปลี่ยนคำค้นหรือล้างตัวกรอง'
              : 'สร้างผังห้องได้ที่ ตั้งค่า → ผังห้อง'}
          </p>
        </section>
      ) : (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>ห้อง</th>
                <th>ผู้เช่า</th>
                <th>ประเภท</th>
                <th className="align-right">ค่าเช่า</th>
                <th>บริการเสริม</th>
                <th className="align-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.roomId}>
                  <td>
                    <span className="room-cell-number">{room.roomNumber}</span>
                    <span className={`room-badge status-${room.status}`}>
                      {ROOM_STATUS_LABELS[room.status] ?? room.status}
                    </span>
                  </td>
                  <td>
                    {room.primaryTenant ? (
                      <>
                        <div>{room.primaryTenant.fullName}</div>
                        <div className="muted room-cell-sub">
                          {formatPhone(room.primaryTenant.phone)}
                          {/* ห้องที่อยู่กันหลายคน ต้องเห็นตั้งแต่ตาราง ไม่ใช่ต้องกดเข้าไปดู */}
                          {room.tenants.length > 1 && ` · และอีก ${room.tenants.length - 1} คน`}
                        </div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {room.rentType
                      ? room.rentType === 'monthly'
                        ? 'รายเดือน'
                        : 'รายวัน'
                      : <span className="muted">—</span>}
                  </td>
                  <td className="align-right">
                    {/* ค่าเช่าที่แสดงคือของสัญญาจริง ไม่ใช่ราคาตั้งของห้อง เพราะสองอันนี้
                        ต่างกันได้ (ต่อรองราคา / ขึ้นราคาห้องหลังเซ็นสัญญาไปแล้ว) */}
                    {room.contractRentCents !== null
                      ? formatBaht(room.contractRentCents)
                      : <span className="muted">{formatBaht(room.monthlyRentCents)}</span>}
                  </td>
                  <td className="room-cell-services">
                    {room.services.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      room.services.map((name) => <div key={name}>{name}</div>)
                    )}
                  </td>
                  <td className="align-right">
                    <button type="button" className="link-btn" onClick={() => onOpenRoom(room)}>
                      รายละเอียด
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function StatCard({ value, label, highlight, hint }) {
  return (
    <div className={'stat-card' + (highlight ? ' highlight' : '')} title={hint}>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  )
}
