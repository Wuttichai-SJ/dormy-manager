import React, { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'

// ToastHost อยู่ระดับบนตัวเดียว — เรียก showToast() ได้จากทุกหน้า
const listeners = new Set()
let nextId = 1

// kind: 'success' | 'error'
export function showToast(message, kind = 'success') {
  const toast = { id: nextId++, message, kind }
  listeners.forEach((fn) => fn(toast))
}

export function ToastHost() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    const add = (toast) => setToasts((list) => [...list, toast])
    listeners.add(add)
    return () => listeners.delete(add)
  }, [])

  function dismiss(id) {
    setToasts((list) => list.filter((t) => t.id !== id))
  }

  if (toasts.length === 0) return null

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

const LIFETIME_MS = 4000
const LEAVE_MS = 220

function ToastItem({ toast, onDismiss }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const start = setTimeout(() => setLeaving(true), LIFETIME_MS)
    const remove = setTimeout(onDismiss, LIFETIME_MS + LEAVE_MS)
    return () => {
      clearTimeout(start)
      clearTimeout(remove)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isError = toast.kind === 'error'

  return (
    <div
      className={`toast toast-${toast.kind}` + (leaving ? ' leaving' : '')}
      role={isError ? 'alert' : 'status'}
    >
      <Icon name={isError ? 'warningSolid' : 'checkSolid'} />
      <span>{toast.message}</span>
    </div>
  )
}
