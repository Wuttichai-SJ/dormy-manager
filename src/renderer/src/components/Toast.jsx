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

export function showToast(message) {
  const toast = { id: nextId++, message }
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

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000)
    return () => clearTimeout(timer)
    // onDismiss ผูกกับ id ที่ไม่เปลี่ยน จึงตั้งเวลาครั้งเดียวพอ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="toast" role="status">
      <Icon name="checkSolid" />
      <span>{toast.message}</span>
    </div>
  )
}
