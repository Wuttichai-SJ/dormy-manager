import React, { useEffect } from 'react'
import Icon from '../Icon.jsx'
import Alert from './Alert.jsx'

// wide = กว้างเกือบเต็มจอ
export default function Modal({
  title,
  icon,
  onClose,
  onSubmit,
  submitLabel = 'บันทึก',
  busy,
  wide,
  error,
  children
}) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={'modal' + (wide ? ' modal-wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>
            {icon && <Icon name={icon} />}
            <span>{title}</span>
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="ปิด">
            <Icon name="close" />
          </button>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <div className="modal-body">
            <Alert>{error}</Alert>
            {children}
          </div>

          <footer className="modal-foot">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              ปิด
            </button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'กำลังบันทึก...' : submitLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
