import React, { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'

// ข้อความแจ้งผลลอยมุมขวาบน — ลอกจากต้นแบบ (แถบเขียวอ่อน ไอคอนวงกลมติ๊กถูก
// กว้าง 356px ห่างขอบ 24px หายเองใน 4 วินาที)
//
// ทำไมต้องมีตัวเก็บสถานะนอก React: หน้าที่สั่งให้ขึ้นข้อความ (ฟอร์มเพิ่มหอพัก) ถูก
// ถอดออกจากจอทันทีหลังบันทึกสำเร็จ เพราะระบบพาไปตัวช่วยตั้งค่าต่อ ถ้าผูกข้อความไว้
// กับ state ของฟอร์ม ข้อความจะถูกถอดไปพร้อมกันจนไม่ทันเห็น จึงให้ <ToastHost /> อยู่
// ระดับ App.jsx ตัวเดียวตลอดอายุแอป แล้วหน้าไหนก็เรียก showToast() เข้ามาได้
const listeners = new Set()
let nextId = 1

// kind: 'success' (เขียว) | 'error' (แดง) — ต้นแบบใช้แถบแดงตัวเดียวกันนี้บอกว่า
// "ยังติดตั้งค่าตั้งต้นไม่สมบูรณ์" ตอนพยายามเข้าหอที่ยังตั้งค่าไม่ครบ
export function showToast(message, kind = 'success') {
  const toast = { id: nextId++, message, kind }
  listeners.forEach((fn) => fn(toast))
}

export function ToastHost() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    const add = (toast) => setToasts((list) => [...list, toast])
    listeners.add(add)
    return () => listeners.delete(add)
  }, [])

  function dismiss(id) {
    setToasts((list) => list.filter((t) => t.id !== id))
  }

  if (toasts.length === 0) return null

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

// อยู่ 4 วินาทีแล้วเลื่อนออกทางขวา = ทางเดียวกับที่เลื่อนเข้ามา
// แยกเป็นสองจังหวะ (ตั้ง leaving ก่อน แล้วค่อยถอดออกจริง) เพราะถ้าถอด DOM ทิ้งเลย
// อนิเมชันขาออกจะไม่มีโอกาสได้เล่น ข้อความจะหายวับไปเฉยๆ
const LIFETIME_MS = 4000
const LEAVE_MS = 220

function ToastItem({ toast, onDismiss }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const start = setTimeout(() => setLeaving(true), LIFETIME_MS)
    const remove = setTimeout(onDismiss, LIFETIME_MS + LEAVE_MS)
    return () => {
      clearTimeout(start)
      clearTimeout(remove)
    }
    // onDismiss ผูกกับ id ที่ไม่เปลี่ยน จึงตั้งเวลาครั้งเดียวพอ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isError = toast.kind === 'error'

  return (
    <div
      className={`toast toast-${toast.kind}` + (leaving ? ' leaving' : '')}
      role={isError ? 'alert' : 'status'}
    >
      <Icon name={isError ? 'warningSolid' : 'checkSolid'} />
      <span>{toast.message}</span>
    </div>
  )
}
