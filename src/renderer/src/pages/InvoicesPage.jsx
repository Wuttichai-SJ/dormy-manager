import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from '../components/FieldError.jsx'
import InfoTip from '../components/InfoTip.jsx'
import Modal from '../components/Modal.jsx'
import DateField from '../components/DateField.jsx'
import PeriodBar, {
  billingPeriodFilter,
  formatMonthName,
  groupByMonth,
  initialPeriod,
  periodLabel
} from '../components/PeriodBar.jsx'
import { showToast } from '../components/Toast.jsx'
import { INVOICE_STATUS_LABELS } from '../constants.js'
import { formatBaht } from '../format.js'
import InvoiceDetailPage from './InvoiceDetailPage.jsx'
import MultiPaymentPage from './MultiPaymentPage.jsx'
import InvoiceBill from '../components/InvoiceBill.jsx'
import PrintDialog from '../components/PrintDialog.jsx'
import { listMeterBatches } from '../services/meterService.js'
import { getImageDataUrl } from '../services/imageService.js'
import {
  createMonthlyInvoice,
  createMonthlyInvoicesForApartment,
  deleteInvoice,
  getInvoice,
  listInvoices,
  previewMonthlyBilling
} from '../services/invoiceService.js'

const EMPTY_FILTERS = { roomNumber: '', invoiceNumber: '' }

// แท็บกรองตามการชำระ — `settlement` ต้องตรงกับ SETTLEMENT_STATUSES ใน db/invoices.js
//
// "ค้างชำระ" รวมบิลที่จ่ายมาบางส่วนด้วย เพราะยังเป็นหนี้ที่ต้องตามเก็บอยู่
//
// "ยกเลิกแล้ว" เป็นแท็บของตัวเอง (ผู้ใช้ขอ 2026-08-11) — เดิมบิลที่ยกเลิกไม่เข้าแท็บไหนเลย
// ต้องไปหาเอาใน "ทั้งหมด" ปนกับบิลที่ยังต้องตามเก็บเงิน · **"ทั้งหมด" ยังหมายถึงทั้งหมดจริงๆ
// คือเห็นบิลที่ยกเลิกด้วย** แท็บใหม่เป็นทางลัดไปหาเฉพาะกลุ่ม ไม่ได้ย้ายมันออกจากทั้งหมด
// (ป้ายที่เขียนว่า "ทั้งหมด" แล้วซ่อนของบางอย่างไว้ คือป้ายที่โกหก)
const SETTLEMENT_TABS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'outstanding', label: 'ค้างชำระ' },
  { key: 'paid', label: 'ชำระแล้ว' },
  { key: 'cancelled', label: 'ยกเลิกแล้ว' }
]

