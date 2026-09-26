import React, { useEffect, useState } from 'react'
import { BillSignature } from './BillDocument.jsx'
import { getImageDataUrl } from '../services/imageService.js'

// ท้ายใบแจ้งหนี้: ลงชื่อ · บัญชี · QR · การแจ้งชำระ · Note — ไม่มีข้อมูลก็ไม่แสดง · qrDataUrl ส่งมาได้เพื่อไม่ต้องโหลดซ้ำ
export default function InvoicePaymentInfo({ invoice, signedBy, qrDataUrl: providedQr }) {
  const banks = invoice.bankAccounts ?? []
  const instructions = invoice.apartment.paymentInstructions
  const note = invoice.apartment.invoiceNote
  const qrImageId = invoice.apartment.qrCodeImageId

  const [ownQr, setOwnQr] = useState(null)
  useEffect(() => {
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
      <BillSignature name={signedBy} />

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
