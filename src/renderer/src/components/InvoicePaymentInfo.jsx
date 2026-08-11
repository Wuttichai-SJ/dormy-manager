import React, { useEffect, useState } from 'react'
import { BillSignature } from './BillDocument.jsx'
import { getImageDataUrl } from '../services/imageService.js'

// ท้ายใบแจ้งหนี้ — ลอกโครงจากใบเสร็จ PDF ของต้นแบบ:
//   กล่องลงชื่อชิดขวา
//   ตารางบัญชี 2 คอลัมน์ (ชื่อบัญชีตัวหนา ธนาคารตัวเล็กใต้ | เลขบัญชี)
//   การแจ้งชำระเงิน:
//   Note:
//
// แต่ละบล็อกหายไปเองถ้าไม่มีข้อมูล ไม่ทิ้งหัวข้อว่างไว้บนกระดาษ
//
// อยู่ที่ components/ ไม่ใช่ในหน้าใบแจ้งหนี้ เพราะการพิมพ์ทีเดียวทั้งหอใช้ตัวเดียวกันนี้
// — ท้ายบิลสองชุดที่ลอกกันจะค่อยๆ เพี้ยนจากกันทุกครั้งที่แก้ข้างเดียว
//
// qrDataUrl = ส่งรูป QR ที่โหลดไว้แล้วเข้ามาได้ (ไม่ส่ง = โหลดเอง)
// การพิมพ์ทั้งหอส่งเข้ามา เพราะบิลทุกใบของหอเดียวกันใช้ QR รูปเดียวกัน ถ้าปล่อยให้
// แต่ละใบโหลดเอง 40 ใบก็ยิงขอรูปเดิม 40 รอบ แล้วลากไบต์ข้ามสะพาน IPC ซ้ำ 40 ครั้ง
export default function InvoicePaymentInfo({ invoice, signedBy, qrDataUrl: providedQr }) {
  const banks = invoice.bankAccounts ?? []
  const instructions = invoice.apartment.paymentInstructions
  const note = invoice.apartment.invoiceNote
  const qrImageId = invoice.apartment.qrCodeImageId

  // QR ดึงแยกจากตัวบิล เพราะเป็นรูปที่ใหญ่กว่าข้อมูลบิลทั้งใบรวมกัน — ไม่ควรติดมากับ
  // ทุกครั้งที่โหลดบิล และรายการบิลก็ไม่ได้ใช้
  const [ownQr, setOwnQr] = useState(null)
  useEffect(() => {
    // มีคนโหลดมาให้แล้ว ไม่ต้องยิงซ้ำ
    if (providedQr !== undefined) return
    if (!qrImageId) return setOwnQr(null)
    let cancelled = false
    getImageDataUrl(qrImageId).then((res) => {
      if (!cancelled && res.success) setOwnQr(res.data.dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [qrImageId, providedQr])

  const qr = providedQr !== undefined ? providedQr : ownQr

  if (banks.length === 0 && !instructions && !note && !qr) return null

  return (
    <section className="invoice-payment-info">
      {/* ช่องลงชื่อผู้ออกบิล — เว้นที่ไว้เซ็นด้วยมือบนกระดาษ ชื่อที่พิมพ์คือคนที่กำลัง
          ออก/พิมพ์เอกสารใบนี้ */}
      <BillSignature name={signedBy} />

      {/* QR อยู่ข้างกล่องบัญชี — ผู้เช่าสแกนได้ทันทีจากไฟล์ที่ได้รับทางแชต
          โดยไม่ต้องพิมพ์เลขบัญชีทีละหลัก */}
      <div className={'invoice-footer-layout' + (qr ? ' has-qr' : '')}>
        <div className="invoice-footer-box">
          {banks.length > 0 && (
            <table className="invoice-banks">
              <thead>
                <tr>
                  <th>บัญชี</th>
                  <th>เลขบัญชี</th>
                </tr>
              </thead>
              <tbody>
                {banks.map((bank) => (
                  <tr key={`${bank.bankName}-${bank.accountNumber}`}>
                    <td>
                      <strong>{bank.accountName}</strong>
                      <span className="invoice-bank-name">{bank.bankName}</span>
                    </td>
                    {/* เลขบัญชีเป็นตัวเลขที่คนต้องคัดลอกทีละหลัก จึงใช้ฟอนต์ความกว้างเท่ากัน
                        เพื่อให้ตาไล่ตัวเลขได้ไม่หลง */}
                    <td className="invoice-account-number">{bank.accountNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {instructions && (
            <div className="invoice-footer-note">
              <strong>การแจ้งชำระเงิน:</strong>
              <p>{instructions}</p>
            </div>
          )}

          {note && (
            <div className="invoice-footer-note">
              <strong>Note:</strong>
              <p>{note}</p>
            </div>
          )}
        </div>

        {qr && (
          <figure className="invoice-qr">
            <img src={qr} alt="QR Code สำหรับชำระเงิน" />
            <figcaption>สแกนเพื่อชำระเงิน</figcaption>
          </figure>
        )}
      </div>
    </section>
  )
}
