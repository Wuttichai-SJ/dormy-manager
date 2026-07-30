// สะพานเดียวที่ฝั่งหน้าจอใช้คุยกับ main process — ไฟล์ services/*.js อื่นเรียกผ่านที่นี่
// ทุกช่องคืนซองเดียวกัน: { success: true, data } หรือ { success: false, error }

// `npm run dev:web` เปิดหน้าจอในเบราว์เซอร์เปล่าๆ ที่ไม่มี preload ให้เรียก
// ตรงนี้จึงต้องคืน error ที่อ่านรู้เรื่องแทนการ throw ให้ทั้งหน้าจอขาว
export async function invoke(channel, payload) {
  if (!window.electron) {
    return { success: false, error: 'โหมดเบราว์เซอร์ — ไม่มีการเชื่อมต่อระบบ (ต้องรัน npm run dev)' }
  }
  try {
    return await window.electron.invoke(channel, payload)
  } catch (err) {
    // ถ้ามาถึงตรงนี้แปลว่าสะพาน IPC เองมีปัญหา (เช่นยังไม่ได้ลงทะเบียนช่องนั้น)
    return { success: false, error: err?.message ?? 'เรียกใช้ระบบไม่สำเร็จ' }
  }
}
