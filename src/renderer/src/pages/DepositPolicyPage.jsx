import React, { useCallback, useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
import InfoTip from '../components/InfoTip.jsx'
import { showToast } from '../components/Toast.jsx'
import { DEPOSIT_REFUND_POLICIES } from '../constants.js'
import { getDepositPolicy, saveDepositPolicy } from '../services/apartmentService.js'

// ตั้งค่า > เงินประกันและการคืนเงิน
//
// 🔴 **หน้านี้ตั้ง "ค่าตั้งต้นของสัญญาใบใหม่" ไม่ได้เปลี่ยนกฎของสัญญาที่เซ็นไปแล้ว**
// กฎถูกถ่ายสำเนาลงตัวสัญญาตั้งแต่วันทำสัญญา (migration 004) เพราะผู้เช่าที่เซ็นตอนกติกา
// คือ "แจ้งล่วงหน้า 15 วัน" ต้องไม่โดนกติกา 60 วันย้อนหลัง — เรื่องนี้กลายเป็นข้อพิพาทได้จริง
//
// ต้นแบบ (yeeraf) ไม่มีเรื่องนี้เลย ของเขาคือพนักงานพิมพ์ยอดคืนเอาเองตอนย้ายออก
// กฎอัตโนมัติทั้งชุดนี้เป็นของหอนี้เอง
export default function DepositPolicyPage({ apartment }) {
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getDepositPolicy(apartment.apartmentId)
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setSaved(res.data)
    setForm({
      policy: res.data.policy,
      noticeDays: String(res.data.noticeDays ?? ''),
      minStayMonths: res.data.minStayMonths === null ? '' : String(res.data.minStayMonths)
    })
  }, [apartment.apartmentId])

  useEffect(() => {
    load()
  }, [load])

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await saveDepositPolicy(apartment.apartmentId, {
      policy: form.policy,
      noticeDays: Number(form.noticeDays),
      minStayMonths: form.minStayMonths.trim() === '' ? null : Number(form.minStayMonths)
    })
    setBusy(false)
    if (!res.success) return setError(res.error)
    setSaved(res.data)
    showToast('บันทึกนโยบายเงินประกันแล้ว')
  }

  if (loading || !form) return <p className="muted">กำลังโหลด...</p>

  const selected = DEPOSIT_REFUND_POLICIES.find((p) => p.key === form.policy)

  return (
    <>
      {/* คำเตือนที่สำคัญที่สุดของหน้านี้ ต้องอยู่เหนือฟอร์ม ไม่ใช่เป็นเชิงอรรถข้างล่าง —
          คนที่เข้ามาแก้ตัวเลขส่วนใหญ่คาดหวังว่ามันจะมีผลกับทุกคนทันที ซึ่งไม่ใช่ */}
      <Alert kind="warn">
        การแก้ที่นี่<strong>ไม่กระทบสัญญาที่ทำไปแล้ว</strong>
        {saved.activeContractCount > 0 && ` (${saved.activeContractCount} ใบที่ใช้งานอยู่)`} ·
        ใช้กับสัญญาใหม่เท่านั้น
      </Alert>

      <form className="form-section" onSubmit={submit}>
        <div className="form-section-head">
          <h2>
            กติกาคืนเงินประกัน
            <InfoTip
              title="ตอนย้ายออก"
              points={[
                'ค่าเสียหายหักจากเงินประกันเสมอ ทั้งกรณีคืนและริบ',
                '“ริบ” = ส่วนที่เหลือหลังหักค่าเสียหายไม่ได้คืน',
                'ค่าน้ำ-ค่าไฟงวดสุดท้ายเก็บแยก ไม่แตะเงินประกัน',
                'ต่อสัญญาแล้วนับเดือนต่อเนื่อง (6+6 = 12 เดือน)',
                'เจ้าของหอกดข้ามผลตัดสินได้ แต่ต้องพิมพ์เหตุผล'
              ]}
            />
          </h2>
          <p>ใช้กับสัญญาที่ทำหลังจากนี้</p>
        </div>

        <div className="form-section-body">
          <Alert>{error}</Alert>

          <div className="field">
            <label htmlFor="depositPolicy">นโยบาย</label>
            <select
              id="depositPolicy"
              value={form.policy}
              onChange={(e) => setForm((f) => ({ ...f, policy: e.target.value }))}
            >
              {DEPOSIT_REFUND_POLICIES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="field-hint">{selected?.hint}</p>
          </div>

          {/* สองช่องล่างมีผลเฉพาะนโยบาย "คืนเมื่ออยู่ครบ" — อีกสองแบบตัดสินโดยไม่ดูเงื่อนไข
              ซ่อนไปเลยดีกว่าปล่อยให้กรอกค่าที่ไม่ถูกใช้ แล้วเข้าใจว่าตั้งไปแล้วมีผล */}
          {form.policy === 'on_full_term' && (
            <>
              <div className="field">
                <label htmlFor="noticeDays">ต้องแจ้งย้ายออกล่วงหน้า (วัน)</label>
                <input
                  id="noticeDays"
                  type="text"
                  inputMode="numeric"
                  value={form.noticeDays}
                  onChange={(e) => setForm((f) => ({ ...f, noticeDays: e.target.value }))}
                />
                <p className="field-hint">
                  แจ้งไม่ทัน = ริบเงินประกันทั้งหมด
                </p>
              </div>

              <div className="field">
                <label htmlFor="minStayMonths">
                  ต้องอยู่ครบอย่างน้อย (เดือน)
                  <InfoTip
                    title="ระยะที่ต้องอยู่ครบ"
                    points={[
                      'เว้นว่าง = ใช้ระยะของแต่ละสัญญา (สัญญา 12 เดือนต้องอยู่ครบ 12)',
                      'ใส่ตัวเลขเมื่อต้องการเกณฑ์เดียวกันทุกสัญญา'
                    ]}
                  />
                </label>
                <input
                  id="minStayMonths"
                  type="text"
                  inputMode="numeric"
                  value={form.minStayMonths}
                  onChange={(e) => setForm((f) => ({ ...f, minStayMonths: e.target.value }))}
                  placeholder="เว้นว่าง = ตามระยะสัญญาของแต่ละใบ"
                />
                {/* ค่าที่หอนี้ใช้อยู่คือเว้นว่าง — สัญญา 12 เดือนก็ต้องอยู่ครบ 12
                    ใส่ตัวเลขเมื่อต้องการเกณฑ์ตายตัวที่ไม่ขึ้นกับระยะสัญญา */}
              </div>
            </>
          )}

          <div className="button-row">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      </form>
    </>
  )
}
