// หน้าภาพรวมของหอ — ตัวเลขทุกตัวบนหน้าแรกมาจากไฟล์นี้ที่เดียว
//
// **ไฟล์นี้แทบไม่มีคิวรีของตัวเอง โดยตั้งใจ** — มันเรียกฟังก์ชันเดียวกับที่หน้าอื่นเรียก
// (`listInvoices` `listReceipts` `listRoomsForApartment` `listMaintenanceRequests`
//  `listTerminations`) แล้วสรุปผล เหตุผล: ถ้าเขียนคิวรีนับเงินใหม่ที่นี่ วันหนึ่งกติกา
// ฝั่งหน้ารายงานเปลี่ยน (เช่นใบเสร็จที่ยกเลิกแล้วไม่นับในยอด) แต่ที่นี่ไม่เปลี่ยนตาม
// แล้วหน้าแรกจะรายงานตัวเลขที่ไม่ตรงกับหน้าที่มันสรุป ซึ่งแย่กว่าไม่มีหน้าแรกเลย —
// เจ้าของหอจะไม่รู้ว่าควรเชื่อหน้าไหน
//
// มีคิวรีของตัวเองอยู่ที่เดียวคือ "ออกบิลเดือนนี้ไปกี่ห้องแล้ว" เพราะ `previewMonthlyBilling`
// ต้องมีใบจดมิเตอร์ก่อนจะเรียกได้ และมันประกอบรายการบิลของทุกห้องเพื่อคำนวณยอดจริง
// ซึ่งหนักเกินความจำเป็นสำหรับการนับหัว — กฎการนับจึงถูกลอกมาแทน **และมีเทสต์
// ไล่เทียบกับ `previewMonthlyBilling` ทีละห้องว่าสองที่นับตรงกัน** (ดู test:dashboard)
//
// ห้าม import logger.js หรืออะไรที่ลาก electron เข้ามา (เทสต์รันใต้ ELECTRON_RUN_AS_NODE)
import { listRoomsForApartment } from './contracts.js'
import { listInvoices } from './invoices.js'
import { listMaintenanceRequests } from './maintenance.js'
import { listBatches } from './meterReadings.js'
import { listReceipts } from './payments.js'
import { listTerminations } from './terminations.js'

// ตารางบิลค้างบนหน้าแรกเป็นทางลัดไปหาห้องที่ต้องโทรตาม ไม่ใช่รายงานฉบับเต็ม
// (ยาวกว่านี้คือหน้า "ใบแจ้งหนี้" ซึ่งมีตัวกรองครบอยู่แล้ว)
export const TOP_OVERDUE_LIMIT = 5

