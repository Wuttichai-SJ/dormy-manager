import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ToastHost } from './components/Toast.jsx'
// ฟอนต์เก็บไว้ในเครื่อง ไม่ดึงจาก Google Fonts — ต้อง import ก่อน styles.css
import './assets/fonts/noto-sans-thai/noto-sans-thai.css'
import './styles.css'

// <ToastHost /> อยู่นอก <App /> โดยตั้งใจ: App สลับหน้าด้วยการคืน tree คนละชุด
// (หน้ารวม / ตัวช่วยตั้งค่า / หน้าทำงาน) ถ้าเอาไปไว้ข้างใน ข้อความแจ้งผลจะถูกถอด
// พร้อมหน้าที่เพิ่งสั่งให้มันขึ้น — ซึ่งคือกรณี "บันทึกหอใหม่แล้วเด้งไปตัวช่วยตั้งค่า" พอดี
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <ToastHost />
  </React.StrictMode>
)
