import { useState } from 'react'
import { Copy } from 'lucide-react'
import { Button, useToast } from './ui.jsx'
import { tr } from './i18n.js'

/** يعرض رمز الاسترداد مرة واحدة، ولا يسمح بالمتابعة قبل تأكيد المستخدم أنه حفظه */
export function RecoveryCodePanel({ code, intro, doneLabel = tr("متابعة"), onDone }) {
  const notify = useToast()
  const [saved, setSaved] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      notify(tr("تم نسخ الرمز"))
    } catch {
      notify(tr("تعذّر النسخ تلقائيًا. اكتب الرمز يدويًا."), 'err')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-7">{intro}</p>
      <div
        dir="ltr"
        role="note"
        aria-label={tr("رمز الاسترداد")}
        className="select-all rounded-xl border-2 border-dashed border-brass bg-warn-bg px-4 py-5 text-center font-mono text-2xl font-semibold tracking-widest"
      >
        {code}
      </div>
      <p className="text-sm leading-7 text-muted">{tr("يظهر هذا الرمز")}{' '}<strong className="text-ink">{tr("مرة واحدة فقط")}</strong>{tr(". اكتبه على ورقة واحفظها في مكان آمن بعيدًا عن الحاسوب. من يملكه يستطيع إعادة تعيين كلمة مرور المدير، ومن يفقده مع كلمة المرور يفقد الوصول إلى البيانات.")}</p>
      <div>
        <Button variant="outline" onClick={copy}><Copy size={15} />{tr("نسخ الرمز")}</Button>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4" />{tr("حفظتُ الرمز في مكان آمن")}</label>
      <Button disabled={!saved} onClick={onDone}>{doneLabel}</Button>
    </div>
  )
}
