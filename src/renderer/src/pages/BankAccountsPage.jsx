import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import InfoTip from '../components/InfoTip.jsx'
import Alert from '../components/Alert.jsx'
import SelectField from '../components/SelectField.jsx'
import ToggleSwitch from '../components/ToggleSwitch.jsx'
import { BANKS, RECOMMENDED_MAX_ACCOUNTS } from '../constants.js'
import {
  createBankAccount,
  deleteBankAccount,
  listBankAccounts,
  saveInvoiceNote,
  savePaymentInstructions,
  setDefaultBankAccount,
  updateBankAccount
} from '../services/bankAccountService.js'

// ขั้นที่ 3 ของการตั้งค่าหอ — บัญชีรับเงิน + ข้อความแจ้งการชำระเงิน
// สองเรื่องนี้อยู่หน้าเดียวกันตามต้นแบบ เพราะทั้งคู่ถูกพิมพ์ลงใบแจ้งหนี้ด้วยกัน
const EMPTY = { bankName: '', accountName: '', accountNumber: '' }

export default function BankAccountsPage({ apartment }) {
  const [accounts, setAccounts] = useState([])
  const [instructions, setInstructions] = useState('')
  const [invoiceNote, setInvoiceNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [instructionsSaved, setInstructionsSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listBankAccounts(apartment.apartmentId)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setAccounts(res.data.accounts)
    setInstructions(res.data.paymentInstructions)
    setInvoiceNote(res.data.invoiceNote ?? '')
  }, [apartment.apartmentId])

  useEffect(() => {
    load()
  }, [load])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function resetForm() {
    setForm(EMPTY)
    setEditingId(null)
  }

  async function submitAccount(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = editingId
      ? await updateBankAccount(editingId, form)
      : await createBankAccount(apartment.apartmentId, form)
    setBusy(false)
    if (!res.success) return setError(res.error)
    resetForm()
    load()
  }

  async function act(fn) {
    setError('')
    const res = await fn()
    if (!res.success) return setError(res.error)
    load()
  }

  // สองข้อความนี้อยู่ในฟอร์มเดียวกัน จึงบันทึกพร้อมกัน — ถ้าแยกปุ่มจะมีสองปุ่ม "บันทึก"
  // ในการ์ดเดียวและผู้ใช้ต้องจำว่าปุ่มไหนคุมช่องไหน
  async function submitInstructions(e) {
    e.preventDefault()
    setError('')
    setInstructionsSaved(false)

    const res = await savePaymentInstructions(apartment.apartmentId, instructions)
    if (!res.success) return setError(res.error)

    const noteRes = await saveInvoiceNote(apartment.apartmentId, invoiceNote)
    if (!noteRes.success) return setError(noteRes.error)

    setInstructionsSaved(true)
  }

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">
          บัญชีธนาคารสำหรับรับเงิน
          <InfoTip
            title="บัญชีรับเงิน"
            points={[
              'แสดงในใบแจ้งหนี้ทุกใบ',
              `แนะนำไม่เกิน ${RECOMMENDED_MAX_ACCOUNTS} บัญชี ผู้เช่าจะได้ไม่สับสน`
            ]}
          />
        </h2>
        <Alert>{error}</Alert>

        <form className="bank-form" onSubmit={submitAccount}>
          <div className="field">
            <label htmlFor="bankName">
              ธนาคาร <span className="required">* จำเป็น</span>
            </label>
            {/* ไม่ใช้ <select> ที่นี่: รายการธนาคารยาว 18 รายการ ทำให้ Chromium กาง
                รายการ **ขึ้นไปทับหัวข้อและตัวช่วยตั้งค่าทั้งหน้า** เพราะใต้ช่องมีที่ไม่พอ
                และทิศทางนั้น CSS สั่งไม่ได้ (ดู components/SelectField.jsx) */}
            <SelectField
              id="bankName"
              value={form.bankName}
              onChange={(bank) => set('bankName', bank)}
              options={BANKS}
              placeholder="เลือกธนาคาร"
            />
          </div>

          <div className="field">
            <label htmlFor="accountName">
              ชื่อบัญชี <span className="required">* จำเป็น</span>
            </label>
            <input
              id="accountName"
              value={form.accountName}
              onChange={(e) => set('accountName', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="accountNumber">
              เลขบัญชี <span className="required">* จำเป็น</span>
            </label>
            <input
              id="accountNumber"
              value={form.accountNumber}
              onChange={(e) => set('accountNumber', e.target.value)}
              inputMode="numeric"
            />
            {/* พร้อมเพย์ใช้เบอร์โทรหรือเลขบัตรได้ จึงไม่บังคับจำนวนหลักตายตัว */}
          </div>

          <div className="bank-form-submit">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'กำลังบันทึก...' : editingId ? 'บันทึก' : 'เพิ่ม'}
            </button>
            {editingId && (
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                ยกเลิก
              </button>
            )}
          </div>
        </form>

        {accounts.length > RECOMMENDED_MAX_ACCOUNTS && (
          <Alert kind="warn">
            มี {accounts.length} บัญชี · แนะนำไม่เกิน {RECOMMENDED_MAX_ACCOUNTS} บัญชี
          </Alert>
        )}

        <hr className="divider" />

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : accounts.length === 0 ? (
          <p className="muted table-empty">ยังไม่มีบัญชีธนาคาร</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ธนาคาร</th>
                <th>ชื่อบัญชี</th>
                <th>เลขบัญชี</th>
                <th>
                  ค่าเริ่มต้น
                  <InfoTip title="บัญชีค่าเริ่มต้น" points={['ขึ้นเป็นตัวเลือกแรกในใบแจ้งหนี้']} />
                </th>
                <th className="align-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.bankAccountId} className={editingId === a.bankAccountId ? 'row-editing' : ''}>
                  <td>{a.bankName}</td>
                  <td>{a.accountName}</td>
                  <td>{a.accountNumber}</td>
                  <td>
                    {/* สวิตช์แทนลิงก์ "ตั้งเป็นหลัก" ตามต้นแบบ — เห็นได้ทันทีว่าอันไหนเป็น
                        ค่าเริ่มต้นอยู่ ปิดเองไม่ได้ ต้องไปเปิดของอีกบัญชีแทน (มีได้ทีละอัน) */}
                    <ToggleSwitch
                      label=""
                      checked={a.isDefault}
                      disabled={a.isDefault}
                      onChange={() => act(() => setDefaultBankAccount(a.bankAccountId))}
                    />
                  </td>
                  <td className="align-right">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setEditingId(a.bankAccountId)
                        setForm({
                          bankName: a.bankName,
                          accountName: a.accountName,
                          accountNumber: a.accountNumber
                        })
                      }}
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="link-btn link-danger table-action icon-only"
                      onClick={() => act(() => deleteBankAccount(a.bankAccountId))}
                      aria-label={`ลบบัญชี ${a.accountName}`}
                    >
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">
          ข้อความในใบแจ้งหนี้
          <InfoTip title="ข้อความในใบแจ้งหนี้" points={['แสดงท้ายใบแจ้งหนี้ทุกใบ']} />
        </h2>
        <form onSubmit={submitInstructions}>
          {instructionsSaved && <Alert kind="success">บันทึกข้อความเรียบร้อยแล้ว</Alert>}

          <div className="field">
            <label htmlFor="paymentInstructions">
              วิธีแจ้งเมื่อโอนแล้ว <span className="required">* จำเป็น</span>
            </label>
            <textarea
              id="paymentInstructions"
              rows={3}
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value)
                setInstructionsSaved(false)
              }}
              placeholder="เช่น ชำระแล้วส่งสลิปมาที่ Line: @apartment หรือโทร 08x-xxx-xxxx"
            />
          </div>

          {/* ข้อความที่สองท้ายบิล — คนละหน้าที่กับข้างบน อันบนบอก "วิธีแจ้งเมื่อโอนแล้ว"
              อันนี้เป็นข้อตกลงประจำของหอ ต้นแบบขึ้นเป็นหัวข้อ "Note:" แยกกัน */}
          <div className="field">
            <label htmlFor="invoiceNote">ข้อความประจำท้ายใบแจ้งหนี้</label>
            <textarea
              id="invoiceNote"
              rows={2}
              value={invoiceNote}
              onChange={(e) => {
                setInvoiceNote(e.target.value)
                setInstructionsSaved(false)
              }}
              placeholder="เช่น ชำระภายในวันที่ 25 ของทุกเดือน"
            />
          </div>

          {/* ปุ่มบันทึกอยู่ในแถบเทาท้ายการ์ดตามต้นแบบ ไม่ลอยอยู่กับเนื้อหา */}
          <div className="card-foot">
            <button type="submit" className="btn">
              บันทึก
            </button>
          </div>
        </form>
      </section>
    </>
  )
}
