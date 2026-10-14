import { useEffect, useState } from 'react'
import { Copy, Mail } from 'lucide-react'
import { call } from './api.js'
import { Button, Modal, inputCls, useToast } from './ui.jsx'
import { tr } from './i18n.js'

/** نافذة رسالة تذكير جاهزة: تُنسخ أو تُفتح في برنامج البريد */
export function ReminderModal({ open, onClose, memberId, kind = 'overdue' }) {
  const notify = useToast()
  const [d, setD] = useState(null)
  const [text, setText] = useState('')

  useEffect(() => {
    if (!open || !memberId) return
    setD(null)
    let live = true
    call('reminders:text', { member_id: memberId, kind })
      .then((r) => { if (live) { setD(r); setText(r.text) } })
      .catch((e) => { notify(e.message, 'err'); onClose() })
    return () => { live = false }
  }, [open, memberId, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      notify(tr("تم نسخ الرسالة"))
    } catch {
      notify(tr("تعذّر النسخ تلقائيًا. حدّد النص وانسخه يدويًا."), 'err')
    }
  }
  const mail = async () => {
    try { await call('app:openMail', { to: d.member.email, subject: d.subject, body: text }) } catch (e) { notify(e.message, 'err') }
  }

  return (
    <Modal open={open} onClose={onClose} title={kind === 'ready' ? tr("رسالة: الحجز جاهز") : tr("رسالة تذكير بالإرجاع")} wide>
      {!d ? (
        <p className="py-6 text-center text-sm text-muted">{tr("جارٍ التحضير…")}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{tr("إلى")}{' '}<span className="font-medium text-ink">{d.member.name}</span>
            {d.member.phone && <>{' '}{tr("· الهاتف")}{' '}<span dir="ltr" className="tabular-nums">{d.member.phone}</span></>}
            {d.member.email && <> · <span dir="ltr">{d.member.email}</span></>}
          </p>
          <textarea
            aria-label={tr("نص الرسالة")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={11}
            className={`${inputCls} leading-7`}
          />
          <p className="mt-2 text-xs text-muted">{tr("يمكنك تعديل النص قبل الإرسال. التطبيق لا يرسل الرسائل بنفسه: انسخها إلى الواتساب أو الرسائل النصية، أو افتحها في البريد.")}</p>
          <div className="mt-5 flex justify-end gap-2">
            {d.member.email && <Button variant="outline" onClick={mail}><Mail size={16} />{tr("فتح في البريد")}</Button>}
            <Button onClick={copy}><Copy size={16} />{tr("نسخ الرسالة")}</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
