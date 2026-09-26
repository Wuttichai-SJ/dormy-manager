import React from 'react'

// กันจอขาวเมื่อคอมโพเนนต์ throw — แสดง error และกลับไปทำงานต่อได้
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
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
