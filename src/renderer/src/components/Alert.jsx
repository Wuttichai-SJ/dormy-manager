import React from 'react'
import Icon from '../Icon.jsx'

// แตกข้อความที่คั่นด้วย \n เป็นรายการ
export default function Alert({ kind = 'error', children }) {
  if (!children) return null

  const lines = typeof children === 'string' ? children.split('\n').filter(Boolean) : null
  const icon = kind === 'success' ? 'check' : 'warning'

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
