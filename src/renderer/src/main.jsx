import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ToastHost } from './components/Toast.jsx'
// ฟอนต์ในเครื่อง — ต้อง import ก่อน styles.css
import './assets/fonts/noto-sans-thai/noto-sans-thai.css'
import './styles.css'

// ToastHost อยู่นอก App และนอก ErrorBoundary — toast ต้องไม่หายตอนเปลี่ยนหน้าหรือหน้าจอพัง
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <ToastHost />
  </React.StrictMode>
)
