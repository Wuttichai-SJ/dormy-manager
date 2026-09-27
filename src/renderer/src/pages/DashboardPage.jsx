import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import { formatBaht } from '../format.js'
import { getDashboardSummary } from '../services/dashboardService.js'

// ตัวเลขทั้งหมดมาจาก dashboard:summary — หน้านี้ไม่คำนวณเงินเอง
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
          <h2 className="panel-title">สิ่งที่ต้องทำเดือน {formatBillingMonth(summary.billingMonth)}</h2>
        </div>

        <ul className="dash-tasks">
          <MeterTask task={tasks.meter} onNavigate={onNavigate} />
          <BillingTask task={tasks.billing} onNavigate={onNavigate} />

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
              <span>ดูทั้งหมด ({outstanding.invoiceCount} ใบ)</span>
              <Icon name="chevronRight" />
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
                  {/* บิลที่ยังไม่ถึงกำหนดต้องไม่ขึ้น "0 วัน" */}
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

// batchDate = ใบของเดือนที่สรุป · latestBatchDate = ใบล่าสุดของหอ
function MeterTask({ task, onNavigate }) {
  if (!task.hasBatchThisMonth) {
    return (
      <TaskRow
        done={false}
        icon="meters"
        text={
          'ยังไม่ได้จดมิเตอร์'
        }
        action="ไปจดมิเตอร์"
        onAction={() => onNavigate('meters')}
      />
    )
  }

  const readable = formatDate(task.batchDate)

  if (task.roomCount === 0) {
    return (
      <TaskRow
        done={false}
        icon="meters"
        text={`ใบจดมิเตอร์ ${readable} ยังไม่ได้กรอก`}
        action="ไปกรอกเลข"
        onAction={() => onNavigate('meters')}
      />
    )
  }

  return (
    <TaskRow
      done
      icon="meters"
      text={`จดมิเตอร์แล้ว ${task.roomCount} ห้อง`}
      action="ดูใบจด"
      onAction={() => onNavigate('meters')}
    />
  )
}

// ห้องที่ย้ายเข้าเดือนนี้ถูกนับออกจากตัวหารแล้วที่ main
function BillingTask({ task, onNavigate }) {
  if (task.expected === 0) {
    return (
      <TaskRow
        done
        icon="invoices"
        text="ยังไม่มีห้องที่ต้องออกบิล"
      />
    )
  }

  const label = `ออกบิลแล้ว ${task.issued}/${task.expected} ห้อง`

  return (
    <TaskRow
      done={task.remaining === 0}
      icon="invoices"
      text={label}
      action={task.remaining === 0 ? 'ดูใบแจ้งหนี้' : 'ไปออกบิล'}
      onAction={() => onNavigate('invoices')}
    />
  )
}

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
