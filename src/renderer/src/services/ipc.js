// คืน { success: true, data } หรือ { success: false, error, fields? }

// npm run dev:web ไม่มี preload
export async function invoke(channel, payload) {
  if (!window.electron) {
    return { success: false, error: 'โหมดเบราว์เซอร์ — ไม่มีการเชื่อมต่อระบบ (ต้องรัน npm run dev)' }
  }
  try {
    return await window.electron.invoke(channel, payload)
  } catch (err) {
    const message = err?.message ?? ''

    // main process เก่ากว่าโค้ด — ต้องรีสตาร์ต npm run dev
    if (message.includes('No handler registered')) {
      return {
        success: false,
        error: `ระบบยังไม่รู้จักคำสั่ง "${channel}" — โปรเซสหลักที่รันอยู่เก่ากว่าโค้ดปัจจุบัน กรุณาปิดแอปแล้วเปิดใหม่`
      }
    }

    return { success: false, error: message || 'เรียกใช้ระบบไม่สำเร็จ' }
  }
}
