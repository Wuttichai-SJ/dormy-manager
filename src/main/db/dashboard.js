// ใช้ฟังก์ชันเดียวกับหน้าอื่นแล้วสรุป — ตัวเลขจะตรงกับหน้ารายงานเสมอ
import { listRoomsForApartment } from './contracts.js'
import { listInvoices } from './invoices.js'
import { listMaintenanceRequests } from './maintenance.js'
import { listBatches } from './meterReadings.js'
import { listReceipts } from './payments.js'
import { listTerminations } from './terminations.js'

export const TOP_OVERDUE_LIMIT = 5

export function getDashboardSummary(db, apartmentId, { today } = {}) {
  if (!apartmentId) throw new Error('ไม่พบหอพัก')

  const asOf = today ?? todayIso()
  if (!isDate(asOf)) throw new Error('วันที่ไม่ถูกต้อง')

  // เดือนของวันนี้ = เดือนที่ต้องออกบิล
  const billingMonth = asOf.slice(0, 7)
  const previousMonth = shiftMonth(billingMonth, -1)

  const outstandingInvoices = listInvoices(db, apartmentId, {
    settlement: 'outstanding',
    today: asOf
  })

  // เรียงตามวันที่เกินกำหนดก่อน แล้วค่อยยอดเงิน
  const topOverdue = [...outstandingInvoices]
    .sort((a, b) => b.overdueDays - a.overdueDays || b.outstandingCents - a.outstandingCents)
    .slice(0, TOP_OVERDUE_LIMIT)
    .map((invoice) => ({
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      roomNumber: invoice.roomNumber,
      dueDate: invoice.dueDate,
      outstandingCents: invoice.outstandingCents,
      overdueDays: invoice.overdueDays
    }))

  const thisMonth = monthRange(billingMonth)
  const lastMonth = monthRange(previousMonth)
  const revenueThis = listReceipts(db, apartmentId, thisMonth)
  const revenueLast = listReceipts(db, apartmentId, lastMonth)

  const rooms = listRoomsForApartment(db, apartmentId)
  const byStatus = (status) => rooms.filter((room) => room.status === status).length

  const batches = listBatches(db, apartmentId)
  const latestBatch = batches[0] ?? null
  const monthBatch = findBatchForMonth(batches, billingMonth)

  const maintenance = listMaintenanceRequests(db, apartmentId)
  const moveOuts = listTerminations(db, apartmentId)
  const billing = countMonthlyBillingProgress(db, apartmentId, billingMonth)

  return {
    asOf,
    billingMonth,
    previousMonth,

    outstanding: {
      totalCents: outstandingInvoices.reduce((sum, i) => sum + i.outstandingCents, 0),
      invoiceCount: outstandingInvoices.length,
      overdueCount: outstandingInvoices.filter((i) => i.overdueDays > 0).length
    },
    topOverdue,

    revenue: {
      monthCents: revenueThis.totalAmountCents,
      previousMonthCents: revenueLast.totalAmountCents,
      deltaCents: revenueThis.totalAmountCents - revenueLast.totalAmountCents,
      receiptCount: revenueThis.receiptCount,
      from: thisMonth.dateFrom,
      to: thisMonth.dateTo
    },

    rooms: {
      total: rooms.length,
      occupied: byStatus('occupied'),
      vacant: byStatus('vacant'),
      maintenance: byStatus('maintenance'),
      // นับจากใบจองที่ยังกันห้อง ไม่ใช่ rooms.status
      booked: rooms.filter((room) => room.booking).length,
      occupancyPercent: rooms.length === 0 ? 0 : Math.round((byStatus('occupied') / rooms.length) * 100)
    },

    tasks: {
      meter: {
        hasBatchThisMonth: Boolean(monthBatch),
        batchDate: monthBatch?.readingDate ?? null,
        roomCount: monthBatch?.roomCount ?? 0,
        latestBatchDate: latestBatch?.readingDate ?? null
      },
      billing,
      maintenance: {
        openCount: maintenance.openCount,
        repairCostTotalCents: maintenance.repairCostTotalCents
      },
      moveOut: {
        unpaidCount: moveOuts.unpaidCount,
        unpaidTotalCents: moveOuts.unpaidTotalCents
      }
    }
  }
}

// ค้นใบของเดือนนี้จากทั้งรายการ — ไม่ดูแค่ใบล่าสุด
function findBatchForMonth(batches, month) {
  const ofMonth = batches.filter((batch) => batch.readingDate.slice(0, 7) === month)
  // เดือนเดียวมีหลายใบได้ — เอาใบที่กรอกแล้วก่อน
  return ofMonth.find((batch) => batch.roomCount > 0) ?? ofMonth[0] ?? null
}

// ต้องตรงกับ previewMonthlyBilling: นับเฉพาะ active และข้ามสัญญาที่เริ่มเดือนนี้
function countMonthlyBillingProgress(db, apartmentId, billingMonth) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS expected,
              COALESCE(SUM(
                CASE WHEN EXISTS (
                  SELECT 1 FROM invoices i
                   WHERE i.contract_id = c.contract_id
                     AND i.billing_month = @billingMonth
                     AND i.invoice_type = 'monthly'
                     AND i.status <> 'cancelled'
                ) THEN 1 ELSE 0 END
              ), 0) AS issued
         FROM contracts c
         JOIN rooms r  ON r.room_id = c.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE f.apartment_id = @apartmentId
          AND c.status = 'active'
          AND substr(COALESCE(c.start_date, ''), 1, 7) <> @billingMonth`
    )
    .get({ apartmentId, billingMonth })

  return {
    expected: row.expected,
    issued: row.issued,
    remaining: row.expected - row.issued
  }
}

function monthRange(month) {
  const [year, monthPart] = month.split('-').map(Number)
  const last = new Date(year, monthPart, 0).getDate()
  return { dateFrom: `${month}-01`, dateTo: `${month}-${pad2(last)}` }
}

function shiftMonth(month, delta) {
  const [year, monthPart] = month.split('-').map(Number)
  const shifted = new Date(year, monthPart - 1 + delta, 1)
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}`
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}
