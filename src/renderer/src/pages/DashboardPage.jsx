import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { formatBaht } from '../format.js'
import { getDashboardSummary } from '../services/dashboardService.js'

// หน้าแรกของหอ — หน้าที่เด้งขึ้นทุกครั้งที่เข้ามาทำงานในหอหนึ่ง
//
// ตอบสามคำถามตามลำดับที่เจ้าของหอถามจริง:
//   1. เงินตอนนี้เป็นยังไง        → การ์ดสามใบ
//   2. เดือนนี้มีอะไรที่ยังไม่ได้ทำ → "สิ่งที่ต้องทำ"
//   3. ต้องไปตามใครก่อน           → ตารางบิลค้างนานสุด
//
// **ไม่มีกราฟโดยตั้งใจ** — ค่าเช่าเป็นก้อนเกือบคงที่ทุกเดือน กราฟ 12 เดือนจะเป็นเส้นตรง
// ที่บอกอะไรไม่ได้เกินตัวเลข "เทียบเดือนก่อน" และต้องวาด SVG เองเพิ่มโค้ดที่ต้องดูแลต่อ
//
// ตัวเลขทั้งหมดมาจาก `dashboard:summary` ช่องเดียว ซึ่งฝั่ง main เรียกฟังก์ชันเดียวกับ
// ที่แต่ละหน้าใช้ — หน้านี้จึงไม่มีการคำนวณเงินเองเลยแม้แต่จุดเดียว
export default function DashboardPage({ apartment, onNavigate, onOpenInvoice }) {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await getDashboardSummary(apartment.apartmentId)
    if (!res.success) return setError(res.error)
    setError('')
    setSummary(res.data)
  }, [apartment.apartmentId])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <Alert>{error}</Alert>
  if (!summary) return <p className="muted">กำลังโหลด...</p>

  const { outstanding, revenue, rooms, tasks, topOverdue } = summary

  return (
    <>
      <div className="room-stats">
        {/* ค้างชำระมาก่อนรายรับ — เงินที่ยังไม่เข้าคือสิ่งที่ต้องลงมือทำอะไรกับมัน
            ส่วนเงินที่เข้ามาแล้วเป็นแค่การรายงานผล */}
        <div className={'stat-card' + (outstanding.totalCents > 0 ? ' highlight' : '')}>
          <div className="stat-card-value">{formatBaht(outstanding.totalCents)}</div>
          <div className="stat-card-label">ค้างชำระทั้งหอ (บาท)</div>
          <div className="stat-card-note">
            {outstanding.invoiceCount === 0
              ? 'ไม่มีบิลค้าง'
              : `${outstanding.invoiceCount} ใบ` +
                (outstanding.overdueCount > 0 ? ` · เกินกำหนด ${outstanding.overdueCount} ใบ` : '')}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-value">{formatBaht(revenue.monthCents)}</div>
          <div className="stat-card-label">
            รายรับเดือน {formatBillingMonth(summary.billingMonth)} (บาท)
          </div>
          {/* เทียบเดือนก่อนด้วยตัวเลขจริง ไม่ใช่เปอร์เซ็นต์ — หอเล็กมีเดือนที่ห้องว่าง
              หลายห้อง เปอร์เซ็นต์จะเหวี่ยงจนอ่านไม่ได้ความ ส่วนจำนวนบาทเทียบกันได้ตรงๆ */}
          <div className="stat-card-note">
            เดือนก่อน {formatBaht(revenue.previousMonthCents)}
            {revenue.deltaCents !== 0 && (
              <span className={revenue.deltaCents < 0 ? ' negative' : ''}>
                {' '}
                ({revenue.deltaCents > 0 ? '+' : '-'}
                {formatBaht(Math.abs(revenue.deltaCents))})
              </span>
            )}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-value">
            {rooms.vacant} / {rooms.total}
          </div>
          <div className="stat-card-label">ห้องว่าง / ทั้งหมด</div>
          <div className="stat-card-note">
            {rooms.total === 0
              ? 'ยังไม่มีห้องพักในหอนี้'
              : `มีคนอยู่ ${rooms.occupied} (${rooms.occupancyPercent}%)` +
                (rooms.booked > 0 ? ` · จองแล้ว ${rooms.booked}` : '') +
                (rooms.maintenance > 0 ? ` · ปิดปรับปรุง ${rooms.maintenance}` : '')}
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head-row">
          <h2 className="panel-title">สิ่งที่ต้องทำ</h2>
        </div>

        <ul className="dash-tasks">
          <MeterTask task={tasks.meter} month={summary.billingMonth} onNavigate={onNavigate} />
          <BillingTask
            task={tasks.billing}
            month={summary.billingMonth}
            onNavigate={onNavigate}
          />

          <TaskRow
            done={tasks.maintenance.openCount === 0}
            icon="maintenance"
            text={
              tasks.maintenance.openCount === 0
                ? 'ไม่มีงานแจ้งซ่อมค้าง'
                : `แจ้งซ่อมค้าง ${tasks.maintenance.openCount} งาน`
            }
            action="ดูงานซ่อม"
            onAction={() => onNavigate('maintenance')}
          />

          {/* แถวนี้โผล่เฉพาะตอนมีเงินค้างจริง ต่างจากสามแถวบนที่ขึ้นเสมอ —
              จดมิเตอร์/ออกบิล/งานซ่อมเป็นงานประจำที่ต้องรู้ว่า "ทำแล้ว" ส่วนการตามเก็บ
              เงินย้ายออกไม่ใช่งานประจำ ขึ้นว่า "ไม่มี" ทุกเดือนคือบรรทัดที่คนเลิกอ่าน */}
          {tasks.moveOut.unpaidCount > 0 && (
            <TaskRow
              done={false}
              icon="moveOuts"
              text={`ตามเก็บเงินย้ายออก ${tasks.moveOut.unpaidCount} ราย · ${formatBaht(
                tasks.moveOut.unpaidTotalCents
              )} บาท`}
              action="ดูประวัติ"
              onAction={() => onNavigate('moveOuts')}
            />
          )}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head-row">
          <h2 className="panel-title">บิลค้างชำระนานสุด</h2>
          {outstanding.invoiceCount > topOverdue.length && (
            <button type="button" className="link-btn" onClick={() => onNavigate('invoices')}>
              ดูทั้งหมด ({outstanding.invoiceCount} ใบ) →
            </button>
          )}
        </div>

        {topOverdue.length === 0 ? (
          <p className="muted table-empty">ไม่มีบิลค้างชำระ</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ห้อง</th>
                <th>เลขที่</th>
                <th>ครบกำหนด</th>
                <th className="align-right">ยอดค้าง</th>
                <th>เกินกำหนด</th>
                <th className="align-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {topOverdue.map((invoice) => (
                <tr key={invoice.invoiceId}>
                  <td>
                    <span className="room-badge">{invoice.roomNumber}</span>
                  </td>
                  <td>{invoice.invoiceNumber}</td>
                  <td>{formatDate(invoice.dueDate)}</td>
                  <td className="align-right">{formatBaht(invoice.outstandingCents)}</td>
                  {/* บิลที่ยังไม่ถึงกำหนดก็อยู่ในตารางนี้ (ค้างชำระเหมือนกัน) แต่ต้องไม่
                      เขียนว่า "0 วัน" ซึ่งอ่านเหมือนเพิ่งเลยกำหนดวันนี้ */}
                  <td className={invoice.overdueDays > 0 ? 'negative' : ''}>
                    {invoice.overdueDays > 0 ? `${invoice.overdueDays} วัน` : 'ยังไม่ถึงกำหนด'}
                  </td>
                  <td className="align-right">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => onOpenInvoice(invoice.invoiceId)}
                    >
                      รายละเอียด
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

// ------------------------------------------------------------------
function TaskRow({ done, icon, text, action, onAction }) {
  return (
    <li className={'dash-task' + (done ? ' done' : '')}>
      <span className="dash-task-mark">
        <Icon name={done ? 'check' : 'warning'} />
      </span>
      <Icon name={icon} className="dash-task-icon" />
      <span className="dash-task-text">{text}</span>
      {onAction && (
        <button type="button" className="btn btn-outline btn-sm" onClick={onAction}>
          {action}
        </button>
      )}
    </li>
  )
}

// ใบจดของเดือนนี้มีสามสภาพ ไม่ใช่สอง — "สร้างใบไว้แต่ยังไม่กรอกห้องไหนเลย" ต้องแยกจาก
// "จดแล้ว" ไม่งั้นคนกดสร้างใบเปล่าไว้ตอนต้นเดือนแล้วหน้าแรกจะขึ้นติ๊กถูกทั้งที่ยังไม่ได้จด
function MeterTask({ task, month, onNavigate }) {
  const readable = task.latestBatchDate ? formatDate(task.latestBatchDate) : null

  if (!task.hasBatchThisMonth) {
    return (
      <TaskRow
        done={false}
        icon="meters"
        text={
          `ยังไม่ได้จดมิเตอร์เดือน ${formatBillingMonth(month)}` +
          (readable ? ` (ใบล่าสุด ${readable})` : '')
        }
        action="ไปจดมิเตอร์"
        onAction={() => onNavigate('meters')}
      />
    )
  }

  if (task.latestBatchRoomCount === 0) {
    return (
      <TaskRow
        done={false}
        icon="meters"
        text={`สร้างใบจดมิเตอร์ ${readable} ไว้แล้ว แต่ยังไม่ได้กรอกเลขห้องไหนเลย`}
        action="ไปกรอกเลข"
        onAction={() => onNavigate('meters')}
      />
    )
  }

  return (
    <TaskRow
      done
      icon="meters"
      text={`จดมิเตอร์เดือนนี้แล้ว (ใบวันที่ ${readable} · ${task.latestBatchRoomCount} ห้อง)`}
      action="ดูใบจด"
      onAction={() => onNavigate('meters')}
    />
  )
}

// "ครบ" หมายถึงครบเท่าที่ระบบจะออกให้ได้ — ห้องที่เพิ่งย้ายเข้าเดือนนี้ถูกนับออกจาก
// ตัวหารแล้วฝั่ง main (จ่ายค่าเช่าเดือนแรกไปตอนย้ายเข้า ออกบิลอีกใบคือเก็บซ้ำ)
function BillingTask({ task, month, onNavigate }) {
  if (task.expected === 0) {
    return (
      <TaskRow
        done
        icon="invoices"
        text={`เดือน ${formatBillingMonth(month)} ยังไม่มีห้องที่ต้องออกบิล`}
      />
    )
  }

  const label = `ออกบิลเดือน ${formatBillingMonth(month)} แล้ว ${task.issued}/${task.expected} ห้อง`

  return (
    <TaskRow
      done={task.remaining === 0}
      icon="invoices"
      text={task.remaining === 0 ? `${label} — ครบทุกห้อง` : `${label} — เหลือ ${task.remaining} ห้อง`}
      action={task.remaining === 0 ? 'ดูใบแจ้งหนี้' : 'ไปออกบิล'}
      onAction={() => onNavigate('invoices')}
    />
  )
}

// วันที่และเดือนบนหน้าจอเป็น ค.ศ. แบบเดียวกับหน้าใบแจ้งหนี้/การชำระเงินที่หน้านี้ลิงก์ไป
// (ปี พ.ศ. ใช้เฉพาะบนเอกสารที่ยื่นให้ผู้เช่า — ดู format.js)
function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

function formatBillingMonth(month) {
  if (!month) return '-'
  const [y, m] = String(month).split('-')
  return `${m}-${y}`
}
