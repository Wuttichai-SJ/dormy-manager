import React, { useCallback, useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
import { BANKS, RECOMMENDED_MAX_ACCOUNTS } from '../constants.js'
import {
  createBankAccount,
  deleteBankAccount,
  listBankAccounts,
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

  async function submitInstructions(e) {
    e.preventDefault()
    setError('')
    setInstructionsSaved(false)
    const res = await savePaymentInstructions(apartment.apartmentId, instructions)
    if (!res.success) return setError(res.error)
    setInstructionsSaved(true)
  }

  return (
    <>
      <div className="info-banner">
        <strong>บัญชีธนาคารสำหรับรับเงิน</strong>
        <p>
          รายชื่อบัญชีที่จะแสดงในใบแจ้งหนี้ — แนะนำไม่เกิน {RECOMMENDED_MAX_ACCOUNTS} บัญชี
          เพื่อไม่ให้ผู้เช่าสับสนว่าควรโอนบัญชีไหน
        </p>
      </div>

      <section className="panel">
        <Alert>{error}</Alert>

        <form className="bank-form" onSubmit={submitAccount}>
          <div className="field">
            <label htmlFor="bankName">
              ธนาคาร <span className="required">* จำเป็น</span>
            </label>
            <select
              id="bankName"
              value={form.bankName}
              onChange={(e) => set('bankName', e.target.value)}
            >
              <option value="">เลือกธนาคาร</option>
              {BANKS.map((bank) => (
                <option key={bank} value={bank}>
                  {bank}
                </option>
              ))}
            </select>
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
            <p className="field-hint">พิมพ์มีขีดหรือไม่มีก็ได้ ระบบเก็บเป็นตัวเลขล้วน</p>
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
            มี {accounts.length} บัญชีแล้ว — ใบแจ้งหนี้มีพื้นที่จำกัด แนะนำให้เหลือไม่เกิน{' '}
            {RECOMMENDED_MAX_ACCOUNTS} บัญชี
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
                <th>บัญชีหลัก</th>
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
                    {a.isDefault ? (
                      <span className="tag">บัญชีหลัก</span>
                    ) : (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => act(() => setDefaultBankAccount(a.bankAccountId))}
                      >
                        ตั้งเป็นหลัก
                      </button>
                    )}
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
                      className="link-btn link-danger table-action"
                      onClick={() => act(() => deleteBankAccount(a.bankAccountId))}
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="info-banner">
        <strong>ขั้นตอนการแจ้งการชำระเงิน</strong>
        <p>ข้อความนี้จะแสดงในใบแจ้งหนี้ เพื่อบอกผู้เช่าว่าโอนแล้วต้องแจ้งอย่างไร</p>
      </div>

      <section className="panel">
        <form onSubmit={submitInstructions}>
          {instructionsSaved && <Alert kind="success">บันทึกข้อความเรียบร้อยแล้ว</Alert>}

          <div className="field">
            <label htmlFor="paymentInstructions">
              ข้อความ <span className="required">* จำเป็น</span>
            </label>
            <textarea
              id="paymentInstructions"
              rows={3}
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value)
                setInstructionsSaved(false)
              }}
            />
            <p className="field-hint">
              ตัวอย่าง: เมื่อชำระเงินแล้ว กรุณาส่งหลักฐานการชำระเงินมาที่ Line: @apartment
              หรือโทรแจ้ง 08x-xxx-xxxx
            </p>
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
