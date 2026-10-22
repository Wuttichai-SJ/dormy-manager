import React, { useEffect, useRef } from 'react'
import Icon from '../Icon.jsx'

// ดูรูปขนาดใหญ่ · images = [src] · Esc/คลิกพื้นหลังปิด · ลูกศรซ้ายขวาเลื่อนรูป
export default function ImageViewer({ images, index, onIndexChange, onClose, alt = '' }) {
  const closeRef = useRef(null)
  const count = images.length
  const hasMany = count > 1
  const go = (step) => onIndexChange((index + step + count) % count)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    // capture + stopPropagation — Esc ต้องไม่ไปปิดหน้าต่างอื่นข้างใต้
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (hasMany && e.key === 'ArrowLeft') go(-1)
      else if (hasMany && e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="modal-backdrop image-viewer" role="dialog" aria-modal="true" aria-label="ดูรูป" onMouseDown={onClose}>
      <div className="image-viewer-stage" onMouseDown={(e) => e.stopPropagation()}>
        <img src={images[index]} alt={alt} />
      </div>

      <button
        ref={closeRef}
        type="button"
        className="image-viewer-btn image-viewer-close"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClose}
        aria-label="ปิด"
        title="ปิด (Esc)"
      >
        <Icon name="close" />
      </button>

      {hasMany && (
        <>
          <button
            type="button"
            className="image-viewer-btn image-viewer-prev"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => go(-1)}
            aria-label="รูปก่อนหน้า"
          >
            <Icon name="chevronLeft" />
          </button>
          <button
            type="button"
            className="image-viewer-btn image-viewer-next"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => go(1)}
            aria-label="รูปถัดไป"
          >
            <Icon name="chevronRight" />
          </button>
          <span className="image-viewer-count">
            {index + 1} / {count}
          </span>
        </>
      )}
    </div>
  )
}
