import React, { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import FieldError, { fieldClass, invalidProps, useFormErrors } from '../components/FieldError.jsx'
import InfoTip from '../components/InfoTip.jsx'
import Modal from '../components/Modal.jsx'
import PasswordField from '../components/PasswordField.jsx'
import RecoveryCodeCard from '../components/RecoveryCodeCard.jsx'
import { showToast } from '../components/Toast.jsx'
import { OWNER_ONLY_ACTIONS, USER_ROLES } from '../constants.js'
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserActive,
  updateUser
} from '../services/userService.js'

// หน้าจัดการผู้ใช้งานระบบ — เจ้าของหอเท่านั้นที่เข้าถึงได้
//
// ที่มา: ระบบเคยสร้างผู้ใช้ได้คนเดียวทั้งระบบ (auth:setup ทำงานเฉพาะตอนยังไม่มีใคร)
// ไม่มีช่องสร้างคนที่สองเลย · เจ้าของหออาจจ้างคนมาดูแลแทนในอนาคต (ผู้ใช้ยืนยัน 2026-08-14)
// จึงต้องมีที่ให้เพิ่มบัญชี และต้องแยกได้ว่าใครทำอะไรได้บ้าง
//
// **ไม่มีการลบผู้ใช้ มีแต่ปิดการใช้งาน** — ใบเสร็จทุกใบอ้าง created_by ไว้
// ลบแถวผู้ใช้ = คอลัมน์ "ผู้รับเงิน" ของเอกสารเก่ากลายเป็นช่องว่างย้อนหลังทั้งระบบ
export default function UsersPage({ user }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // ฟอร์มที่เปิดอยู่: null | { mode: 'create' } | { mode: 'edit', target } | { mode: 'password', target }
  const [dialog, setDialog] = useState(null)
  // รหัสสำรองที่เพิ่งออกให้ — แสดงครั้งเดียว ไม่มีทางเรียกดูอีก
  const [issuedCode, setIssuedCode] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listUsers()
    setLoading(false)
    if (!res.success) return setError(res.error)
    setError('')
    setUsers(res.data.users)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggleActive(target) {
    setError('')
    const res = await setUserActive(target.userId, !target.isActive)
    if (!res.success) return setError(res.error)
    showToast(`${target.isActive ? 'ปิด' : 'เปิด'}การใช้งานบัญชี ${target.fullName} แล้ว`)
    load()
  }

  // รหัสสำรองกินทั้งหน้าจอเพราะต้องจดก่อนไปต่อ — วางปนกับตารางแล้วจะถูกกดข้ามไป
  if (issuedCode) {
    return (
      <RecoveryCodeCard
        code={issuedCode.code}
        title={`รหัสสำรองของ ${issuedCode.fullName}`}
        description={
          'รหัสนี้ใช้กู้รหัสผ่านของบัญชีเจ้าของหอเมื่อลืมรหัสผ่าน แสดงครั้งเดียวเท่านั้น ' +
          'จดหรือคัดลอกเก็บไว้ในที่ปลอดภัยก่อนกดปิด — ระบบไม่มีทางแสดงซ้ำได้อีก ' +
          'และถ้าลืมทั้งรหัสผ่านและรหัสสำรอง บัญชีนั้นจะกู้ไม่ได้เลย'
        }
        doneLabel="จดไว้แล้ว"
        onDone={() => {
          setIssuedCode(null)
          load()
        }}
      />
    )
  }

  return (
    <>
      <section className="panel">
        <Alert>{error}</Alert>

        <div className="panel-head-row">
          <h2 className="panel-title">
            บัญชีผู้ใช้ ({users.length})
            <InfoTip
              title="จัดการบัญชี"
              points={[
                'บัญชีที่ไม่ใช้แล้วให้ปิดการใช้งาน ไม่มีการลบ เพราะใบเสร็จเก่าอ้างชื่อผู้รับเงินไว้',
                '“ตั้งรหัสผ่านใหม่” ใช้กับบัญชีของคนอื่นเท่านั้น',
                'รหัสผ่านของคุณเองเปลี่ยนที่ ตั้งค่า › บัญชีผู้ใช้และความปลอดภัย'
              ]}
            />
          </h2>
          <button type="button" className="btn btn-sm" onClick={() => setDialog({ mode: 'create' })}>
            <Icon name="plus" />
            <span>เพิ่มผู้ใช้</span>
          </button>
        </div>

        {loading ? (
          <p className="muted">กำลังโหลด...</p>
        ) : users.length === 0 ? (
          <p className="muted table-empty">ยังไม่มีบัญชีผู้ใช้</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ชื่อ-นามสกุล</th>
                <th>เบอร์โทรศัพท์</th>
                <th>อีเมล</th>
                <th>บทบาท</th>
                <th>สถานะ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.userId} className={row.isActive ? undefined : 'receipt-row-cancelled'}>
                  <td>
                    {row.fullName}
                    {row.userId === user?.userId && <span className="room-badge user-self-badge">คุณ</span>}
                  </td>
                  <td>{row.phone}</td>
                  <td>{row.email ?? '-'}</td>
                  <td>{row.roleLabel}</td>
                  <td>{row.isActive ? 'ใช้งานอยู่' : 'ปิดการใช้งาน'}</td>
                  <td className="align-right">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setDialog({ mode: 'edit', target: row })}
                    >
                      แก้ไข
                    </button>{' '}
                    {/* ปุ่มนี้ไม่ถามรหัสเดิม จึงมีไว้ตั้งให้ "คนอื่น" เท่านั้น
                        รหัสของตัวเองเปลี่ยนที่ ตั้งค่า › บัญชีผู้ใช้และความปลอดภัย ซึ่งบังคับ
                        กรอกรหัสเดิม — ถ้ายื่นปุ่มนี้ให้กดใส่ตัวเอง ด่านนั้นก็ไร้ความหมาย
                        (main ก็ปฏิเสธเหมือนกัน ที่นี่แค่ไม่ยื่นปุ่มให้กด) */}
                    {row.userId !== user?.userId && (
                      <>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setDialog({ mode: 'password', target: row })}
                        >
                          ตั้งรหัสผ่านใหม่
                        </button>{' '}
                      </>
                    )}
                    {/* ปิดบัญชีตัวเองไม่ได้ — กดพลาดแล้วออกจากระบบไม่ได้กลับเข้ามาอีก */}
                    {row.userId !== user?.userId && (
                      <button
                        type="button"
                        className={'link-btn' + (row.isActive ? ' link-danger' : '')}
                        onClick={() => toggleActive(row)}
                      >
                        {row.isActive ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {dialog?.mode === 'create' && (
        <UserFormDialog
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null)
            showToast(`เพิ่มบัญชี ${result.user.fullName} แล้ว`)
            if (result.recoveryCode) {
              setIssuedCode({ code: result.recoveryCode, fullName: result.user.fullName })
            } else {
              load()
            }
          }}
        />
      )}

      {dialog?.mode === 'edit' && (
        <UserFormDialog
          target={dialog.target}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null)
            showToast(`บันทึกข้อมูลของ ${result.user.fullName} แล้ว`)
            // เลื่อนพนักงานขึ้นเป็นเจ้าของ = ได้รหัสสำรองใบแรก ต้องให้จดทันที
            if (result.recoveryCode) {
              setIssuedCode({ code: result.recoveryCode, fullName: result.user.fullName })
            } else {
              load()
            }
          }}
        />
      )}

      {dialog?.mode === 'password' && (
        <ResetPasswordDialog
          target={dialog.target}
          onClose={() => setDialog(null)}
          onSaved={(target) => {
            setDialog(null)
            showToast(`ตั้งรหัสผ่านใหม่ให้ ${target.fullName} แล้ว`)
          }}
        />
      )}
    </>
  )
}

