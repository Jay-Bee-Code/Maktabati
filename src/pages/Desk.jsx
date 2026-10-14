import { useCallback, useEffect, useState } from 'react'
import { UserRound, X, Printer } from 'lucide-react'
import { call } from '../api.js'
import { useSettings } from '../settings.jsx'
import { useReceipt } from '../printing.jsx'
import { Badge, Button, Combobox, DaysPicker, PageHeader, SegTabs, useToast } from '../ui.jsx'
import { tr } from '../i18n.js'

const searchMembers = (q) => call('members:search', q)
const searchBooks = (q) => call('books:search', { q, onlyAvailable: false })
const searchOpen = (q) => call('loans:searchOpen', q)

const TONE = { ok: 'text-moss', warn: 'text-brass', bad: 'text-brick' }

function Step({ n, title, children }) {
  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-2xl font-bold">
        <span className="grid size-7 place-items-center rounded-full bg-mist text-sm font-semibold">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

export default function Desk({ params }) {
  const notify = useToast()
  const { settings } = useSettings()
  const [mode, setMode] = useState('borrow')
  const [member, setMember] = useState(null)
  const [open, setOpen] = useState([]) // الكتب التي بحوزة العضو الحالي
  const [info, setInfo] = useState({ unpaid: 0, ready: [] })
  const [session, setSession] = useState([]) // ما أُعير في هذه الجلسة للعضو الحالي (للإيصال)
  const printReceipt = useReceipt()
  const [days, setDays] = useState(settings.default_loan_days)
  const [log, setLog] = useState([])
  const [bookKey, setBookKey] = useState(0)
  const [retKey, setRetKey] = useState(0)

  useEffect(() => setDays(settings.default_loan_days), [settings.default_loan_days])

  // عضو قادم من صفحة العضو
  useEffect(() => {
    if (params?.member) { setMode('borrow'); setMember(params.member) }
  }, [params])

  const refreshOpen = useCallback(async (m) => {
    try {
      const r = await call('members:get', m.id)
      setOpen(r.open)
      setInfo({ unpaid: r.member.unpaid_fines, ready: r.reservations.filter((x) => x.status === 'ready') })
    } catch { /* يُظهر الإشعار عند الإعارة */ }
  }, [])
  useEffect(() => {
    setSession([])
    if (member) refreshOpen(member)
    else { setOpen([]); setInfo({ unpaid: 0, ready: [] }) }
  }, [member, refreshOpen])

  const addLog = (kind, text, tone) =>
    setLog((l) => [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString('sv-SE').slice(0, 5), kind, text, tone }, ...l].slice(0, 50))

  const borrow = async (book) => {
    if (!member) return
    try {
      const r = await call('loans:borrow', {
        member_id: member.id, book_id: book.id, barcode: book.matched_barcode || undefined, days: Number(days),
      })
      addLog(tr("إعارة"), tr("«{0}» ({1}) ← {2} حتى {3}", [r.title, r.barcode, r.member_name, r.due_date]), 'ok')
      setSession((x) => [...x, { title: r.title, barcode: r.barcode, due_date: r.due_date }])
      refreshOpen(member)
    } catch (e) {
      addLog(tr("تعذّرت"), e.message, 'bad')
      notify(e.message, 'err')
    }
    setBookKey((k) => k + 1)
  }

  const giveBack = async (loan) => {
    try {
      const r = await call('loans:return', loan.id)
      addLog(tr("إرجاع"), tr("«{0}» ({1}) من {2}{3}", [r.title, r.barcode || '—', r.member_name, r.days_late ? tr(" — متأخر {0} يومًا", [r.days_late]) : '']), r.days_late ? 'warn' : 'ok')
      if (r.fine > 0) addLog(tr("غرامة"), tr("{0} {1} على {2} (تأخير {3} يومًا)", [r.fine, settings.currency, r.member_name, r.days_late]), 'bad')
      if (r.holdFor) {
        addLog(tr("احجزها"), tr("ضع «{0}» جانبًا: محجوزة للعضو {1}", [r.title, r.holdFor]), 'warn')
        notify(tr("ضع «{0}» جانبًا: محجوزة للعضو {1}", [r.title, r.holdFor]))
      }
      if (member) refreshOpen(member)
    } catch (e) {
      addLog(tr("تعذّر"), e.message, 'bad')
      notify(e.message, 'err')
    }
    setRetKey((k) => k + 1)
  }

  const payFines = async () => {
    try {
      const r = await call('fines:payMember', { member_id: member.id })
      addLog(tr("تسديد"), tr("{0} {1} من {2}", [r.paid, settings.currency, member.name]), 'ok')
      refreshOpen(member)
    } catch (e) { notify(e.message, 'err') }
  }

  const full = member && open.length >= settings.max_loans

  return (
    <>
      <PageHeader title={tr("مكتب الإعارة")} subtitle={tr("امسح بطاقة العضو وباركود الكتب بالقارئ، أو اكتب للبحث ثم Enter")} />
      <SegTabs layoutId="desk-mode" value={mode} onChange={setMode} tabs={[['borrow', tr("إعارة")], ['return', tr("إرجاع")]]} />

      {mode === 'borrow' ? (
        <div className="mt-5 grid grid-cols-2 gap-6">
          <Step n={tr("١")} title={tr("العضو")}>
            {!member ? (
              <Combobox
                key="member"
                autoFocus
                requireQuery
                ariaLabel={tr("العضو")}
                placeholder={tr("امسح البطاقة أو اكتب الاسم")}
                value={null}
                onChange={(m) => m && setMember(m)}
                fetcher={searchMembers}
                getLabel={(m) => m.name}
                emptyText={tr("لا يوجد عضو بهذا البحث")}
                renderOption={(m) => (
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{m.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted" dir="ltr">{m.card_no}</span>
                  </div>
                )}
              />
            ) : (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid size-11 place-items-center rounded-full bg-mist text-accent"><UserRound size={22} /></div>
                    <div>
                      <div className="text-lg font-semibold">{member.name}</div>
                      <div className="text-xs tabular-nums text-muted" dir="ltr">{member.card_no}</div>
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => setMember(null)} className="!px-3 !py-1.5"><X size={14} />{tr("تغيير العضو")}</Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone={full ? 'bad' : open.length ? 'warn' : 'mute'}>{tr("بحوزته {0} من {1}", [open.length, settings.max_loans])}</Badge>
                  {info.unpaid > 0 && <Badge tone="bad">{tr("غرامات {0} {1}", [info.unpaid, settings.currency])}</Badge>}
                  {info.ready.length > 0 && <Badge tone="ok">{tr("حجز جاهز:")}{' '}{info.ready.map((r) => r.title).join(tr("، "))}</Badge>}
                </div>
                {info.unpaid > 0 && (
                  <Button variant="outline" onClick={payFines} className="mt-3 !px-3 !py-1.5">{tr("تسديد الغرامات ({0} {1})", [info.unpaid, settings.currency])}</Button>
                )}
                {open.length > 0 && (
                  <ul className="mt-3 divide-y divide-line text-sm">
                    {open.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                        <span className="truncate">{l.title}</span>
                        {l.status === 'overdue' ? <Badge tone="bad">{tr("متأخر {0} يومًا", [l.days_late])}</Badge> : <span className="text-xs tabular-nums text-muted">{tr("حتى {0}", [l.due_date])}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Step>

          <Step n={tr("٢")} title={tr("الكتب")}>
            <div className="mb-3"><DaysPicker value={days} onChange={setDays} /></div>
            <Combobox
              key={`book-${bookKey}-${member?.id || 0}`}
              autoFocus
              requireQuery
              disabled={!member}
              ariaLabel={tr("الكتاب")}
              placeholder={member ? tr("امسح باركود النسخة أو اكتب العنوان") : tr("اختر العضو أولًا")}
              value={null}
              onChange={(b) => b && borrow(b)}
              fetcher={searchBooks}
              getLabel={(b) => b.title}
              emptyText={tr("لا توجد كتب بهذا البحث")}
              renderOption={(b) => (
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{b.title}</span>
                    <span className="block truncate text-xs text-muted">{b.author}{b.matched_barcode ? ` · ${b.matched_barcode}` : ''}</span>
                  </span>
                  <Badge tone={b.available <= 0 ? 'bad' : 'ok'}>{tr("{0} متاحة", [b.available])}</Badge>
                </div>
              )}
            />
            <p className="mt-2 text-xs text-muted">{tr("تُسجَّل الإعارة فور الاختيار أو الضغط على Enter، ويعود المؤشر للحقل للكتاب التالي.")}</p>
            {session.length > 0 && (
              <Button variant="outline" onClick={() => printReceipt(member, session)} className="mt-3"><Printer size={15} />{tr("طباعة إيصال ({0})", [session.length])}</Button>
            )}
          </Step>
        </div>
      ) : (
        <div className="mt-5 max-w-2xl">
          <Step n={tr("١")} title={tr("الكتاب العائد")}>
            <Combobox
              key={`ret-${retKey}`}
              autoFocus
              requireQuery
              ariaLabel={tr("الإعارة المفتوحة")}
              placeholder={tr("امسح باركود النسخة أو اكتب العنوان أو اسم العضو")}
              value={null}
              onChange={(l) => l && giveBack(l)}
              fetcher={searchOpen}
              getLabel={(l) => l.title}
              emptyText={tr("لا توجد إعارة مفتوحة بهذا البحث")}
              renderOption={(l) => (
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{l.title}</span>
                    <span className="block truncate text-xs text-muted">{l.member_name}{l.barcode ? ` · ${l.barcode}` : ''}</span>
                  </span>
                  {l.status === 'overdue' ? <Badge tone="bad">{tr("متأخر {0} يومًا", [l.days_late])}</Badge> : <Badge tone="warn">{tr("جارية")}</Badge>}
                </div>
              )}
            />
            <p className="mt-2 text-xs text-muted">{tr("يُسجَّل الإرجاع فور الاختيار أو الضغط على Enter.")}</p>
          </Step>
        </div>
      )}

      <section className="mt-6 rounded-xl border border-line bg-card p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold">{tr("سجل الجلسة")}</h2>
          {log.length > 0 && <Button variant="ghost" onClick={() => setLog([])} className="!px-2 !py-1">{tr("مسح")}</Button>}
        </div>
        {log.length === 0 ? (
          <p className="py-4 text-sm text-muted">{tr("ستظهر هنا العمليات التي تنجزها الآن.")}</p>
        ) : (
          <ul className="divide-y divide-line text-sm" aria-live="polite">
            {log.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 py-2">
                <span className="tabular-nums text-xs text-muted">{e.time}</span>
                <span className={`w-14 shrink-0 font-semibold ${TONE[e.tone]}`}>{e.kind}</span>
                <span className="min-w-0">{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
