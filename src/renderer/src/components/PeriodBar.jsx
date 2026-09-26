import React from 'react'
import Icon from '../Icon.jsx'

// แถบเลือกช่วงเวลาของหน้ารายการ (เฟิสขอ 2026-09-26 — ข้อมูลงอกทุกเดือน เลื่อนหาลำบาก
// และดูไม่ออกว่าแถวไหนของเดือนไหน)
//
// งานหอพักเป็นรอบรายเดือน จึงใช้ "เดือน" เป็นตัวแบ่งหลักแทนการแบ่งหน้า (pagination)
// — หน้า 3 ไม่บอกว่าเป็นเดือนอะไร และการเลือกหลายใบเพื่อพิมพ์จะขาดตอนข้ามหน้า
//
// period = { mode: 'month' | 'year' | 'all', month: 'YYYY-MM' }
//   · month เก็บไว้แม้อยู่โหมดปี/ทั้งหมด — สลับกลับมาโหมดเดือนแล้วยังอยู่เดือนเดิม
//   · ปีของโหมด "ปี" = 4 ตัวแรกของ month
const MODES = [
  { key: 'month', label: 'รายเดือน' },
  { key: 'year', label: 'รายปี' },
  { key: 'all', label: 'ทั้งหมด' }
]

const MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
]

export function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function initialPeriod() {
  return { mode: 'month', month: currentMonth() }
}

// 'YYYY-MM' -> 'ตุลาคม 2026' (ปี ค.ศ. เหมือนวันที่อื่นบนหน้าจอ — พ.ศ. ใช้เฉพาะบนเอกสาร)
export function formatMonthName(month) {
  const [y, m] = String(month ?? '').split('-').map(Number)
  if (!y || !m) return '-'
  return `${MONTH_NAMES[m - 1]} ${y}`
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ช่วงเวลา -> ตัวกรองรอบเดือนที่ main เข้าใจ ({ billingMonth } / { billingYear } / {})
export function billingPeriodFilter(period) {
  if (period.mode === 'month') return { billingMonth: period.month }
  if (period.mode === 'year') return { billingYear: period.month.slice(0, 4) }
  return {}
}

// ช่วงเวลา -> ช่วงวันที่ 'YYYY-MM-DD' (สำหรับหน้าที่กรองตามวันที่ เช่นใบเสร็จ)
export function periodDateRange(period) {
  if (period.mode === 'all') return { from: '', to: '' }
  const [y, m] = period.month.split('-').map(Number)
  if (period.mode === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` }
  const last = new Date(y, m, 0).getDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${last}` }
}

// ป้ายของช่วงที่กำลังดู — ใช้ในข้อความ "ไม่มีข้อมูลของ…"
export function periodLabel(period) {
  if (period.mode === 'month') return `เดือน${formatMonthName(period.month)}`
  if (period.mode === 'year') return `ปี ${period.month.slice(0, 4)}`
  return 'ทุกช่วงเวลา'
}

export default function PeriodBar({ period, onChange }) {
  const { mode, month } = period
  const step = (delta) =>
    onChange({ ...period, month: shiftMonth(month, mode === 'year' ? delta * 12 : delta) })

  const now = currentMonth()
  const atNow = mode === 'month' ? month === now : month.slice(0, 4) === now.slice(0, 4)
  const unit = mode === 'year' ? 'ปี' : 'เดือน'

  return (
    <div className="period-bar">
      <div className="period-modes" role="tablist" aria-label="ช่วงเวลา">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            className={mode === m.key ? 'period-mode period-mode-active' : 'period-mode'}
            onClick={() => onChange({ ...period, mode: m.key })}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode !== 'all' && (
        <div className="period-step">
          <button
            type="button"
            className="period-arrow"
            onClick={() => step(-1)}
            aria-label={`${unit}ก่อนหน้า`}
          >
            <Icon name="chevronLeft" />
          </button>
          <strong className="period-label" aria-live="polite">
            {mode === 'year' ? `ปี ${month.slice(0, 4)}` : formatMonthName(month)}
          </strong>
          <button
            type="button"
            className="period-arrow"
            onClick={() => step(1)}
            aria-label={`${unit}ถัดไป`}
          >
            <Icon name="chevronRight" />
          </button>
          {!atNow && (
            <button
              type="button"
              className="link-btn period-today"
              onClick={() => onChange({ ...period, month: now })}
            >
              {mode === 'year' ? 'ปีนี้' : 'เดือนนี้'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// จัดแถวเป็นกลุ่มตามเดือน เรียงเดือนล่าสุดก่อน — ลำดับแถวในกลุ่มคงตามที่ส่งมา
export function groupByMonth(rows, monthOf) {
  const groups = new Map()
  for (const row of rows) {
    const key = monthOf(row) || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([month, items]) => ({ month, items }))
}
