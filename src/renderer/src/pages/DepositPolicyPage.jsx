import React, { useCallback, useEffect, useState } from 'react'
import Alert from '../components/Alert.jsx'
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
      <div className="info-banner">
        <strong>เงินประกันและการคืนเงิน</strong>
        <p>
          กติกาที่ระบบใช้ตัดสินตอนผู้เช่าย้ายออกว่าจะคืนเงินประกันหรือริบ ·
          ค่าที่ตั้งที่นี่จะถูกคัดลอกลง<strong>สัญญาใบใหม่</strong>ทุกใบตั้งแต่วันที่บันทึก
        </p>
      </div>

      {/* คำเตือนที่สำคัญที่สุดของหน้านี้ ต้องอยู่เหนือฟอร์ม ไม่ใช่เป็นเชิงอรรถข้างล่าง —
          คนที่เข้ามาแก้ตัวเลขส่วนใหญ่คาดหวังว่ามันจะมีผลกับทุกคนทันที ซึ่งไม่ใช่ */}
      <Alert kind="warn">
        การแก้ที่นี่<strong>ไม่กระทบสัญญาที่ทำไปแล้ว</strong>
        {saved.activeContractCount > 0 && ` (ตอนนี้มีสัญญาที่ยังใช้งานอยู่ ${saved.activeContractCount} ใบ)`}{' '}
        — สัญญาแต่ละใบเก็บกติกาที่ตกลงกับผู้เช่าไว้ ณ วันทำสัญญา และใช้กติกาชุดนั้นตอนย้ายออกเสมอ
        ผู้เช่าที่เซ็นตอนกติกาเป็นอย่างหนึ่ง จึงไม่ถูกกติกาใหม่ย้อนหลัง
      </Alert>

      <form className="form-section" onSubmit={submit}>
        <div className="form-section-head">
          <h2>กติกาคืนเงินประกัน</h2>
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
                  แจ้งไม่ทันตามนี้ = ริบเงินประกันทั้งหมด · หอนี้ใช้ 15 วัน (เจ้าของหอยืนยันแล้ว)
                </p>
              </div>

              <div className="field">
                <label htmlFor="minStayMonths">ต้องอยู่ครบอย่างน้อย (เดือน)</label>
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
                <p className="field-hint">
                  เว้นว่างไว้ = ใช้ระยะสัญญาของสัญญาใบนั้นเป็นเกณฑ์ (สัญญา 12 เดือนต้องอยู่ครบ 12)
                  · ใส่ตัวเลขเมื่อหอต้องการเกณฑ์ตายตัวเหมือนกันทุกสัญญา
                </p>
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

      <section className="panel">
        <h2 className="panel-title">กติกานี้ทำงานอย่างไรตอนย้ายออก</h2>
        <ul className="muted">
          <li>
            <strong>ค่าเสียหายหักจากเงินประกันเสมอ</strong> ทั้งกรณีคืนและกรณีริบ —
            เงินประกันมีไว้รองรับความเสียหายของห้องตั้งแต่แรก
          </li>
          <li>
            <strong>"ริบ" = ส่วนที่เหลือหลังหักค่าเสียหายไม่ได้คืน</strong>{' '}
            ไม่ใช่เงินประกันหายทั้งก้อนแล้วยังเรียกเก็บค่าซ่อมอีก
          </li>
          <li>
            <strong>ค่าน้ำ-ค่าไฟงวดสุดท้ายเก็บแยก</strong> ไม่แตะเงินประกัน (เป็นบิล ไม่ใช่ความเสียหาย)
          </li>
          <li>
            <strong>ต่อสัญญาแล้วนับเดือนต่อเนื่อง</strong> ข้ามทุกสัญญาในสาย — คนที่ต่อ 6+6
            ถือว่าอยู่มา 12 เดือน
          </li>
          <li>
            เจ้าของหอ<strong>กดข้ามผลการตัดสินได้</strong> ตอนย้ายออก แต่ต้องพิมพ์เหตุผลกำกับ
          </li>
        </ul>
      </section>
    </>
  )
}
