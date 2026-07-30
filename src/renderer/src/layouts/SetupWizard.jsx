import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import ApartmentServicesPage from '../pages/ApartmentServicesPage.jsx'
import UtilitySettingsPage from '../pages/UtilitySettingsPage.jsx'
import BankAccountsPage from '../pages/BankAccountsPage.jsx'
import FloorPlanPage from '../pages/FloorPlanPage.jsx'
import RoomRatesPage from '../pages/RoomRatesPage.jsx'

// ตัวช่วยตั้งค่าหอพักหลังสร้างใหม่ — ลอกลำดับ 8 ขั้นมาจากต้นแบบ
//
// ทำไมต้องเป็น wizard ไม่ใช่เมนูให้เลือกเอง:
// การตั้งค่าหอมีลำดับที่ขึ้นต่อกันจริงๆ — ต้องมีค่าน้ำ/ค่าไฟก่อน ห้องที่สร้างทีหลัง
// ถึงจะคัดลอกค่าไปได้ ต้องมีห้องก่อนถึงจะตั้งราคาห้องได้ ต้องมีค่าบริการก่อนถึงจะ
// ผูกเข้าห้องได้ ถ้าปล่อยให้กดเข้าหัวข้อไหนก่อนก็ได้ เจ้าของหอที่ทำครั้งแรกจะตั้งผิดลำดับ
// แล้วได้ห้อง 40 ห้องที่ไม่มีค่าน้ำค่าไฟติดมา โดยไม่มีอะไรเตือน
//
// หลังตั้งครบแล้ว การกลับมาแก้ทีละเรื่องใช้เมนู "ตั้งค่า" ในหน้าทำงานแทน (ไม่ต้องเดิน
// ผ่าน wizard ใหม่ทุกครั้ง) — ต้นแบบก็แยกสองทางแบบนี้เหมือนกัน
const STEPS = [
  { key: 'services', label: 'ค่าบริการ' },
  { key: 'meters', label: 'การคิดค่าน้ำ / ค่าไฟ' },
  { key: 'banks', label: 'บัญชีธนาคาร' },
  { key: 'floors', label: 'จัดการชั้น' },
  { key: 'plan', label: 'ผังห้อง' },
  { key: 'rate', label: 'ค่าห้อง' },
  { key: 'status', label: 'สถานะห้อง' },
  { key: 'roomServices', label: 'ค่าบริการรายห้อง' }
]

export default function SetupWizard({ apartment, onFinish, onExit }) {
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(false)

  const step = STEPS[index]
  const isLast = index === STEPS.length - 1

  if (done) {
    return (
      <div className="wizard">
        <WizardTopbar apartment={apartment} onExit={onExit} />
        <div className="wizard-complete">
          <div className="wizard-complete-card">
            <span className="wizard-check">
              <Icon name="check" />
            </span>
            <h2>การตั้งค่าเสร็จเรียบร้อย</h2>
            <p className="muted">{apartment.nameTh} พร้อมใช้งานแล้ว</p>
            <button type="button" className="btn" onClick={() => onFinish(apartment)}>
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

      <main className="wizard-body">
        <h1 className="wizard-title">ตั้งค่าหอพัก</h1>

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
                // ย้อนกลับไปแก้ขั้นที่ผ่านมาแล้วได้ แต่กระโดดข้ามไปข้างหน้าไม่ได้
                // (ต้นแบบก็เด้งกลับถ้าพยายามข้าม — ลองมาแล้ว)
                onClick={() => i < index && setIndex(i)}
                disabled={i > index}
              >
                <span className="wizard-step-number">{i < index ? '✓' : i + 1}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </nav>

          <section className="wizard-content">
            <StepContent stepKey={step.key} apartment={apartment} />

            <div className="wizard-actions">
              {index > 0 && (
                <button type="button" className="btn btn-ghost" onClick={() => setIndex(index - 1)}>
                  ย้อนกลับ
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => (isLast ? setDone(true) : setIndex(index + 1))}
              >
                {isLast ? 'เสร็จสิ้น' : 'ต่อไป'}
              </button>
            </div>
          </section>
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
        {/* ออกกลางคันได้ ค่าที่บันทึกไปแล้วไม่หาย — แต่ละขั้นบันทึกทันทีอยู่แล้ว
            ไม่ได้รอกด "เสร็จสิ้น" ทีเดียว */}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExit}>
          ตั้งค่าต่อภายหลัง
        </button>
      </div>
    </header>
  )
}

function StepContent({ stepKey, apartment }) {
  switch (stepKey) {
    case 'services':
      return <ApartmentServicesPage apartment={apartment} />
    case 'meters':
      return <UtilitySettingsPage apartment={apartment} />
    case 'banks':
      return <BankAccountsPage apartment={apartment} />
    case 'floors':
      return <FloorPlanPage apartment={apartment} stage="builder" />
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