export function getDashboardSummary(db, apartmentId, { today } = {}) {
  if (!apartmentId) throw new Error('ไม่พบหอพัก')

  const asOf = today ?? todayIso()
  if (!isDate(asOf)) throw new Error('วันที่ไม่ถูกต้อง')

  // เดือนของ "วันนี้" = เดือนที่ต้องออกบิล — หอนี้ออกบิลวันที่ 1 แล้วเรียกชื่อบิลตาม
  // เดือนค่าเช่า ซึ่งคือเดือนของวันที่ออกบิล (ดูกติกาใน db/invoices.js)
  const billingMonth = asOf.slice(0, 7)
  const previousMonth = shiftMonth(billingMonth, -1)

  // ---------------------------------------------------------------
  // ค้างชำระ
  // ---------------------------------------------------------------
  // ส่ง today ลงไปด้วย เพื่อให้ "เกินกำหนดกี่วัน" ทุกแถวนับจากวันเดียวกับหัวข้อของหน้า
  const outstandingInvoices = listInvoices(db, apartmentId, {
    settlement: 'outstanding',
    today: asOf
  })

  // เรียงตามจำนวนวันที่เกินกำหนดก่อน แล้วค่อยยอดเงิน — คำถามคือ "ใครค้างนานสุด"
  // ไม่ใช่ "ใครค้างเยอะสุด" (ค้างนานคือสัญญาณว่าตามไม่ได้ ค้างเยอะอาจเพิ่งออกบิลไป)
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

  // ---------------------------------------------------------------
  // รายรับเดือนนี้ เทียบเดือนก่อน
  // ---------------------------------------------------------------
  // `listReceipts` คืน "เงินที่เข้าหอจริง" อยู่แล้ว = หักใบคืนเงิน + ไม่นับใบที่ยกเลิก
  const thisMonth = monthRange(billingMonth)
  const lastMonth = monthRange(previousMonth)
  const revenueThis = listReceipts(db, apartmentId, thisMonth)
  const revenueLast = listReceipts(db, apartmentId, lastMonth)

  // ---------------------------------------------------------------
  // ห้อง
  // ---------------------------------------------------------------
  const rooms = listRoomsForApartment(db, apartmentId)
  const byStatus = (status) => rooms.filter((room) => room.status === status).length

  // ---------------------------------------------------------------
  // สิ่งที่ต้องทำ
  // ---------------------------------------------------------------
  const batches = listBatches(db, apartmentId)
  // listBatches เรียงใหม่ก่อนอยู่แล้ว
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
      // ติดลบได้ = เดือนนี้เก็บได้น้อยกว่าเดือนก่อน
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
      // นับจากใบจองที่ยังกันห้องอยู่ ไม่ใช่จาก rooms.status — ห้องที่มีคนจองยังว่างจริง
      // (เหตุผลเต็มๆ อยู่ใน listRoomsForApartment)
      booked: rooms.filter((room) => room.booking).length,
      // ปัดเป็นจำนวนเต็ม — ทศนิยมของอัตราการเข้าพักไม่มีใครใช้ตัดสินอะไร
      occupancyPercent: rooms.length === 0 ? 0 : Math.round((byStatus('occupied') / rooms.length) * 100)
    },

    tasks: {
      meter: {
        // ยังไม่มีใบจดของเดือนนี้ = งานประจำเดือนที่ยังไม่ได้เริ่ม
        hasBatchThisMonth: Boolean(monthBatch),
        // ใบของ "เดือนที่สรุป" (null = เดือนนี้ยังไม่มีใบ) — คนละตัวกับใบล่าสุดของหอ
        batchDate: monthBatch?.readingDate ?? null,
        // ใบที่สร้างแล้วแต่ยังไม่ได้กรอกห้องไหนเลย ต่างจากยังไม่มีใบ — ทั้งสองแบบยังทำไม่เสร็จ
        roomCount: monthBatch?.roomCount ?? 0,
        // ใบล่าสุดของหอไม่ว่าเดือนไหน — ใช้บอกว่าครั้งล่าสุดที่จดคือใบไหน ตอนเดือนนี้ยังไม่มีใบ
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

// ---------------------------------------------------------------
// ใบจดมิเตอร์ของเดือนที่สรุป
// ---------------------------------------------------------------
// 🔴 **ต้องค้นทั้งรายการ ห้ามดูแค่ใบล่าสุด** (บั๊กที่เจอจริง 2026-08-17)
//
// ของเดิมเทียบเดือนของ `batches[0]` ซึ่งพังทันทีที่มีใบของเดือนหลังกว่านอนอยู่ข้างหน้า:
// วันที่ 31 ส.ค. คนสร้างใบของวันที่ 1 ก.ย. ไว้ล่วงหน้า → หน้าแรกบอกว่าเดือน ส.ค.
// ยังไม่ได้จด ทั้งที่จดและออกบิลไปแล้วทั้งเดือน · และถ้าใครพิมพ์ปีผิดครั้งเดียว
// (01/09/2027 แทน 01/09/2026 — ช่องวันที่รับค่านั้นเพราะเป็นวันที่มีอยู่จริง)
// แถวนี้จะขึ้นเตือนผิดทุกเดือนไปอีกปีกว่า แล้วคนจะเลิกเชื่อแถวนี้ทั้งแถว
// ซึ่งเท่ากับไม่มีมันตั้งแต่แรก
//
// คำถามที่ถูกคือ "เดือนนี้มีใบจดแล้วหรือยัง" ไม่ใช่ "ใบล่าสุดเป็นของเดือนนี้ไหม"
function findBatchForMonth(batches, month) {
  const ofMonth = batches.filter((batch) => batch.readingDate.slice(0, 7) === month)
  // เดือนเดียวมีหลายใบได้ (สร้างใบเปล่าไว้ผิดแล้วสร้างใหม่) — เอาใบที่กรอกแล้วก่อน
  // ไม่งั้นใบเปล่าที่ค้างอยู่จะทำให้เดือนที่จดครบแล้วขึ้นว่า "ยังไม่ได้กรอกเลขห้องไหนเลย"
  return ofMonth.find((batch) => batch.roomCount > 0) ?? ofMonth[0] ?? null
}

// ---------------------------------------------------------------
// ออกบิลเดือนนี้ไปกี่ห้องแล้ว
// ---------------------------------------------------------------
// 🔴 กฎสองข้อนี้ต้องตรงกับ `previewMonthlyBilling` / `createMonthlyInvoicesForApartment`
// เป๊ะๆ ไม่งั้นหน้าแรกจะบอกว่า "ยังไม่ครบ" ตลอดไปสำหรับห้องที่ระบบตั้งใจข้าม แล้วคน
// จะกดปุ่มออกบิลซ้ำทุกวันเพื่อตามหาห้องที่ไม่มีอยู่:
//   1. นับเฉพาะสัญญาที่ status = 'active'
//   2. **ข้ามสัญญาที่เริ่มในเดือนที่กำลังออกบิล** (จ่ายค่าเช่าเดือนแรกไปแล้วตอนย้ายเข้า)
// บิลที่ยกเลิกแล้วไม่นับว่า "ออกแล้ว" — ห้องนั้นต้องออกใหม่
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

// ------------------------------------------------------------------
// 'YYYY-MM' -> { dateFrom: 'YYYY-MM-01', dateTo: วันสุดท้ายของเดือน }
//
// วันสุดท้ายให้ Date คิดเอง (วันที่ 0 ของเดือนถัดไป) ไม่ฮาร์ดโค้ด 28/30/31 และไม่ต้อง
// รู้เรื่องปีอธิกสุรทิน
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
