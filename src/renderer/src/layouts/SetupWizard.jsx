import React, { useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { completeApartmentSetup } from '../services/apartmentService.js'
import ApartmentServicesPage from '../pages/ApartmentServicesPage.jsx'
import UtilitySettingsPage from '../pages/UtilitySettingsPage.jsx'
import BankAccountsPage from '../pages/BankAccountsPage.jsx'
import FloorPlanPage from '../pages/FloorPlanPage.jsx'
import RoomRatesPage from '../pages/RoomRatesPage.jsx'

// ตัวช่วยตั้งค่า 8 ขั้น — ลำดับขึ้นต่อกัน (ค่าน้ำไฟก่อนห้อง ห้องก่อนราคา)
const STEPS = [
  {
    key: 'services',
    label: 'ค่าบริการ',
    brief: { text: 'เช่น ค่าอินเทอร์เน็ต ค่าที่จอดรถ ค่าฟิตเนส' }
  },
  {
    key: 'meters',
    label: 'การคิดค่าน้ำ / ค่าไฟ',
    brief: {
      title: 'วิธีคิดค่าน้ำและค่าไฟ',
      points: [
        'ค่าน้ำกับค่าไฟเลือกวิธีคิดแยกกันได้',
        'ตามมิเตอร์ / มีขั้นต่ำ / เหมาจ่ายรายเดือน'
      ]
    }
  },
  {
    key: 'banks',
    label: 'บัญชีธนาคาร',
    brief: {
      title: 'บัญชีรับชำระเงิน',
      points: [
        'แสดงในใบแจ้งหนี้ให้ผู้เช่าโอนเข้า',
        'แนะนำไม่เกิน 2 บัญชี'
      ]
    }
  },
  {
    key: 'floors',
    label: 'จัดการชั้น',
    brief: {
      title: 'จำนวนชั้น',
      points: ['เลือกจำนวนชั้น แล้วระบุจำนวนห้องต่อชั้น']
    }
  },
  {
    key: 'plan',
    label: 'ผังห้อง',
    brief: {
      title: 'เลขห้องพัก',
      points: [
        'ระบบตั้งเลขให้ตามชั้น เช่น 101 102 201',
        'แก้เป็นเลขที่ใช้จริงได้ ห้ามซ้ำกัน'
      ]
    }
  },
  {
    key: 'rate',
    label: 'ค่าห้อง',
    brief: {
      title: 'ค่าเช่าห้อง',
      points: [
        'เลือกหลายห้องแล้วตั้งทีเดียวได้',
        'ไม่รับเช่ารายวัน เว้นว่างไว้ได้'
      ]
    }
  },
  {
    key: 'status',
    label: 'สถานะห้อง',
    brief: {
      title: 'สถานะเริ่มต้นของห้อง',
      points: [
        'ห้องว่าง / ไม่ว่าง / ปิดปรับปรุง',
        'ห้องที่มีคนอยู่แล้ว ตั้ง "ไม่ว่าง" ไว้ก่อน แล้วค่อยทำสัญญาย้อนหลัง'
      ]
    }
  },
  {
    key: 'roomServices',
    label: 'ค่าบริการรายห้อง',
    brief: {
      title: 'ผูกค่าบริการเข้ากับห้อง',
      points: [
        'เลือกค่าบริการจากขั้นที่ 1 แล้วผูกหลายห้องพร้อมกันได้',
        'ห้องที่ไม่ได้ผูก จะไม่ถูกเก็บรายการนั้น'
      ]
    }
  }
]

export default function SetupWizard({ apartment, onFinish, onExit }) {
  const [index, setIndex] = useState(0)
  // registerNext(fn): fn คืน false = ไม่เลื่อนขั้น · เก็บใน ref ไม่ใช่ state
  const nextHandler = useRef(null)
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const step = STEPS[index]
  const isLast = index === STEPS.length - 1

  async function goNext() {
    setError('')
    const handler = nextHandler.current
    if (handler) {
      setBusy(true)
      const ok = await handler()
      setBusy(false)
      if (!ok) return
    }
    nextHandler.current = null
    setIndex((i) => i + 1)
  }

  // ปิดงานตั้งค่าที่ main ก่อน แล้วค่อยแสดงจอพร้อมใช้งาน
  async function finish() {
    setError('')
    setBusy(true)
    const res = await completeApartmentSetup(apartment.apartmentId)
    setBusy(false)
    if (!res.success) return setError(res.error)
    setDone(res.data)
  }

  if (done) {
    return (
      <div className="wizard">
        <WizardTopbar apartment={apartment} onExit={onExit} />
        <div className="hub-band">หอพัก</div>
        <div className="wizard-complete">
          <div className="wizard-complete-card">
            <span className="wizard-check">
              <Icon name="check" />
            </span>
            <h2>การตั้งค่าเสร็จเรียบร้อย</h2>
            <p className="muted">{apartment.nameTh} พร้อมใช้งานแล้ว</p>
            <button type="button" className="btn" onClick={() => onFinish(done)}>
              เริ่มต้นใช้งาน
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="wizard">
      <WizardTopbar apartment={apartment} onExit={onExit} />
      <div className="hub-band">หอพัก</div>

      <main className="wizard-body">
        <h1 className="wizard-title">ตั้งค่าหอพัก</h1>

        <Alert>{error}</Alert>

        <div className="wizard-layout">
          <nav className="wizard-steps">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                type="button"
                className={
                  'wizard-step' +
                  (i === index ? ' current' : '') +
                  (i < index ? ' done' : '') +
                  (i > index ? ' future' : '')
                }
                // ย้อนกลับได้ ข้ามไปข้างหน้าไม่ได้
                onClick={() => {
                  if (i >= index) return
                  nextHandler.current = null
                  setIndex(i)
                }}
                disabled={i > index}
              >
                <span className="wizard-step-number">{i + 1}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </nav>

          <section className="wizard-card">
            <div className="wizard-brief">
              {step.brief.title ? (
                <>
                  <h2>{step.brief.title}</h2>
                  <ul>
                    {step.brief.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>{step.brief.text}</p>
              )}
            </div>

            {/* key = ขั้น — ขั้น 6/7/8 ใช้คอมโพเนนต์เดียวกัน ต้องสร้างใหม่ทุกขั้น */}
            <div className="wizard-card-body">
              <StepContent
                key={step.key}
                stepKey={step.key}
                apartment={apartment}
                registerNext={(fn) => (nextHandler.current = fn)}
              />
            </div>
          </section>
        </div>

        <div className="wizard-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => (isLast ? finish() : goNext())}
          >
            {isLast ? (busy ? 'กำลังบันทึก...' : 'เสร็จสิ้น') : 'ต่อไป'}
          </button>
        </div>
      </main>
    </div>
  )
}

function WizardTopbar({ apartment, onExit }) {
  return (
    <header className="hub-topbar">
      <div className="brand-mark">Dormy Manager</div>
      <div className="topbar-user">
        <span>{apartment.nameTh}</span>
        {/* แต่ละขั้นบันทึกทันที ออกกลางคันไม่หาย */}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExit}>
          ตั้งค่าต่อภายหลัง
        </button>
      </div>
    </header>
  )
}

function StepContent({ stepKey, apartment, registerNext }) {
  switch (stepKey) {
    case 'services':
      return <ApartmentServicesPage apartment={apartment} />
    case 'meters':
      return <UtilitySettingsPage apartment={apartment} />
    case 'banks':
      return <BankAccountsPage apartment={apartment} />
    case 'floors':
      return <FloorPlanPage apartment={apartment} stage="builder" registerNext={registerNext} />
    case 'plan':
      return <FloorPlanPage apartment={apartment} stage="editor" />
    case 'rate':
      return <RoomRatesPage apartment={apartment} only="rate" />
    case 'status':
      return <RoomRatesPage apartment={apartment} only="status" />
    case 'roomServices':
      return <RoomRatesPage apartment={apartment} only="services" />
    default:
      return null
  }
}
