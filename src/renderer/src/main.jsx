import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
// ฟอนต์เก็บไว้ในเครื่อง ไม่ดึงจาก Google Fonts — ต้อง import ก่อน styles.css
import './assets/fonts/noto-sans-thai/noto-sans-thai.css'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
