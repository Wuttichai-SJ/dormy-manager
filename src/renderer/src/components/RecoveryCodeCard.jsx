import React, { useState } from 'react'
import Icon from '../Icon.jsx'

// จอที่แสดง "รหัสสำรอง" ซึ่งเป็นครั้งเดียวที่รหัสตัวจริงออกมาจาก main process
// ในฐานข้อมูลเก็บแต่ hash เพราะฉะนั้นถ้าผู้ใช้ปิดจอนี้ไปโดยไม่จด = ไม่มีใครกู้คืนให้ได้อีก
// จอนี้จึงบังคับติ๊กยืนยันก่อนไปต่อ โดยตั้งใจให้เสียเวลาเล็กน้อยตรงนี้ดีกว่าเสียบัญชีทั้งใบ
export default function RecoveryCodeCard({ code, title, description, doneLabel, onDone }) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // คลิปบอร์ดถูกปฏิเสธไม่ใช่เรื่องคอขาดบาดตาย — รหัสยังอยู่บนจอให้จดด้วยมือได้
      setCopied(false)
    }
  }

  return (
    <div className="auth-card auth-card-wide">
      <div className="auth-head">
        <div className="auth-icon-badge">
          <Icon name="shield" />
        </div>
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>

      <div className="recovery-code">
        <code>{code}</code>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copyCode}>
          <Icon name="copy" />
          <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
        </button>
      </div>

      <div className="alert alert-warn">
        <Icon name="warning" />
        <div>
          <strong>จดรหัสนี้เก็บไว้ในที่ปลอดภัยทันที</strong>
          <p>
            ระบบนี้ทำงานแบบออฟไลน์ ไม่มีเซิร์ฟเวอร์กลางและไม่มีการส่ง SMS หรืออีเมล
            หากลืมรหัสผ่านและทำรหัสสำรองนี้หายพร้อมกัน <b>จะไม่มีวิธีเข้าใช้งานบัญชีนี้ได้อีกเลย</b>
          </p>
          <p>รหัสนี้จะแสดงเพียงครั้งเดียว เมื่อปิดหน้านี้แล้วจะเรียกดูซ้ำไม่ได้</p>
        </div>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>ฉันจดรหัสสำรองนี้เก็บไว้เรียบร้อยแล้ว</span>
      </label>

      <button type="button" className="btn btn-block" disabled={!acknowledged} onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  )
}
