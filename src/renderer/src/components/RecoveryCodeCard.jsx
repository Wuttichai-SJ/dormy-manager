import React, { useState } from 'react'
import Icon from '../Icon.jsx'

// รหัสสำรองแสดงครั้งเดียว — ต้องติ๊กยืนยันก่อนไปต่อ
export default function RecoveryCodeCard({ code, title, description, doneLabel, onDone }) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
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
          <strong>จดรหัสนี้เก็บไว้ทันที — แสดงครั้งเดียว</strong>
          <p>
            ลืมรหัสผ่านและทำรหัสนี้หาย = <b>เข้าบัญชีนี้ไม่ได้อีกเลย</b>
          </p>
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
