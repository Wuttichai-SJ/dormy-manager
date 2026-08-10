import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { formatBaht, formatDocumentDate } from '../format.js'
import { formatPhone } from '../components/TenantDialog.jsx'
import { ROOM_STATUS_LABELS } from '../constants.js'
import { listRoomsForApartment } from '../services/contractService.js'

// หน้า "ห้องพัก" — หน้าหลักของระบบตามต้นแบบ (สำรวจหน้าจริง 2026-07-31)
//
// ต้นแบบไม่มีเมนู "ผู้เช่า" หรือ "สัญญา" แยก ทุกอย่างเริ่มจากห้อง: ตารางห้องบอกว่า
// ห้องไหนมีใครอยู่ ค่าเช่าเท่าไหร่ แล้วกด "รายละเอียด" เข้าไปจัดการสัญญาของห้องนั้น
//
// **สถานะ "จองแล้ว" ไม่ใช่ค่าใน rooms.status** — rooms.status มีแค่ ว่าง/ไม่ว่าง/ปิดปรับปรุง
// และห้องที่มีคนจองไว้ก็ยังว่างจริงๆ (ยังไม่มีใครอยู่) หน้าจอจึงอ่านจากใบจองที่ยังกันห้องอยู่
// แล้วขึ้นป้ายเอง ถ้าเก็บเป็นสถานะห้อง จะต้องมีคนคอยตั้งและล้างตามวงจรของใบจองทุกจังหวะ
// แล้ววันหนึ่งก็ค้างเป็นสถานะเก่าที่ไม่ตรงกับความจริง
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
  const [totals, setTotals] = useState({ total: 0, vacant: 0, booked: 0, outstanding: 0 })
  useEffect(() => {
    listRoomsForApartment(apartment.apartmentId).then((res) => {
      if (!res.success) return
      setTotals({
        total: res.data.length,
        vacant: res.data.filter((r) => r.status === 'vacant').length,
        // นับจากใบจองที่ยังกันห้องอยู่ ไม่ได้นับจากสถานะห้อง (ห้องที่มีคนจองยังว่างอยู่จริง)
        booked: res.data.filter((r) => r.booking).length,
        outstanding: res.data.filter((r) => r.invoiceOutstandingCents > 0).length
      })
    })
  }, [apartment.apartmentId, rooms])

  return (
    <>
      <div className="room-stats">
        <StatCard value={totals.total} label="ห้องทั้งหมด" highlight />
        <StatCard value={totals.vacant} label="ห้องว่าง" />
        <StatCard value={totals.booked} label="จองล่วงหน้า" />
        <StatCard value={totals.outstanding} label="ค้างชำระ" />
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
        {/* ค้นได้ทั้งผู้เช่าตามสัญญาและคนที่จองไว้แต่ยังไม่ย้ายเข้า — หอร้อยห้อง คนจอง
            จำเลขห้องตัวเองไม่ได้ ชื่อจึงเป็นทางเดียวที่หาห้องเจอ (ผู้ใช้สั่ง 2026-08-10) */}
        <div className="search-field">
          <Icon name="search" />
          <input
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="ค้นหาชื่อหรือเบอร์ (ผู้เช่า / ผู้จอง)"
            aria-label="ค้นหาชื่อหรือเบอร์ของผู้เช่าหรือผู้จอง"
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
                    {/* ห้องว่างที่มีคนจองไว้ขึ้น "จองแล้ว" แทน "ว่าง" — อ่านจากใบจองตรงๆ
                        ไม่ได้เก็บเป็นสถานะห้อง จึงไม่มีทางค้างเป็นสถานะเก่าที่ไม่มีใครล้าง
                        (ห้องที่มีคนอยู่แล้วยังขึ้น "ไม่ว่าง" เหมือนเดิม สัญญาชนะใบจองเสมอ) */}
                    {room.status === 'vacant' && room.booking ? (
                      <span className="room-badge status-booked">จองแล้ว</span>
                    ) : (
                      <span className={`room-badge status-${room.status}`}>
                        {ROOM_STATUS_LABELS[room.status] ?? room.status}
                      </span>
                    )}
                    {/* เงินประกันที่ยังเก็บไม่ครบต้องเห็นตั้งแต่หน้ารวม ไม่ใช่ต้องกดเข้าไปดู
                        ทีละห้อง — เคสจริงคือวางมัดจำครึ่งเดียวตอนจอง แล้วลืมเก็บส่วนที่เหลือ */}
                    {room.depositOutstandingCents > 0 && (
                      <span className="deposit-due-badge">
                        ค้างเงินประกัน {formatBaht(room.depositOutstandingCents)}
                      </span>
                    )}
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
                    ) : room.booking ? (
                      /* ห้องที่จองไว้ต้องบอกว่าใครจองและจะเข้าวันไหน ไม่งั้นเจ้าของหอเห็นแค่
                         ป้าย "จองแล้ว" แล้วต้องกดเข้าไปดูทีละห้องว่ารอใครอยู่ */
                      <>
                        <div>{room.booking.customerName}</div>
                        <div className="muted room-cell-sub">
                          เข้าพัก {formatDocumentDate(room.booking.checkInDate)}
                          {room.booking.status === 'pending' && ' · รอยืนยัน'}
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
