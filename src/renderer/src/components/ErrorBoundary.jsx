import React from 'react'

// กันจอขาว — React ถอดทั้งต้นไม้ทิ้งเมื่อคอมโพเนนต์ไหนก็ตาม throw ระหว่างเรนเดอร์
// ผลคือหน้าจอว่างเปล่าสนิท ไม่มีข้อความ ไม่มีปุ่ม ไม่มีอะไรบอกว่าเกิดอะไรขึ้น
//
// **เจอจริง 2026-08-10** — เรียกฟังก์ชันที่ไม่มีอยู่ในไฟล์ (`today()` แทน `todayIso()`)
// `npm run build` ผ่าน เพราะ esbuild ไม่ตรวจตัวแปรที่ไม่มีอยู่จริง และชุดทดสอบก็ไม่ผ่าน
// หน้าจอเลยสักไฟล์ ผู้ใช้จึงเจอแค่จอขาวแล้วต้องมาถามว่าเกิดอะไรขึ้น
//
// ตัวนี้ไม่ได้กันบั๊ก แต่ทำให้บั๊กบอกตัวเองได้ — เห็นชื่อไฟล์กับบรรทัดทันทีแทนที่จะต้อง
// ไล่เดา และที่สำคัญกว่าคือ **งานที่ค้างอยู่ไม่หายไปกับจอ** กดย้อนกลับแล้วทำต่อได้
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // console ของหน้าจอไปโผล่ที่ DevTools ไม่ใช่ main.log — แต่ยังดีกว่าไม่มีร่องรอยเลย
    console.error('[ErrorBoundary] หน้าจอพัง:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <section className="panel error-screen">
        <h2>หน้านี้ทำงานผิดพลาด</h2>
        <p className="muted">
          ข้อมูลที่บันทึกไว้แล้วไม่ได้หายไปไหน — กด “ลองใหม่” เพื่อกลับเข้าหน้าเดิม
          ถ้ายังพังซ้ำที่เดิม ให้ถ่ายหน้าจอนี้ไว้แล้วแจ้งผู้ดูแลระบบ
        </p>

        {/* ข้อความดิบของ error — ไม่ซ่อน เพราะคนที่เจอจอนี้ต้องเอาไปบอกต่อได้ */}
        <pre className="error-screen-detail">{String(this.state.error?.message ?? this.state.error)}</pre>

        <div className="card-foot">
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            ลองใหม่
          </button>
        </div>
      </section>
    )
  }
}
