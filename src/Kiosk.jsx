import { useEffect, useRef, useState } from 'react'
import { Library } from 'lucide-react'
import { call } from './api.js'
import { useSettings } from './settings.jsx'
import { Badge, Button, Field, Modal, inputCls, useFocusTrap } from './ui.jsx'
import { norm } from './text.js'
import { tr } from './i18n.js'

export const KIOSK_IDLE_MS = 60_000

function Availability({ b }) {
  if (b.copies === 0) return <Badge tone="mute">{tr("غير متوفر")}</Badge>
  if (b.available > 0) return <Badge tone="ok">{tr("متاح ({0} {1})", [b.available, b.available === 1 ? tr("نسخة") : tr("نسخ")])}</Badge>
  return <Badge tone="warn">{tr("معار حاليًا")}</Badge>
}

/**
 * شاشة بحث للقرّاء: لا تعرض أي بيانات شخصية. الخروج منها يتطلب كلمة مرور المستخدم الحالي.
 * ملاحظة: هذا قفل على مستوى واجهة التطبيق وليس عزلًا على مستوى نظام التشغيل.
 */
export default function Kiosk({ onExit, idleMs = KIOSK_IDLE_MS }) {
  const { settings } = useSettings()
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [asking, setAsking] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useFocusTrap(rootRef, () => {}) // يُمنع Escape من أي إغلاق، ويُحبس التركيز داخل الشاشة

  // البحث
  useEffect(() => {
    if (norm(q).length < 2) { setRows([]); return }
    let live = true
    const t = setTimeout(async () => {
      try { const r = await call('kiosk:search', q); if (live) setRows(r) } catch { /* يبقى ما كان معروضًا */ }
    }, 200)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  // الخمول: تُفرَّغ نتائج القارئ السابق ليبدأ التالي من صفحة نظيفة
  useEffect(() => {
    if (asking) return
    let t
    const reset = () => {
      clearTimeout(t)
      t = setTimeout(() => { setQ(''); inputRef.current?.focus() }, idleMs)
    }
    reset()
    const evs = ['keydown', 'pointerdown', 'pointermove']
    evs.forEach((e) => window.addEventListener(e, reset))
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)) }
  }, [idleMs, asking])

  const closeAsk = () => { setAsking(false); setPw(''); setErr('') }

  const exit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await call('auth:verify', { password: pw })
      try { await call('app:fullscreen', { on: false }) } catch { /* لا يمنع الخروج */ }
      onExit()
    } catch (ex) {
      setErr(ex.message)
      setPw('')
    } finally {
      setBusy(false)
    }
  }

  const searched = norm(q).length >= 2

  return (
    <>
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={tr("وضع القارئ")}
        tabIndex={-1}
        className="fixed inset-0 z-[80] flex flex-col overflow-auto bg-paper outline-none"
      >
        <header className="flex flex-col items-center gap-3 px-8 pb-6 pt-12 text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-teal text-white"><Library size={30} /></div>
          <h1 className="font-display text-5xl font-bold">{settings.library_name}</h1>
          <p className="text-lg text-muted">{tr("ابحث عن كتاب بالعنوان أو المؤلف أو الموضوع")}</p>
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={tr("ابحث عن كتاب")}
            placeholder={tr("اكتب هنا…")}
            className={`${inputCls} mt-3 max-w-2xl !rounded-2xl !px-5 !py-4 !text-2xl`}
          />
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-8 pb-24">
          {!searched ? (
            <p className="py-10 text-center text-muted">{tr("اكتب حرفين على الأقل لبدء البحث.")}</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-lg text-muted">{tr("لا توجد نتائج لـ «{0}». جرّب كلمة أخرى أو اسأل أمين المكتبة.", [q])}</p>
          ) : (
            <ul className="flex flex-col gap-3" aria-label={tr("نتائج البحث")}>
              {rows.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-6 rounded-2xl border border-line bg-card px-6 py-4">
                  <div className="min-w-0">
                    <div className="font-display text-2xl font-bold leading-snug">{b.title}</div>
                    <div className="text-muted">{b.author}{b.year ? ` · ${b.year}` : ''}{b.category ? ` · ${b.category}` : ''}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Availability b={b} />
                    {b.shelf && <span className="rounded-lg bg-mist px-3 py-1 text-lg font-semibold">{tr("الرفّ:")}{' '}<span dir="ltr">{b.shelf}</span></span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>

        <footer className="fixed bottom-4 start-4">
          <Button variant="ghost" onClick={() => setAsking(true)} className="!text-xs !text-muted">{tr("خروج (للموظفين)")}</Button>
        </footer>
      </div>

      <Modal open={asking} onClose={closeAsk} title={tr("الخروج من وضع القارئ")} z="z-[90]">
        <form onSubmit={exit} className="flex flex-col gap-4">
          <Field label={tr("كلمة مرور المستخدم الحالي")}>
            <input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" dir="ltr" className={`${inputCls} text-end`} />
          </Field>
          {err && <p role="alert" className="text-sm text-brick">{err}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={closeAsk}>{tr("إلغاء")}</Button>
            <Button type="submit" disabled={busy}>{tr("خروج")}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
