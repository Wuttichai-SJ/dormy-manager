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
//
// `brief` = แถบครีมหัวการ์ดที่ต้นแบบใช้บอกว่าขั้นนี้ต้องทำอะไร (หัวข้อ + ข้อย่อย หรือ
// ประโยคเดียวถ้าอธิบายจบในบรรทัดเดียว) ข้อความเป็นของเราเอง เพราะบางขั้นทำงานไม่เหมือน
// ต้นแบบเป๊ะ — ยกเว้นขั้น "ค่าบริการ" กับ "จัดการชั้น" ที่ลอกคำของต้นแบบมาตรงๆ
const STEPS = [
  {
    key: 'services',
    label: 'ค่าบริการ',
    brief: { text: 'ค่าบริการเพิ่มเติมที่เรียกเก็บ เช่น ค่าอินเตอร์เน็ต, ค่าที่จอดรถ, ค่าฟิตเนส' }
  },
  {
    key: 'meters',
    label: 'การคิดค่าน้ำ / ค่าไฟ',
    brief: {
      title: 'วิธีคิดค่าน้ำและค่าไฟ',
      points: [
        'เลือกวิธีคิดแยกกันได้ระหว่างค่าน้ำกับค่าไฟ',
        'ตามมิเตอร์ที่ใช้จริง / ตามมิเตอร์แบบมีขั้นต่ำ / เหมาจ่ายรายเดือน',
        'ค่าที่ตั้งที่นี่จะถูกคัดลอกไปให้ห้องที่สร้างทีหลังโดยอัตโนมัติ'
      ]
    }
  },
  {
    key: 'banks',
    label: 'บัญชีธนาคาร',
    brief: {
      title: 'บัญชีรับชำระเงิน',
      points: [
        'บัญชีที่จะนำไปแสดงในใบแจ้งหนี้ให้ผู้เช่าโอนเข้า',
        'แนะนำไม่เกิน 2 บัญชี ผู้เช่าจะได้ไม่สับสนว่าต้องโอนเข้าบัญชีไหน'
      ]
    }
  },
  {
    key: 'floors',
    label: 'จัดการชั้น',
    brief: {
      title: 'จำนวนชั้น',
      points: ['เลือกจำนวนชั้น', 'ระบุจำนวนห้องต่อชั้น สูงสุดได้ไม่เกิน 50 ห้อง/ชั้น']
    }
  },
  {
    key: 'plan',
    label: 'ผังห้อง',
    brief: {
      title: 'เลขห้องพัก',
      points: [
        'ระบบตั้งเลขห้องให้อัตโนมัติตามชั้น เช่น 101 102 201',
        'แก้เลขห้องเป็นเลขที่ใช้จริงในหอได้ ห้ามซ้ำกันภายในหอเดียวกัน'
      ]
    }
  },
  {
    key: 'rate',
    label: 'ค่าห้อง',
    brief: {
      title: 'ค่าเช่าห้อง',
      points: [
        'ตั้งค่าเช่าทีเดียวได้หลายห้องพร้อมกัน',
        'ค่าเช่ารายวันเว้นว่างไว้ได้ ถ้าหอนี้ไม่รับเช่ารายวัน'
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
        'ห้องที่มีผู้เช่าอยู่แล้วตั้งเป็น "ไม่ว่าง" ไว้ก่อน แล้วค่อยทำสัญญาย้อนหลัง'
      ]
    }
  },
  {
    key: 'roomServices',
    label: 'ค่าบริการรายห้อง',
    brief: {
      title: 'ผูกค่าบริการเข้ากับห้อง',
      points: [
        'เลือกค่าบริการจากขั้นที่ 1 แล้วผูกเข้าหลายห้องพร้อมกันได้',
        'ห้องที่ไม่ได้ผูกค่าบริการไว้ จะไม่ถูกเรียกเก็บรายการนั้นในใบแจ้งหนี้'
      ]
    }
  }
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
        <div className="hub-band">หอพัก</div>
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
      <div className="hub-band">หอพัก</div>

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
                {/* ต้นแบบคงเลขลำดับไว้ทุกขั้น ไม่ได้เปลี่ยนขั้นที่ผ่านแล้วเป็นเครื่องหมายถูก
                    — ใช้สีของวงกลมบอกแทนว่าผ่านไปแล้ว */}
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

            {/* key = ขั้นที่กำลังอยู่ บังคับให้ React สร้างหน้าใหม่ทุกครั้งที่เปลี่ยนขั้น
                ขั้น 6/7/8 ใช้คอมโพเนนต์ตัวเดียวกัน (RoomRatesPage) ถ้าไม่มี key React จะ
                มองว่าเป็นตัวเดิมแล้วแค่ส่ง prop ใหม่ — state ที่ตั้งต้นจาก prop จะไม่อัปเดต
                กลายเป็นกดไปขั้นอื่นแล้วยังเห็นหน้าเดิม */}
            <div className="wizard-card-body">
              <StepContent key={step.key} stepKey={step.key} apartment={apartment} />
            </div>
          </section>
        </div>

        <div className="wizard-actions">
          <button
            type="button"
            className="btn"
            onClick={() => (isLast ? setDone(true) : setIndex(index + 1))}
          >
            {isLast ? 'เสร็จสิ้น' : 'ต่อไป'}
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