// ------------------------------------------------------------------
// ฟอร์มเดียวใช้ทั้งเพิ่มและแก้ไข — ต่างกันแค่ช่องรหัสผ่าน (ตอนแก้ไขไม่มี เพราะการตั้ง
// รหัสผ่านใหม่เป็นคนละคำสั่ง และไม่ควรเผลอเปลี่ยนรหัสผ่านของคนอื่นตอนแก้เบอร์โทร)
// ชื่อช่องต้องตรงกับ key ที่ main ส่งกลับใน fields (src/main/db/users.js / auth.js)
const USER_FORM_FIELDS = ['fullName', 'phone', 'email', 'password', 'role']

function UserFormDialog({ target, onClose, onSaved }) {
  const editing = Boolean(target)
  const [form, setForm] = useState(() => ({
    fullName: target?.fullName ?? '',
    phone: target?.phone ?? '',
    email: target?.email ?? '',
    password: '',
    role: target?.role ?? 'staff'
  }))
  const [busy, setBusy] = useState(false)
  const { errors, formError, fromResult, clear, reset } = useFormErrors(USER_FORM_FIELDS)

  // แก้ช่องไหน error ของช่องนั้นหายทันที
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    clear(key)
  }

  async function submit() {
    reset()
    setBusy(true)
    const res = editing
      ? await updateUser({ userId: target.userId, ...form })
      : await createUser(form)
    setBusy(false)
    if (!res.success) return fromResult(res)
    onSaved(res.data)
  }

  return (
    <Modal
      title={editing ? `แก้ไขบัญชี ${target.fullName}` : 'เพิ่มผู้ใช้งาน'}
      icon="account"
      submitLabel={editing ? 'บันทึก' : 'สร้างบัญชี'}
      busy={busy}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className={fieldClass('field field-required', errors.fullName)}>
        <label htmlFor="userFullName">
          ชื่อ-นามสกุล <span className="required">* จำเป็น</span>
        </label>
        <input
          id="userFullName"
          type="text"
          value={form.fullName}
          onChange={set('fullName')}
          {...invalidProps('userFullName', errors.fullName)}
        />
        <FieldError id="userFullName-error" message={errors.fullName} />
      </div>

      <div className={fieldClass('field field-required', errors.phone)}>
        <label htmlFor="userPhone">
          เบอร์โทรศัพท์ <span className="required">* จำเป็น</span>
          <InfoTip title="เบอร์โทรศัพท์" points={['ใช้เข้าสู่ระบบ', 'ต้องไม่ซ้ำกับบัญชีอื่น']} />
        </label>
        <input
          id="userPhone"
          type="text"
          value={form.phone}
          onChange={set('phone')}
          {...invalidProps('userPhone', errors.phone)}
        />
        <FieldError id="userPhone-error" message={errors.phone} />
      </div>

      <div className={fieldClass('field', errors.email)}>
        <label htmlFor="userEmail">
          อีเมล
          <InfoTip title="อีเมล" points={['ไม่บังคับ', 'ใช้เข้าสู่ระบบแทนเบอร์โทรได้']} />
        </label>
        <input
          id="userEmail"
          type="text"
          value={form.email}
          onChange={set('email')}
          {...invalidProps('userEmail', errors.email)}
        />
        <FieldError id="userEmail-error" message={errors.email} />
      </div>

      {!editing && (
        <PasswordField
          id="userPassword"
          label="รหัสผ่านเริ่มต้น"
          value={form.password}
          onChange={(v) => {
            setForm((f) => ({ ...f, password: v }))
            clear('password')
          }}
          autoComplete="new-password"
          hint="อย่างน้อย 8 ตัวอักษร"
          error={errors.password}
        />
      )}

      <div className={fieldClass('field', errors.role)}>
        <label htmlFor="userRole">
          บทบาท
          <InfoTip title="เฉพาะเจ้าของหอทำได้" points={OWNER_ONLY_ACTIONS} />
        </label>
        <select
          id="userRole"
          value={form.role}
          onChange={set('role')}
          {...invalidProps('userRole', errors.role)}
        >
          {USER_ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <FieldError id="userRole-error" message={errors.role} />
      </div>

      {form.role === 'owner' && (
        <Alert kind="warn">
          เจ้าของหอจะได้<strong>รหัสสำรอง</strong>ไว้กู้รหัสผ่าน · แสดงให้จดครั้งเดียวหลังบันทึก
        </Alert>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------
// ทางกู้คืนของพนักงาน — พนักงานไม่มีรหัสสำรอง เจ้าของจึงเป็นคนตั้งรหัสผ่านใหม่ให้
function ResetPasswordDialog({ target, onClose, onSaved }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const { errors, formError, fromResult, clear, reset } = useFormErrors(['newPassword'])

  async function submit() {
    reset()
    setBusy(true)
    const res = await resetUserPassword(target.userId, password)
    setBusy(false)
    if (!res.success) return fromResult(res)
    onSaved(target)
  }

  return (
    <Modal
      title={`ตั้งรหัสผ่านใหม่ให้ ${target.fullName}`}
      icon="lock"
      submitLabel="ตั้งรหัสผ่านใหม่"
      busy={busy}
      error={formError}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert kind="warn">
        รหัสผ่านเดิมใช้ไม่ได้ทันที · แจ้งรหัสใหม่ให้เจ้าตัวทราบ
      </Alert>

      <PasswordField
        id="resetPassword"
        label="รหัสผ่านใหม่"
        value={password}
        onChange={(v) => {
          setPassword(v)
          clear('newPassword')
        }}
        autoComplete="new-password"
        autoFocus
        hint="อย่างน้อย 8 ตัวอักษร"
        error={errors.newPassword}
      />
    </Modal>
  )
}
