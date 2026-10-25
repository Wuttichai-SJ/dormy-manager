import React from 'react'
import { MONTH_NAMES } from './PeriodBar.jsx'
import { BUDDHIST_YEAR_OFFSET, formatBaht } from '../format.js'

// ประมาณจำนวนแถวต่อแผ่น A4 — ใช้คิด maxPages ของกล่องพิมพ์
export const SUMMARY_ROWS_PER_PAGE = 30

export function summaryPageCount(summary) {
  return summary.groups.reduce((n, g) => n + Math.max(1, Math.ceil(g.rows.length / SUMMARY_ROWS_PER_PAGE)), 0)
}

// ติดบอร์ดหน้าตึก — ตึกละหน้า หัวตารางซ้ำทุกแผ่น
export default function OutstandingSummaryDocument({ summary, apartmentName, printedAt }) {
  const [year, month] = summary.billingMonth.split('-').map(Number)
  const monthText = `${MONTH_NAMES[month - 1]} ${year + BUDDHIST_YEAR_OFFSET}`
  const columns = summary.hasOther ? 7 : 6

  return (
    <div className="outstanding-sheets">
      {summary.groups.map((group) => (
        <article key={group.buildingName ?? ''} className="outstanding-doc">
          <table className="outstanding-table">
            <thead>
              <tr>
                <th colSpan={columns} className="outstanding-head">
                  <h2>สรุปยอดค้างชำระ</h2>
                  <div className="outstanding-sub">
                    <span>
                      {apartmentName}
                      {group.buildingName && ` · ${group.buildingName}`} · ประจำเดือน{monthText}
                    </span>
                    <span>ออกเอกสารวันที่ {formatDateTime(printedAt)}</span>
                  </div>
                </th>
              </tr>
              <tr>
                <th>หมายเลขห้อง</th>
                <th>ชื่อ</th>
                <th className="align-right">ค่าเช่าห้อง</th>
                <th className="align-right">ค่าน้ำ</th>
                <th className="align-right">ค่าไฟ</th>
                {summary.hasOther && <th className="align-right">อื่นๆ</th>}
                <th className="align-right">รวมทั้งหมด</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.invoiceId}>
                  <td>{row.roomNumber}</td>
                  <td>{row.tenantName && `คุณ ${row.tenantName}`}</td>
                  <td className="align-right">{formatBaht(row.rentCents)}</td>
                  <td className="align-right">{formatBaht(row.waterCents)}</td>
                  <td className="align-right">{formatBaht(row.electricCents)}</td>
                  {summary.hasOther && <td className="align-right">{formatBaht(row.otherCents)}</td>}
                  <td className="align-right outstanding-total">{formatBaht(row.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ))}
    </div>
  )
}

function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear() + BUDDHIST_YEAR_OFFSET} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