// หน้าใบแจ้งหนี้ — รายการบิลที่ออกไปแล้ว + ทางเข้าไปออกบิลรอบใหม่
//
// โครงตามต้นแบบ (คู่มือ yeeraf หัวข้อ "ออกบิลรายเดือน"): กดปุ่มออกบิล → ตัวช่วย 2 ขั้น
// (เลือกใบจดมิเตอร์+เดือน → ตารางพรีวิวทุกห้องแล้วกดสร้าง) ไม่ใช่กรอกทีละห้องเอง
// `initialInvoiceId` = เปิดหน้านี้พร้อมกางบิลใบนั้นให้เลย (หน้าภาพรวมกดจากตารางบิลค้าง)
// **ผู้เรียกต้องใส่ `key` ที่เปลี่ยนตามค่านี้** ไม่งั้นการกดบิลใบที่สองจากหน้าภาพรวมจะไม่มี
// อะไรเกิดขึ้น เพราะ useState อ่าน prop แค่ตอน mount ครั้งแรก (บทเรียนเดียวกับ
// RoomRatesPage ที่เอา prop ไปตั้งเป็นค่าเริ่มต้นแล้วขั้น 6/7/8 ค้างหน้าเดิม)
export default function InvoicesPage({ apartment, user, initialInvoiceId = null }) {
  const [wizard, setWizard] = useState(false)
  const [multiPay, setMultiPay] = useState(false)
  // บิลที่กำลังเปิดดูอยู่ — null = อยู่ที่ตารางรายการ
  const [openInvoiceId, setOpenInvoiceId] = useState(initialInvoiceId)
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // '' = ทั้งหมด · แยกจาก filters ตัวอื่นเพราะปุ่ม "รีเซ็ต" ของแถบค้นหาไม่ควรเด้งแท็บกลับด้วย
  // — แท็บคือ "กำลังดูอะไรอยู่" ส่วนแถบค้นหาคือ "หาอะไรในสิ่งที่ดูอยู่"
  const [settlement, setSettlement] = useState('')
  // ช่วงเวลาที่ดู — เปิดมาเป็นเดือนนี้ (บิลออกวันที่ 1 รอบเดือนของบิล = เดือนที่ออก)
  // เดิมเปิดมาเห็นบิลทุกเดือนต่อกันยาว ดูไม่ออกว่าแถวไหนของเดือนไหน (เฟิสขอ 2026-09-26)
  const [period, setPeriod] = useState(initialPeriod)
  // เดือนที่ผู้ใช้กดพับ/กางเอง (สลับจากค่าเริ่มต้น) — ล้างทุกครั้งที่เปลี่ยนช่วงเวลา
  const [toggled, setToggled] = useState(() => new Set())
  // บิลที่กำลังยืนยันจะลบอยู่ — null = ไม่มีหน้าต่างเปิดค้าง
  const [deleting, setDeleting] = useState(null)
  // ชุดเอกสารที่เตรียมไว้พิมพ์ทีเดียวทั้งหอ — null = ไม่ได้อยู่ในโหมดพิมพ์
  const [printSet, setPrintSet] = useState(null)
  const [busy, setBusy] = useState(false)

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const hasFilters = Object.values(filters).some((v) => v !== '')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listInvoices(apartment.apartmentId, {
      settlement: settlement || undefined,
      roomNumber: filters.roomNumber.trim() || undefined,
      invoiceNumber: filters.invoiceNumber.trim() || undefined,
      ...billingPeriodFilter(period)
    })
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setInvoices(res.data)
  }, [apartment.apartmentId, settlement, filters, period])

  function changePeriod(next) {
    setPeriod(next)
    setToggled(new Set())
  }

  // ดูหลายเดือน: เดือนล่าสุดกางไว้ เดือนเก่าพับ · กำลังค้นหา = กางหมด (จะได้เห็นที่หาเจอทันที)
  const groups = groupByMonth(invoices, (inv) => inv.billingMonth)
  const multiMonth = period.mode !== 'month'
  const isOpen = (month, index) => {
    const byDefault = !multiMonth || hasFilters || index === 0
    return toggled.has(month) ? !byDefault : byDefault
  }
  const toggleMonth = (month) =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })

  useEffect(() => {
    load()
  }, [load])

  // บิลที่ยกเลิกแล้วไม่เข้าชุดพิมพ์ — เอกสารที่ไม่มีผลแล้วต้องไม่หลุดไปถึงมือผู้เช่า
  // ที่เหลือคือ "ทุกใบที่เห็นอยู่ในตารางตอนนี้" จริงๆ ตัวกรองด้านบนจึงเป็นตัวเลือกชุด
  const printable = invoices.filter((inv) => inv.status !== 'cancelled')

  // เตรียมเอกสารให้ครบก่อนเปิดกล่องพิมพ์ ไม่ใช่ระหว่างที่กล่องเปิดอยู่ — ถ้าดึงทีหลัง
  // printToPDF อาจจับภาพตอนที่เอกสารยังไม่มีรายการ แล้วได้บิลเปล่า (เหมือนหน้ารายงานใบเสร็จ)
  async function startBulkPrint() {
    setError('')
    setBusy(true)

    // รายการบิลในตารางมีแต่ยอดรวม ตัวเอกสารต้องการรายการ ผู้เช่า บัญชีธนาคาร ครบทั้งใบ
    const results = await Promise.all(printable.map((inv) => getInvoice(inv.invoiceId)))
    const failed = results.find((res) => !res.success)
    if (failed) {
      setBusy(false)
      return setError(failed.error)
    }
    const bills = results.map((res) => res.data)

    // QR เป็นรูปเดียวกันทั้งหอ โหลดครั้งเดียวแล้วส่งต่อให้ทุกใบ — ปล่อยให้แต่ละใบโหลดเอง
    // คือลากไบต์รูปเดิมข้ามสะพาน IPC ซ้ำเท่าจำนวนบิล
    const qrImageId = bills[0]?.apartment?.qrCodeImageId
    let qrDataUrl = null
    if (qrImageId) {
      const res = await getImageDataUrl(qrImageId)
      if (res.success) qrDataUrl = res.data.dataUrl
    }

    setBusy(false)
    setPrintSet({ bills, qrDataUrl })
  }

  if (openInvoiceId) {
    return (
      <InvoiceDetailPage
        invoiceId={openInvoiceId}
        signedBy={user?.fullName}
        // ยกเลิกใบเสร็จเป็นของเจ้าของหอเท่านั้น (main บังคับที่ payment:cancel)
        canCancelReceipt={Boolean(user?.isOwner)}
        onBack={() => {
          setOpenInvoiceId(null)
          load()
        }}
      />
    )
  }

  if (wizard) {
    return (
      <BillingWizard
        apartment={apartment}
        onClose={() => {
          setWizard(false)
          load()
        }}
      />
    )
  }

  if (multiPay) {
    return (
      <MultiPaymentPage
        apartment={apartment}
        onBack={() => {
          setMultiPay(false)
          load()
        }}
      />
    )
  }

  // ระหว่างพิมพ์ หน้าจอแสดงเฉพาะตัวเอกสาร เพราะ printToPDF จับภาพหน้าที่กำลังแสดงอยู่
  // (กล่องพิมพ์เองถูกซ่อนด้วย @media print อยู่แล้ว) — วิธีเดียวกับหน้ารายงานใบเสร็จ
  if (printSet) {
    return (
      <>
        <div className="invoice-sheets">
          {printSet.bills.map((bill) => (
            <article key={bill.invoiceId} className="invoice-sheet">
              {/* เอกสารตัวเดียวกับที่เปิดทีละใบจากปุ่ม "รายละเอียด" — ไม่ส่ง onRemoveItem
                  คอลัมน์ปุ่มลบจึงหายไปเอง */}
              <InvoiceBill
                invoice={bill}
                signedBy={user?.fullName}
                qrDataUrl={printSet.qrDataUrl}
              />
            </article>
          ))}
        </div>

        {/* ใบแจ้งหนี้เป็น A4 เต็มแผ่นใบละหน้า (ต่างจากใบเสร็จที่สองใบต่อแผ่น)
            จำนวนหน้าที่ควรมีจึงเท่ากับจำนวนใบพอดี */}
        <PrintDialog
          title={`พิมพ์ใบแจ้งหนี้ ${printSet.bills.length} ใบ`}
          maxPages={printSet.bills.length}
          onClose={() => setPrintSet(null)}
          onPrinted={() => {
            setPrintSet(null)
            showToast(`ส่งใบแจ้งหนี้ ${printSet.bills.length} ใบเข้าเครื่องพิมพ์แล้ว`)
          }}
        />
      </>
    )
  }

  return (
    <>
      <section className="panel">
        <Alert>{error}</Alert>

        <div className="panel-head-row">
          <h2 className="panel-title">
            รายการใบแจ้งหนี้
            <InfoTip
              title="พิมพ์ใบแจ้งหนี้ทุกห้อง"
              points={[
                'พิมพ์ทุกใบในช่วงเวลาและแท็บที่เลือก ใบละหนึ่งแผ่น',
                'ต้องการเฉพาะบางชุด ให้เลือกเดือนหรือแท็บก่อน',
                'ใบที่ยกเลิกแล้วจะไม่ถูกพิมพ์'
              ]}
            />
          </h2>
          {/* สองปุ่มนี้คือสองงานที่ทำบ่อยที่สุดของหน้านี้: ออกบิลต้นเดือน แล้วตามเก็บเงิน
              รับเงินหลายห้องเป็นปุ่มรอง เพราะออกบิลต้องเกิดก่อนเสมอ */}
          <div className="panel-head-actions">
            {/* พิมพ์ทั้งชุดในคราวเดียว — เดิมต้องเข้าไปกด "รายละเอียด" ทีละใบแล้วสั่งพิมพ์
                ซึ่งหอสี่สิบห้องคือสี่สิบรอบ · พิมพ์ "ทุกใบที่เห็นในตารางตอนนี้"
                ตัวกรองกับแท็บด้านล่างจึงเป็นตัวเลือกชุดไปในตัว (เช่น แท็บค้างชำระ) */}
            <button
              type="button"
              className="btn btn-outline"
              onClick={startBulkPrint}
              disabled={busy || printable.length === 0}
            >
              <Icon name="printer" />
              <span>
                {busy ? 'กำลังเตรียมเอกสาร...' : `พิมพ์ใบแจ้งหนี้ทุกห้อง (${printable.length})`}
              </span>
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setMultiPay(true)}>
              <Icon name="payments" />
              <span>รับเงินหลายห้อง</span>
            </button>
            <button type="button" className="btn" onClick={() => setWizard(true)}>
              <Icon name="plus" />
              <span>ออกบิลรายเดือน</span>
            </button>
          </div>
        </div>

        {/* แท็บกรองตามการชำระ อยู่เหนือแถบค้นหา เพราะเป็นการเลือก "ชุดข้อมูล" ที่จะดู
            ส่วนแถบค้นหาคือการหาของในชุดนั้น สองอย่างนี้ทำงานร่วมกัน ไม่ได้แทนกัน */}
        <div className="settlement-tabs" role="tablist">
          {SETTLEMENT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={settlement === tab.key}
              className={
                settlement === tab.key ? 'settlement-tab settlement-tab-active' : 'settlement-tab'
              }
              onClick={() => setSettlement(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* แท็บนี้เป็นที่เดียวที่ปุ่มลบถาวรโผล่ (ลบได้เฉพาะใบที่ยกเลิกแล้ว) จึงต้องบอกไว้
            ว่ากดแล้วเกิดอะไร ก่อนที่จะมีคนกดเพราะเห็นถังขยะแล้วคิดว่าเป็นการเก็บกวาดเฉยๆ */}
        {settlement === 'cancelled' && (
          <p className="field-hint">ใบที่ยกเลิกพิมพ์ไม่ได้ · ลบถาวรต้องกรอกเหตุผล</p>
        )}

        {/* ช่วงเวลา (เลือกชุดตามเดือน) + ค้นหาในชุดนั้น — ใช้ร่วมกับแท็บการชำระด้านบนได้ */}
        <div className="invoice-filters">
          <PeriodBar period={period} onChange={changePeriod} />

          <div className="field">
            <label htmlFor="filterRoom">เลขที่ห้อง</label>
            <input
              id="filterRoom"
              value={filters.roomNumber}
              onChange={(e) => setFilter('roomNumber', e.target.value)}
              placeholder="เช่น 101"
            />
          </div>

          <div className="field">
            <label htmlFor="filterNumber">เลขที่ใบแจ้งหนี้</label>
            <input
              id="filterNumber"
              value={filters.invoiceNumber}
              onChange={(e) => setFilter('invoiceNumber', e.target.value)}
              placeholder="เช่น I2026080001"
            />
          </div>

          <button
            type="button"
            className="link-btn invoice-filter-reset"
            onClick={() => setFilters(EMPTY_FILTERS)}
            disabled={!hasFilters}
          >
            รีเซ็ต
          </button>
        </div>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : invoices.length === 0 ? (
          // ตารางว่างเพราะไม่มีบิลเลย กับว่างเพราะแท็บ/คำค้นกรองจนไม่เหลือ เป็นคนละเรื่อง
          // บอกผิดแล้วผู้ใช้จะเข้าใจว่าออกบิลไม่สำเร็จ ทั้งที่แค่ดูอยู่ผิดแท็บ
          // บอกช่วงเวลาไปด้วย — ว่างเพราะดูอยู่เดือนที่ยังไม่ออกบิล คนละเรื่องกับไม่มีบิลเลย
          <p className="muted table-empty">
            {hasFilters
              ? 'ไม่พบใบแจ้งหนี้ตามเงื่อนไขที่ค้นหา'
              : settlement === 'outstanding'
                ? 'ไม่มีใบแจ้งหนี้ที่ค้างชำระ'
                : settlement === 'paid'
                  ? 'ไม่มีใบแจ้งหนี้ที่ชำระครบแล้ว'
                  : settlement === 'cancelled'
                    ? 'ไม่มีใบแจ้งหนี้ที่ถูกยกเลิก'
                    : 'ไม่มีใบแจ้งหนี้'}
            {period.mode !== 'all' && ` ของ${periodLabel(period)}`}
            {period.mode !== 'all' && (
              <>
                {' · '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => changePeriod({ ...period, mode: 'all' })}
                >
                  ดูทุกช่วงเวลา
                </button>
              </>
            )}
          </p>
        ) : (
          <table className="data-table grouped-table">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>วันที่</th>
                <th>ห้อง</th>
                <th>สถานะ</th>
                <th className="align-right">ยอดรวม</th>
                <th className="align-right">ค้างชำระ</th>
                <th className="align-right" />
              </tr>
            </thead>
            {groups.map((group, index) => {
              const open = isOpen(group.month, index)
              return (
                <tbody key={group.month}>
                  <MonthGroupRow
                    group={group}
                    open={open}
                    collapsible={multiMonth}
                    onToggle={() => toggleMonth(group.month)}
                  />
                  {open &&
                    group.items.map((inv) => (
                      <tr key={inv.invoiceId}>
                        <td>{inv.invoiceNumber}</td>
                        <td>{formatDate(inv.issueDate)}</td>
                        <td>{inv.roomNumber}</td>
                        <td>
                          <span className={`invoice-status invoice-${inv.status}`}>
                            {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
                          </span>
                          {/* เกินกำหนดกี่วัน — หอต้องรู้ว่าใครค้างนานแค่ไหน ไม่ว่าจะเก็บค่าปรับหรือไม่ */}
                          {inv.overdueDays > 0 && (
                            <span className="invoice-overdue">เกิน {inv.overdueDays} วัน</span>
                          )}
                        </td>
                        <td className="align-right">{formatBaht(inv.totalAmountCents)}</td>
                        <td className="align-right">
                          {inv.outstandingCents > 0 ? (
                            <strong className="negative">{formatBaht(inv.outstandingCents)}</strong>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="align-right">
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setOpenInvoiceId(inv.invoiceId)}
                          >
                            รายละเอียด
                          </button>
                          {/* ลบได้เฉพาะใบที่ยกเลิกแล้ว — ใบที่ยังใช้งานอยู่ต้องยกเลิกก่อน
                              เป็นด่านที่บังคับให้ตัดสินใจสองครั้งก่อนเอกสารการเงินจะหายไป */}
                          {/* และเจ้าของหอเท่านั้น — แถวถูกลบจริง เลขที่ที่ยื่นให้ผู้เช่าไปแล้ว
                              จะชี้ไปที่ความว่างเปล่า (main บังคับที่ invoice:delete) */}
                          {inv.status === 'cancelled' && user?.isOwner && (
                            <button
                              type="button"
                              className="link-btn link-danger table-action icon-only"
                              onClick={() => setDeleting(inv)}
                              aria-label={`ลบใบแจ้งหนี้ ${inv.invoiceNumber}`}
                            >
                              <Icon name="trash" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              )
            })}
          </table>
        )}
      </section>

      {deleting && (
        <DeleteInvoiceDialog
          invoice={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            showToast(`ลบใบแจ้งหนี้ ${deleting.invoiceNumber} แล้ว`)
            setDeleting(null)
            load()
          }}
        />
      )}
    </>
  )
}

// หัวกลุ่มเดือนในตาราง — ค้างอยู่ใต้หัวตารางตอนเลื่อน จะรู้ตลอดว่ากำลังดูเดือนไหน
// บอกจำนวนใบ ยอดรวม และยอดค้างของเดือนนั้น (ไม่นับใบที่ยกเลิก — ไม่มีผลเป็นเงินแล้ว)
// โหมดรายเดือนมีกลุ่มเดียว จึงไม่ต้องพับได้
const INVOICE_COLUMNS = 7

function MonthGroupRow({ group, open, collapsible, onToggle }) {
  const live = group.items.filter((inv) => inv.status !== 'cancelled')
  const total = live.reduce((sum, inv) => sum + inv.totalAmountCents, 0)
  const outstanding = live.reduce((sum, inv) => sum + inv.outstandingCents, 0)

  const content = (
    <>
      {collapsible && (
        <span className={open ? 'month-group-chevron month-group-chevron-open' : 'month-group-chevron'}>
          <Icon name="chevronRight" />
        </span>
      )}
      <span className="month-group-name">รอบ{formatMonthName(group.month)}</span>
      <span className="month-group-meta">
        {group.items.length} ใบ · ยอดรวม {formatBaht(total)}
        {outstanding > 0 && (
          <>
            {' · '}
            <span className="negative">ค้าง {formatBaht(outstanding)}</span>
          </>
        )}
      </span>
    </>
  )

  return (
    <tr className="month-group-row">
      <th colSpan={INVOICE_COLUMNS} scope="colgroup">
        {collapsible ? (
          <button type="button" className="month-group-toggle" aria-expanded={open} onClick={onToggle}>
            {content}
          </button>
        ) : (
          <div className="month-group-toggle">{content}</div>
        )}
      </th>
    </tr>
  )
}

// หน้าต่างยืนยันการลบ — เหตุผลบังคับกรอกเสมอ (ผู้ใช้สั่ง 2026-08-07)
//
// ปุ่มลบถูกปิดไว้จนกว่าจะพิมพ์เหตุผล ไม่ใช่ปล่อยให้กดแล้วค่อยขึ้น error — คนที่ตั้งใจ
// จะลบจริงจะได้รู้ตั้งแต่เห็นหน้าต่างว่าต้องเขียนอะไรสักอย่างก่อน
function DeleteInvoiceDialog({ invoice, onClose, onDeleted }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = reason.trim().length > 0
  // เหตุผลว่างถูกกันด้วยปุ่มที่กดไม่ได้อยู่แล้ว — error ที่มาถึงตรงนี้ส่วนใหญ่เป็นเรื่องสถานะ
  // (เช่น ถูกยกเลิกไปแล้ว) ซึ่งขึ้นบนสุดของหน้าต่าง
  const { errors, formError, fromResult, clear, reset } = useFormErrors(['reason'])

  async function submit() {
    if (!ready) return
    reset()
    setBusy(true)
    const res = await deleteInvoice(invoice.invoiceId, reason)
    setBusy(false)
    if (!res.success) return fromResult(res)
    onDeleted()
  }

  return (
    <Modal
      title={`ลบใบแจ้งหนี้ ${invoice.invoiceNumber}`}
      icon="trash"
      submitLabel="ลบถาวร"
      busy={busy || !ready}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert kind="warn">
        ลบถาวร กู้คืนไม่ได้ · เลขที่ {invoice.invoiceNumber} จะไม่ถูกนำไปใช้ซ้ำ
      </Alert>

      <dl className="invoice-totals delete-summary">
        <div>
          <dt>ห้อง</dt>
          <dd>{invoice.roomNumber}</dd>
        </div>
        <div>
          <dt>รอบเดือน</dt>
          <dd>{formatBillingMonth(invoice.billingMonth)}</dd>
        </div>
        <div>
          <dt>ยอดรวม</dt>
          <dd>{formatBaht(invoice.totalAmountCents)}</dd>
        </div>
      </dl>

      <div className={fieldClass('field field-required', errors.reason)}>
        <label htmlFor="deleteReason">
          เหตุผลในการลบ <span className="required">* จำเป็น</span>
        </label>
        <textarea
          id="deleteReason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            clear('reason')
          }}
          {...invalidProps('deleteReason', errors.reason)}
          placeholder="เช่น ออกบิลผิดห้อง / ออกซ้ำ / ทดลองใช้งาน"
        />
        {errors.reason ? (
          <FieldError id="deleteReason-error" message={errors.reason} />
        ) : (
          !ready && <p className="field-hint">ต้องกรอกเหตุผลก่อนจึงจะลบได้</p>
        )}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// ตัวช่วยออกบิล 2 ขั้น
// ------------------------------------------------------------------
const STEPS = [
  { key: 'pick', label: 'เลือกวันจดมิเตอร์' },
  { key: 'create', label: 'สร้างใบแจ้งหนี้' }
]

function BillingWizard({ apartment, onClose }) {
  const [step, setStep] = useState(0)
  const [batches, setBatches] = useState([])
  const [batchId, setBatchId] = useState('')
  const [billingMonth, setBillingMonth] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const [preview, setPreview] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const res = await listMeterBatches(apartment.apartmentId)
      setLoading(false)
      if (!res.success) return setError(res.error)
      setBatches(res.data)
      // ใบจดล่าสุดคือใบที่จะออกบิลเกือบทุกครั้ง เลือกให้เลยจะได้ไม่ต้องกดซ้ำ
      if (res.data.length > 0) applyBatch(res.data[0])
    })()
  }, [apartment.apartmentId])

  const batch = batches.find((b) => String(b.batchId) === String(batchId))

  // **หอจดมิเตอร์วันที่ 1 แล้วออกบิลวันเดียวกัน** (ยืนยันกับเจ้าของหอ 2026-08-10
  // — ถ้าติดธุระก็เลื่อนเป็นวันที่ 2-3 แต่ยังเป็นเดือนเดิม)
  //
  // วันจดมิเตอร์จึงเป็นค่าตั้งต้นที่ดีกว่า "วันนี้" เพราะมาจากข้อมูลที่กรอกไว้แล้ว
  // ไม่ใช่นาฬิกาเครื่อง — ออกบิลย้อนหลังหรือทดลองด้วยวันที่สมมติก็ยังได้เดือนที่ถูก
  function applyBatch(nextBatch) {
    setBatchId(String(nextBatch.batchId))
    setIssueDate(nextBatch.readingDate)
    setBillingMonth(billingMonthOf(nextBatch.readingDate))
  }

  // เดือนค่าเช่าเดินตามวันที่ออกบิล ไม่ใช่ตามใบจดมิเตอร์ — แก้วันที่แล้วเดือนขยับตามเอง
  // (เลือกเดือนเองทีหลังได้ ไม่ถูกทับ เพราะทับเฉพาะตอนที่วันที่เปลี่ยน)
  function changeIssueDate(next) {
    setIssueDate(next)
    if (next) setBillingMonth(billingMonthOf(next))
  }

  async function goToPreview() {
    if (!batch) return setError('กรุณาเลือกใบจดมิเตอร์')
    if (!billingMonth) return setError('กรุณาเลือกเดือนที่ต้องการออกบิล')
    // DateField คืน '' จนกว่าจะกรอกครบและเป็นวันที่ที่มีอยู่จริง
    if (!issueDate) return setError('กรุณาระบุวันที่ออกบิลให้ถูกต้อง')

    setError('')
    setBusy(true)
    const res = await previewMonthlyBilling({
      apartmentId: apartment.apartmentId,
      meterBatchId: batch.batchId,
      billingMonth
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    setPreview(res.data)
    setStep(1)
  }

  async function refreshPreview() {
    const res = await previewMonthlyBilling({
      apartmentId: apartment.apartmentId,
      meterBatchId: batch.batchId,
      billingMonth
    })
    if (res.success) setPreview(res.data)
  }

  async function createOne(row) {
    setError('')
    setBusy(true)
    const res = await createMonthlyInvoice({
      contractId: row.contractId,
      billingMonth,
      meterBatchId: batch.batchId,
      issueDate
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    showToast(`ออกบิลห้อง ${row.roomNumber} แล้ว (${res.data.invoiceNumber})`)
    refreshPreview()
  }

  async function createAll() {
    setError('')
    setBusy(true)
    const res = await createMonthlyInvoicesForApartment({
      apartmentId: apartment.apartmentId,
      meterBatchId: batch.batchId,
      billingMonth,
      issueDate
    })
    setBusy(false)
    if (!res.success) return setError(res.error)

    const { created, skipped, failed } = res.data
    // ต้องรายงานทั้งสามกอง ไม่ใช่บอกแค่ "สำเร็จ" — ห้องที่ข้ามกับห้องที่พังคนละเรื่องกัน
    // และห้องที่พังต้องเห็นว่าเป็นห้องไหนเพราะอีกสี่สิบห้องออกไปแล้ว
    if (failed.length > 0) {
      setError(
        `ออกบิลไม่สำเร็จ ${failed.length} ห้อง:\n` +
          failed.map((f) => `ห้อง ${f.roomNumber}: ${f.message}`).join('\n')
      )
    }
    showToast(
      `ออกบิลแล้ว ${created.length} ห้อง` + (skipped.length > 0 ? ` · ข้าม ${skipped.length} ห้องที่ออกไปแล้ว` : ''),
      failed.length > 0 ? 'error' : 'success'
    )
    refreshPreview()
  }

  // ห้องที่จ่ายค่าเช่าเดือนแรกไปแล้วไม่นับเป็นห้องที่รอออกบิล ไม่งั้นปุ่ม "สร้างทุกห้อง"
  // จะบอกจำนวนเกินจริงแล้วผู้ใช้จะสงสัยว่าทำไมสร้างได้ไม่ครบ
  const pending = preview.filter((row) => !row.existingInvoiceId && !row.startsThisMonth)
  const unpriced = preview.filter((row) => row.unpricedSides?.length > 0 && !row.existingInvoiceId)

  return (
    <>
      <div className="page-back">
        <button type="button" className="link-btn" onClick={onClose}>
          <Icon name="back" />
          <span>กลับไปรายการใบแจ้งหนี้</span>
        </button>
      </div>

      {/* แถบขั้นตอนแนวนอนตามต้นแบบ — ขั้นที่ผ่านแล้วกดย้อนกลับได้ ขั้นที่ยังไม่ถึงกดไม่ได้ */}
      <div className="billing-steps">
        {STEPS.map((s, index) => (
          <button
            key={s.key}
            type="button"
            className={
              'billing-step' +
              (index === step ? ' current' : '') +
              (index < step ? ' done' : '') +
              (index > step ? ' future' : '')
            }
            onClick={() => index < step && setStep(index)}
            disabled={index > step}
          >
            <span className="wizard-step-number">{index + 1}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <section className="panel">
        <Alert>{error}</Alert>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : step === 0 ? (
          batches.length === 0 ? (
            <div className="empty-state">
              <p>ยังไม่มีใบจดมิเตอร์ · จดมิเตอร์ก่อนออกบิล</p>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="batchId">
                  วันที่จดมิเตอร์ <span className="required">* จำเป็น</span>
                  <InfoTip
                    title="ใบจดมิเตอร์ที่ใช้คิดเงิน"
                    points={[
                      'ค่าน้ำ/ค่าไฟคิดจากหน่วยที่จดในใบนี้',
                      'ห้องที่ยังไม่ได้จด คิดเป็น 0 หน่วย'
                    ]}
                  />
                </label>
                <select
                  id="batchId"
                  value={batchId}
                  onChange={(e) => {
                    const next = batches.find((b) => String(b.batchId) === e.target.value)
                    if (next) applyBatch(next)
                  }}
                >
                  {batches.map((b) => (
                    <option key={b.batchId} value={b.batchId}>
                      {formatDate(b.readingDate)} (จดแล้ว {b.roomCount} ห้อง)
                    </option>
                  ))}
                </select>
              </div>

              {/* วันที่ออกบิลมาก่อนเดือนค่าเช่า เพราะเดือนค่าเช่าเดินตามวันนี้
                  (หอออกบิลวันที่ 1 เสมอ — วันจดมิเตอร์เป็นคนละวันและไม่แน่นอน) */}
              <div className="field">
                <label htmlFor="issueDate">
                  วันที่ออกบิล <span className="required">* จำเป็น</span>
                  <InfoTip
                    title="วันที่ออกบิลมีผลกับ"
                    points={['เลขที่บิล', 'วันครบกำหนดชำระ', 'เดือนค่าเช่า']}
                  />
                </label>
                <DateField id="issueDate" value={issueDate} onChange={changeIssueDate} />
                {/* วันที่นี้ไม่ได้เป็นแค่ตัวเลขบนหัวบิล — เลขที่บิลใช้ปี-เดือนของวันนี้
                    (I2569 02 0001) วันครบกำหนดนับต่อจากวันนี้ และเดือนค่าเช่าก็มาจากวันนี้ */}
              </div>

              <div className="field">
                <label htmlFor="billingMonth">
                  ออกบิลค่าห้องของเดือน <span className="required">* จำเป็น</span>
                  <InfoTip
                    title="เดือนค่าเช่า"
                    points={[
                      'ระบบเลือกตามวันที่ออกบิลให้แล้ว',
                      'เปลี่ยนเฉพาะตอนออกบิลย้อนหลัง'
                    ]}
                  />
                </label>
                <select
                  id="billingMonth"
                  value={billingMonth}
                  onChange={(e) => setBillingMonth(e.target.value)}
                >
                  {monthOptions(issueDate).map((m) => (
                    <option key={m} value={m}>
                      {formatBillingMonth(m)}
                    </option>
                  ))}
                </select>
                {/* บิลใบเดียวมีสองเดือนอยู่ในนั้น — ต้องเขียนให้ชัดตั้งแต่ตอนเลือก ไม่ใช่ให้ไป
                    เจอเอาตอนบิลออกไปถึงมือผู้เช่าแล้ว */}
                <p className="field-hint">
                  ค่าน้ำ-ค่าไฟเป็นของเดือน{' '}
                  <strong>{formatBillingMonth(utilityMonthOf(billingMonth))}</strong>
                </p>
              </div>

              <div className="card-foot">
                <button type="button" className="btn" onClick={goToPreview} disabled={busy}>
                  {busy ? 'กำลังคำนวณ...' : 'ต่อไป'}
                </button>
              </div>
            </>
          )
        ) : (
          <>
            <div className="panel-head-row">
              <h2 className="panel-title">
                ค่าเช่าเดือน {formatBillingMonth(billingMonth)} · ค่าน้ำ-ค่าไฟเดือน{' '}
                {formatBillingMonth(utilityMonthOf(billingMonth))} · ออกบิล{' '}
                {formatDate(issueDate)}
              </h2>
              <button
                type="button"
                className="btn"
                onClick={createAll}
                disabled={busy || pending.length === 0}
              >
                {busy ? 'กำลังออกบิล...' : `สร้างใบแจ้งหนี้ทุกห้อง (${pending.length})`}
              </button>
            </div>

            {/* ห้องที่ใช้น้ำ/ไฟจริงแต่ไม่มีราคาให้คิด — ถ้าไม่บอกตรงนี้ บิล 0 บาทจะหลุดไปถึง
                มือผู้เช่าโดยไม่มีใครสังเกต (เกิดกับห้องที่ถูกสร้างก่อนหอจะตั้งราคาค่าน้ำ/ค่าไฟ) */}
            {unpriced.length > 0 && (
              <Alert kind="warn">
                <strong>
                  ห้อง {unpriced.map((r) => r.roomNumber).join(', ')} ใช้น้ำ/ไฟจริงแต่คิดเงินไม่ได้
                </strong>
                <p>
                  ห้องเหล่านี้ยังไม่มีราคาค่าน้ำ/ค่าไฟของตัวเอง (ถูกสร้างไว้ก่อนตั้งราคา)
                  ออกบิลตอนนี้จะได้ 0 บาท — ไปที่ ตั้งค่า › ค่าน้ำ-ค่าไฟ แล้วกด
                  “นำไปใช้กับทุกห้อง” ก่อน แล้วกลับมาออกบิลใหม่
                </p>
              </Alert>
            )}

            {preview.length === 0 ? (
              <div className="empty-state">
                <p>ไม่มีห้องที่มีสัญญาใช้งานอยู่ในหอนี้ — ยังออกบิลไม่ได้</p>
              </div>
            ) : (
              <table className="data-table billing-table">
                <thead>
                  <tr>
                    <th>ห้อง</th>
                    <th>ค่าน้ำ</th>
                    <th>ค่าไฟ</th>
                    <th className="align-right">ยอดรวม</th>
                    <th className="align-right">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr key={row.contractId}>
                      <td>{row.roomNumber}</td>
                      <td>
                        <strong>{row.waterUnits}</strong> หน่วย
                        <span className="muted billing-charge">
                          {formatBaht(row.waterChargeCents)}
                        </span>
                      </td>
                      <td>
                        <strong>{row.electricUnits}</strong> หน่วย
                        <span className="muted billing-charge">
                          {formatBaht(row.electricChargeCents)}
                        </span>
                      </td>
                      <td className="align-right">{formatBaht(row.totalAmountCents)}</td>
                      <td className="align-right">
                        {row.existingInvoiceId ? (
                          <span className="billing-done">
                            <Icon name="check" />
                            <span>{row.existingInvoiceNumber}</span>
                          </span>
                        ) : row.startsThisMonth ? (
                          /* เพิ่งย้ายเข้าเดือนนี้ = จ่ายค่าเช่าเดือนแรกไปแล้วตอนทำสัญญา
                             ต้องบอกว่าทำไมกดไม่ได้ ไม่ใช่ปุ่มหายไปเฉยๆ */
                          <span className="muted billing-skip">จ่ายค่าเช่าเดือนแรกแล้ว</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => createOne(row)}
                            disabled={busy}
                          >
                            สร้างใบแจ้งหนี้
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="card-foot">
              <button type="button" className="btn btn-outline" onClick={onClose}>
                เสร็จสิ้น
              </button>
            </div>
          </>
        )}
      </section>
    </>
  )
}

// ------------------------------------------------------------------
// ตัวเลือกเดือนที่ออกบิล — เดือนของใบจดเป็นหลัก แล้วให้เลือกย้อนหลังได้อีก 5 เดือน
// กับล่วงหน้า 1 เดือน (หอที่เก็บค่าเช่าล่วงหน้าจะออกบิลของเดือนถัดไป)
// เดือนที่ค่าเช่าบนบิลเป็นของ = **เดือนของวันที่ออกบิล**
//
// ยืนยันกับใบเสร็จจริงของหอแล้ว: ออกวันที่ 1 ก.พ. → ค่าเช่า (1 - 28 ก.พ.) + ค่าน้ำ-ไฟ (ม.ค.)
//
// เคยคิดจากวันจดมิเตอร์ (วันถัดไป / วันก่อนหน้า) ซึ่งใช้ได้เฉพาะหอที่จดวันสุดท้ายของเดือน
// หรือวันที่ 1 เท่านั้น — หอที่จดวันที่ 28 จะได้เดือนค่าเช่าย้อนไปหนึ่งเดือนทุกครั้ง
// และผู้ใช้ยืนยัน 2026-08-10 ว่า **ไม่รู้ว่าหอจดมิเตอร์วันไหน แต่รู้แน่ว่าออกบิลวันที่ 1 เสมอ**
// วันจดมิเตอร์จึงเป็นหลักยึดที่เชื่อไม่ได้ ส่วนวันออกบิลเชื่อได้
function billingMonthOf(issueDate) {
  return String(issueDate ?? '').slice(0, 7)
}


// เดือนที่ค่าน้ำ-ค่าไฟเป็นของ = เดือนก่อนเดือนค่าเช่า
// **ต้องตรงกับ utilityMonthOf ใน src/main/db/invoices.js** — ที่นี่ใช้แสดงบนหน้าจอเท่านั้น
// ข้อความที่ลงบิลจริงประกอบฝั่ง main
function utilityMonthOf(billingMonth) {
  if (!billingMonth) return ''
  const [year, month] = String(billingMonth).split('-').map(Number)
  if (!year || !month) return ''
  const previous = new Date(Date.UTC(year, month - 2, 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`
}

// ให้เลือกย้อนหลังได้เผื่อออกบิลตามหลัง และล่วงหน้าหนึ่งเดือนเผื่อออกก่อนสิ้นเดือน
function monthOptions(issueDate) {
  const anchor = billingMonthOf(issueDate)
  if (!anchor) return []
  const [year, month] = anchor.split('-').map(Number)

  const list = []
  for (let offset = 1; offset >= -5; offset -= 1) {
    const date = new Date(year, month - 1 + offset, 1)
    list.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  }
  return list
}

function formatDate(iso) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

// '2026-08' -> '08-2026' ตามที่ต้นแบบขึ้นบนบิลและในตัวเลือก
function formatBillingMonth(month) {
  if (!month) return '-'
  const [y, m] = String(month).split('-')
  return `${m}-${y}`
}
