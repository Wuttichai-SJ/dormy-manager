import React from 'react'
import Icon from '../Icon.jsx'

// กล่องข้อความแจ้งเตือนของฟอร์ม
// ฝั่ง main รวมข้อผิดพลาดหลายข้อมาเป็นสตริงเดียวคั่นด้วย \n (ดู validateUserInput)
// ตรงนี้จึงแตกกลับเป็นรายการ เพื่อให้ผู้ใช้เห็นครบทุกข้อที่ต้องแก้ในรอบเดียว
export default function Alert({ kind = 'error', children }) {
  if (!children) return null

  const lines = typeof children === 'string' ? children.split('\n').filter(Boolean) : null
  const icon = kind === 'error' ? 'warning' : 'check'

  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div>
        {lines ? (
          lines.length === 1 ? (
            <p>{lines[0]}</p>
          ) : (
            <ul>
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )
        ) : (
          children
        )}
      </div>
    </div>
  )
}
