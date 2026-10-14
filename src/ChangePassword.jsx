import { useState } from 'react'
import { call } from './api.js'
import { Button, Field, Modal, inputCls, useToast } from './ui.jsx'
import { tr } from './i18n.js'

export default function ChangePassword({ open, onClose }) {
  const [f, setF] = useState({ oldPassword: '', newPassword: '', confirm: '' })
  const notify = useToast()
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const close = () => { setF({ oldPassword: '', newPassword: '', confirm: '' }); onClose() }

  const submit = async (e) => {
    e.preventDefault()
    if (f.newPassword !== f.confirm) return notify(tr("كلمتا المرور الجديدتان غير متطابقتين"), 'err')
    try {
      await call('auth:changePassword', { oldPassword: f.oldPassword, newPassword: f.newPassword })
      notify(tr("تم تغيير كلمة المرور"))
      close()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  return (
    <Modal open={open} onClose={close} title={tr("تغيير كلمة المرور")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={tr("كلمة المرور الحالية")}><input type="password" required value={f.oldPassword} onChange={set('oldPassword')} dir="ltr" className={`${inputCls} text-end`} /></Field>
        <Field label={tr("كلمة المرور الجديدة (8 أحرف على الأقل)")}><input type="password" required minLength={8} value={f.newPassword} onChange={set('newPassword')} dir="ltr" className={`${inputCls} text-end`} /></Field>
        <Field label={tr("تأكيد كلمة المرور الجديدة")}><input type="password" required value={f.confirm} onChange={set('confirm')} dir="ltr" className={`${inputCls} text-end`} /></Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>{tr("إلغاء")}</Button>
          <Button type="submit">{tr("حفظ")}</Button>
        </div>
      </form>
    </Modal>
  )
}
