// สะพานเดียวที่ฝั่งหน้าจอใช้คุยกับ main process — ไฟล์ services/*.js อื่นเรียกผ่านที่นี่
// ทุกช่องคืนซองเดียวกัน: { success: true, data } หรือ { success: false, error, fields? }
// fields = { ชื่อช่อง: ข้อความ } เมื่อ main รู้ว่าผิดที่ช่องไหน (ดู components/FieldError.jsx)

// `npm run dev:web` เปิดหน้าจอในเบราว์เซอร์เปล่าๆ ที่ไม่มี preload ให้เรียก
// ตรงนี้จึงต้องคืน error ที่อ่านรู้เรื่องแทนการ throw ให้ทั้งหน้าจอขาว
export async function invoke(channel, payload) {
  if (!window.electron) {
    return { success: false, error: 'โหมดเบราว์เซอร์ — ไม่มีการเชื่อมต่อระบบ (ต้องรัน npm run dev)' }
  }
  try {
    return await window.electron.invoke(channel, payload)
  } catch (err) {
    const message = err?.message ?? ''

    // ช่องที่ยังไม่ได้ลงทะเบียน = โปรเซสหลักที่กำลังรันอยู่เก่ากว่าโค้ดบนดิสก์
    //
    // เกิดตอนพัฒนาเป็นประจำ: หน้าจอถูก hot-reload ไปแล้วแต่โปรเซสหลักไม่ได้รีสตาร์ต
    // จึงยังไม่รู้จักช่องที่เพิ่งเพิ่ม — ข้อความดิบของ Electron เป็นอังกฤษและไม่ได้บอกว่า
    // ต้องทำอะไรต่อ ทำให้เสียเวลาไล่หาบั๊กในโค้ดที่ไม่ได้ผิด
    if (message.includes('No handler registered')) {
      return {
        success: false,
        error: `ระบบยังไม่รู้จักคำสั่ง "${channel}" — โปรเซสหลักที่รันอยู่เก่ากว่าโค้ดปัจจุบัน กรุณาปิดแอปแล้วเปิดใหม่`
      }
    }

    return { success: false, error: message || 'เรียกใช้ระบบไม่สำเร็จ' }
  }
}
