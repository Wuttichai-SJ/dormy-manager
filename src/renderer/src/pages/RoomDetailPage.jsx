import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { showToast } from '../components/Toast.jsx'
import { formatPhone } from '../components/TenantDialog.jsx'
import { centsToInput, formatBaht } from '../format.js'
import { PAYMENT_METHODS, ROOM_STATUS_LABELS } from '../constants.js'
import { getContractsForRoom } from '../services/contractService.js'
import DateField from '../components/DateField.jsx'
import Modal from '../components/Modal.jsx'
import { receiveContractPayment } from '../services/paymentService.js'
import BookingsCard from '../components/BookingsCard.jsx'
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
  // ใบจองที่กำลังแปลงเป็นสัญญา — ตัวช่วยจะเติมข้อมูลจากใบจองให้ก่อน
  const [converting, setConverting] = useState(null)

  const load = useCallback(async () => {
    const res = await getContractsForRoom(room.roomId)
    if (!res.success) return setError(res.error)
    setError('')
    setData(res.data)
  }, [room.roomId])

  useEffect(() => {
    load()
  }, [load])

  if (creating || converting) {
    return (
      <ContractWizard
        apartment={apartment}
        room={room}
        rentType={converting ? converting.rentType : creating}
        booking={converting}
        onCancel={() => {
          setCreating(null)
          setConverting(null)
        }}
        onDone={() => {
          setCreating(null)
          setConverting(null)
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
              <ContractCard contract={active} onReload={load} />
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
            {/* ต้นแบบแสดงคิวจองไว้ในหน้าห้องเสมอ ไม่ว่าห้องจะว่างหรือไม่ */}
            <BookingsCard room={room} onConvert={setConverting} />
          </div>
        </div>
      )}
    </>
  )
}

function ContractCard({ contract, onReload }) {
  const [receiving, setReceiving] = useState(false)
  const deposit = contract.deposit ?? { requiredCents: contract.depositAmountCents, receivedCents: 0, outstandingCents: 0 }

  const rows = [
    ['ประเภท', contract.rentType === 'monthly' ? 'รายเดือน' : 'รายวัน'],
    ['เริ่มต้น', contract.startDate],
    ['สิ้นสุด', contract.endDate ?? '-'],
    ['ค่าห้อง', formatBaht(contract.rentAmountCents)],
    ['เงินประกัน', formatBaht(contract.depositAmountCents)],
    // ยอดที่รับมาจริง นับจากใบเสร็จ ไม่ใช่ยอดที่ตกลงกันไว้ — เงินจองที่หักเป็นเงินประกัน
    // ก็อยู่ในนี้แล้ว เพราะตอนทำสัญญาระบบออกใบเสร็จให้ก้อนนั้นไปแล้ว
    ['รับเงินประกันแล้ว', formatBaht(deposit.receivedCents)]
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

      {/* ยอดค้างต้องตามหลอกหลอนอยู่บนหน้าจอจนกว่าจะเก็บครบ ไม่ใช่แจ้งเตือนที่กดปิดแล้วหาย
          — เคสจริง: วางเงินจองครึ่งหนึ่งตอนมาดูห้อง อีกครึ่งเก็บวันเข้าอยู่จริงอีกสองเดือนถัดมา */}
      {deposit.outstandingCents > 0 && (
        <div className="deposit-due">
          <div>
            <strong>ยังเก็บเงินประกันไม่ครบ</strong>
            <span>ค้างอีก {formatBaht(deposit.outstandingCents)} บาท</span>
          </div>
          <button type="button" className="btn" onClick={() => setReceiving(true)}>
            รับเงินประกันเพิ่ม
          </button>
        </div>
      )}

      {contract.note && <p className="field-hint">{contract.note}</p>}

      {receiving && (
        <DepositPaymentDialog
          contract={contract}
          outstandingCents={deposit.outstandingCents}
          onClose={() => setReceiving(false)}
          onDone={() => {
            setReceiving(false)
            onReload?.()
          }}
        />
      )}
    </section>
  )
}

// รับเงินประกันส่วนที่ยังค้าง — ออกใบเสร็จจริง ไม่ใช่แค่ติ๊กว่าเก็บแล้ว
// เพราะยอด "รับแล้ว" ถูกนับจากใบเสร็จ ถ้าไม่ออกใบ ยอดค้างก็ไม่ลด
function DepositPaymentDialog({ contract, outstandingCents, onClose, onDone }) {
  const [amount, setAmount] = useState(centsToInput(outstandingCents))
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentDate, setPaymentDate] = useState(todayIso())
  const [remark, setRemark] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    const res = await receiveContractPayment({
      contractId: contract.contractId,
      amount,
      paymentMethod,
      paymentDate,
      remark,
      purpose: 'deposit'
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    showToast(`รับเงินประกันแล้ว ออกใบเสร็จ ${res.data.receiptNumber}`)
    onDone()
  }

  return (
    <Modal title="รับเงินประกันเพิ่ม" icon="payments" busy={busy} onClose={onClose} onSubmit={submit}>
      <Alert>{error}</Alert>

      <div className="field">
        <label htmlFor="depositAmount">
          จำนวนเงิน <span className="muted">(ค้างอยู่ {formatBaht(outstandingCents)})</span>
        </label>
        <input
          id="depositAmount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="depositMethod">ชำระเงินโดย</label>
        <select
          id="depositMethod"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="depositDate">
          วันที่รับเงิน <span className="required">* จำเป็น</span>
        </label>
        <DateField id="depositDate" value={paymentDate} onChange={setPaymentDate} />
      </div>

      <div className="field">
        <label htmlFor="depositRemark">หมายเหตุ</label>
        <input
          id="depositRemark"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="เช่น เก็บส่วนที่เหลือวันเข้าอยู่"
        />
      </div>
    </Modal>
  )
}

function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
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
