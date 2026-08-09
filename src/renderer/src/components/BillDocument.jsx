import React from 'react'
import Icon from '../Icon.jsx'
import { VAT_RATE } from '../constants.js'
import { formatBaht } from '../format.js'

// ตัวเอกสารที่ยื่นให้ผู้เช่า — ใช้ร่วมกันทั้ง "ใบแจ้งหนี้" และ "ใบเสร็จรับเงิน"
//
// ผู้ใช้สั่ง (2026-08-09) ว่าใบเสร็จต้องหน้าตาเหมือนใบแจ้งหนี้ทุกอย่าง ต่างแค่ตัดช่องทาง
// ชำระเงินกับ QR ออก — จึงทำเป็นคอมโพเนนต์เดียว ไม่ใช่สองไฟล์ที่ลอกกันมา
// สองไฟล์ที่ลอกกันจะค่อยๆ เพี้ยนจากกันทุกครั้งที่แก้ข้างเดียว
//
// สิ่งที่ต่างกันส่งผ่าน props ทั้งหมด:
//   title       หัวเอกสาร
//   meta        คู่ หัวข้อ/ค่า ที่มุมขวาบน (เลขที่ ห้อง วันที่ ...) — คนละชุดกันสองใบ
//   footer      ท้ายเอกสาร (ใบแจ้งหนี้ = ลงชื่อ + บัญชี + QR · ใบเสร็จ = ลงชื่ออย่างเดียว)
//   onRemoveItem  มีเฉพาะตอนแก้ไขบิลอยู่บนหน้าจอ ตอนพิมพ์ไม่ส่งมา คอลัมน์ปุ่มจึงหายไป
export default function BillDocument({ invoice, title, meta, tenants, footer, onRemoveItem }) {
  const apartment = invoice.apartment ?? {}
  // หอที่ไม่ได้จดทะเบียน VAT ไม่ต้องเห็นคำว่า vat ที่ไหนเลยบนเอกสาร — ทุกบรรทัดจะขึ้นว่า
  // "ไม่มี" เหมือนกันหมด ซึ่งเป็นข้อมูลที่ไม่ได้บอกอะไรและกินที่บนกระดาษเปล่าๆ
  const showVat = invoice.isVatEnabled

  return (
    <>
      <h2 className="invoice-doc-title">{title}</h2>

      <div className="invoice-doc-head">
        <div>
          <strong className="invoice-apartment">{apartment.name}</strong>
          {apartment.address && <p className="muted">{apartment.address}</p>}
          {apartment.phone && <p className="muted">โทร: {apartment.phone}</p>}
        </div>

        <dl className="invoice-doc-meta">
          {meta.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <BillTenantInfo tenants={tenants} />

      <table className="data-table invoice-items">
        <thead>
          <tr>
            <th className="invoice-col-no">#</th>
            <th>รายการ</th>
            {/* หัวคอลัมน์บอกให้ชัดว่าราคาต่อหน่วยยังไม่รวมภาษี แต่ยอดเงินรวมแล้ว
                ไม่งั้นผู้เช่าเอาราคาต่อหน่วยคูณจำนวนแล้วไม่ตรงกับยอดเงิน จะคิดว่าคิดเงินผิด */}
            <th className="align-right">
              ราคาต่อหน่วย
              {showVat && <span className="invoice-col-sub">(ก่อน VAT)</span>}
            </th>
            <th className="align-right">
              ยอดเงิน
              {showVat && <span className="invoice-col-sub">(รวม VAT)</span>}
            </th>
            {onRemoveItem && <th className="align-right" />}
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, index) => (
            <tr key={item.invoiceItemId}>
              <td className="invoice-col-no">{index + 1}</td>
              <td>{item.description}</td>
              <td className="align-right">
                {formatBaht(item.unitPriceCents)}
                {showVat && (
                  <span className="invoice-line-vat">
                    vat: {item.vatRate > 0 ? `${item.vatRate}%` : 'ไม่มี'}
                  </span>
                )}
              </td>
              {/* ยอดเงินรวม VAT ของบรรทัดนั้นแล้ว (ฐาน + ภาษี) ตามที่หัวคอลัมน์บอกไว้
                  ฐานกับภาษีเก็บแยกกันในฐานข้อมูล บวกตอนแสดงผลเท่านั้น */}
              <td className="align-right">
                <span className={item.totalAmountCents < 0 ? 'negative' : undefined}>
                  {formatBaht(item.totalAmountCents + item.vatAmountCents)}
                </span>
                {showVat && (
                  <span className="invoice-line-vat">
                    ยอด VAT: {item.vatAmountCents > 0 ? formatBaht(item.vatAmountCents) : '-'}
                  </span>
                )}
              </td>
              {onRemoveItem && (
                <td className="align-right">
                  <button
                    type="button"
                    className="link-btn link-danger table-action icon-only"
                    onClick={() => onRemoveItem(item.invoiceItemId)}
                    aria-label={`ลบรายการ ${item.description}`}
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="invoice-totals">
        {/* แถว VAT ขึ้นก็ต่อเมื่อหอจดทะเบียน VAT — ดูจากธงของหอ ไม่ใช่ดูว่ายอดเป็น 0
            หอที่จด VAT แต่เดือนนี้ไม่มีรายการที่เสียภาษี ยังต้องเห็น VAT 0.00 บนบิล */}
        {showVat && (
          <>
            <div>
              <dt>ยอดยกเว้นภาษี</dt>
              <dd>{formatBaht(invoice.exemptAmountCents)}</dd>
            </div>
            <div>
              <dt>ยอดก่อนภาษี</dt>
              <dd>{formatBaht(invoice.taxableAmountCents)}</dd>
            </div>
            <div>
              <dt>VAT {VAT_RATE}%</dt>
              <dd>{formatBaht(invoice.vatAmountCents)}</dd>
            </div>
          </>
        )}
        <div className="invoice-total-row">
          <dt>รวม</dt>
          <dd>{formatBaht(invoice.totalAmountCents)}</dd>
        </div>
      </dl>

      {footer}
    </>
  )
}

// ผู้เช่าที่เอกสารใบนี้ออกให้ — วางระหว่างหัวหอกับตารางรายการ สองคอลัมน์ตามต้นแบบ
//
// เอกสารที่ยื่นให้คนหนึ่งต้องมีชื่อคนนั้นอยู่บนนั้น ไม่งั้นพอส่งไฟล์ทางไลน์ไปหลายห้อง
// ผู้เช่าจะแยกไม่ออกว่าใบไหนของตัวเอง (เลขห้องอย่างเดียวอ่านยากกว่าชื่อ)
//
// **ไม่พิมพ์เลขบัตรประชาชน** ต่างจากต้นแบบที่ขึ้นเป็น "เลขประจำตัวผู้เสียภาษี" —
// หอนี้ไม่ได้ออกใบกำกับภาษีเต็มรูป (ตัดออกตั้งแต่ตอนวางขอบเขต) เลขบัตรจึงไม่มีหน้าที่
// บนกระดาษที่ส่งต่อทางแชต มีแต่ความเสี่ยง ถ้าวันหนึ่งต้องออกใบกำกับภาษีค่อยเพิ่ม
export function BillTenantInfo({ tenants }) {
  const list = tenants ?? []
  if (list.length === 0) return null

  const primary = list[0]
  const others = list.slice(1)

  return (
    <dl className="invoice-tenant">
      <div>
        <dt>ผู้เช่า</dt>
        <dd>
          {primary.fullName}
          {/* สัญญาหนึ่งมีผู้เช่าได้หลายคน (ดู 010) ชื่อคนอื่นต้องอยู่บนเอกสารด้วย
              ไม่งั้นคนที่ร่วมสัญญาจะไม่มีหลักฐานว่าตัวเองเกี่ยวข้อง */}
          {others.length > 0 && (
            <span className="invoice-cotenants">
              {' '}
              · ร่วมสัญญา: {others.map((t) => t.fullName).join(', ')}
            </span>
          )}
        </dd>
      </div>

      {primary.phone && (
        <div>
          <dt>เบอร์โทรศัพท์</dt>
          <dd>{primary.phone}</dd>
        </div>
      )}

      {primary.address && (
        <div className="invoice-tenant-address">
          <dt>ที่อยู่</dt>
          <dd>{primary.address}</dd>
        </div>
      )}
    </dl>
  )
}

// ช่องลงชื่อชิดขวา — เว้นที่ให้เซ็นด้วยมือบนกระดาษจริง มีทั้งบนใบแจ้งหนี้และใบเสร็จ
export function BillSignature({ label = 'ลงชื่อ', name }) {
  if (!name) return null
  return (
    <div className="invoice-signature">
      <span>{label}</span>
      <strong>{name}</strong>
    </div>
  )
}
