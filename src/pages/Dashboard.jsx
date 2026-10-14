import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { call } from '../api.js'
import { Bell } from 'lucide-react'
import { Badge, Button, Empty, PageHeader, catColor, useToast } from '../ui.jsx'
import { useSettings } from '../settings.jsx'
import { ReminderModal } from '../reminders.jsx'
import { tr, tk, dateTag } from '../i18n.js'
import { catLabel } from '../categories.js'

const todayText = () => new Date().toLocaleDateString(dateTag(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

function Shelf({ categories }) {
  if (!categories.length)
    return <Empty title={tr("الرفّ فارغ")} hint={tr("أضف كتبًا من صفحة «الكتب» لتظهر الأقسام هنا.")} />
  const max = Math.max(...categories.map((c) => c.count))
  return (
    <div className="flex items-end gap-2 border-b-[6px] border-brass px-6 pt-6" style={{ minHeight: 260 }}>
      {categories.map((c, i) => {
        const h = 110 + (c.count / max) * 130
        return (
          <motion.div
            key={c.name}
            title={`${catLabel(c.name)}: ${c.count}`}
            initial={{ height: 0 }}
            animate={{ height: h }}
            transition={{ type: 'spring', stiffness: 120, damping: 16, delay: i * 0.07 }}
            className="flex w-14 flex-col items-center justify-between overflow-hidden rounded-t-md py-3 text-white"
            style={{ backgroundColor: catColor(c.name) }}
          >
            <span className="text-sm font-semibold tabular-nums">{c.count}</span>
            <span className="max-h-[70%] overflow-hidden text-ellipsis whitespace-nowrap text-sm" style={{ writingMode: 'vertical-rl' }}>
              {catLabel(c.name)}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

function Stat({ value, label, tone }) {
  return (
    <div className="flex-1 px-6 py-5">
      <div className={`text-4xl font-semibold tabular-nums ${tone || ''}`}>{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  )
}

const statusBadge = { overdue: ['bad', tk("متأخرة")], active: ['warn', tk("جارية")], returned: ['ok', tk("مُعادة")] }

export default function Dashboard({ go }) {
  const [s, setS] = useState(null)
  const notify = useToast()

  const { settings } = useSettings()
  const [remind, setRemind] = useState(null) // { memberId, kind }

  useEffect(() => {
    call('stats:get').then(setS).catch((e) => notify(e.message, 'err'))
  }, [notify])

  return (
    <>
      <PageHeader title={tr("نظرة عامة")} subtitle={todayText()} />
      {!s ? null : (
        <div className="flex flex-col gap-6">
          <section className="flex divide-x rtl:divide-x-reverse divide-line overflow-hidden rounded-xl border border-line bg-card">
            <Stat value={s.titles} label={tr("عنوان")} />
            <Stat value={s.available} label={tr("نسخة متاحة من {0}", [s.copies])} tone="text-moss" />
            <Stat value={s.members} label={tr("عضو مسجَّل")} />
            <Stat value={s.active} label={tr("إعارة جارية")} tone="text-brass" />
            <Stat value={s.overdue} label={tr("إعارة متأخرة")} tone={s.overdue ? 'text-brick' : ''} />
            {s.unpaidFines > 0 && <Stat value={s.unpaidFines} label={tr("غرامات مستحقة ({0})", [settings.currency])} tone="text-brick" />}
          </section>

          <section className="overflow-hidden rounded-xl border border-line bg-card">
            <div className="px-6 pt-5">
              <h2 className="font-display text-2xl font-bold">{tr("أقسام المكتبة")}</h2>
              <p className="text-sm text-muted">{tr("عدد العناوين في كل تصنيف")}</p>
            </div>
            <Shelf categories={s.categories} />
          </section>

          <div className="grid grid-cols-2 gap-6">
            <section className="rounded-xl border border-line bg-card p-6">
              <h2 className="mb-3 font-display text-2xl font-bold">{tr("تحتاج إلى متابعة")}</h2>
              {s.overdueList.length === 0 ? (
                <p className="py-6 text-sm text-muted">{tr("لا توجد كتب متأخرة حاليًا.")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {s.overdueList.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{l.title}</div>
                        <div className="truncate text-sm text-muted">{l.member_name}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone="bad">{tr("متأخر {0} يومًا", [l.days_late])}</Badge>
                        <Button variant="outline" onClick={() => setRemind({ memberId: l.member_id, kind: 'overdue' })} className="!px-2.5 !py-1"><Bell size={14} />{tr("تذكير")}</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-line bg-card p-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-2xl font-bold">{tr("آخر الإعارات")}</h2>
                <Button variant="ghost" onClick={() => go('loans')} className="!px-2 !py-1">{tr("عرض الكل")}</Button>
              </div>
              {s.recent.length === 0 ? (
                <p className="py-6 text-sm text-muted">{tr("لم تُسجَّل أي إعارة بعد.")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {s.recent.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{l.title}</div>
                        <div className="truncate text-sm text-muted">
                          {l.member_name} · <span className="tabular-nums">{l.loan_date}</span>
                        </div>
                      </div>
                      <Badge tone={statusBadge[l.status][0]}>{tr(statusBadge[l.status][1])}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {s.readyList.length > 0 && (
            <section className="rounded-xl border border-line bg-card p-6">
              <h2 className="mb-1 font-display text-2xl font-bold">{tr("حجوزات جاهزة للاستلام")}</h2>
              <p className="mb-3 text-sm text-muted">{tr("ضع النسخة جانبًا وأبلغ العضو. تنتهي المهلة تلقائيًا فتنتقل النسخة للتالي في الطابور.")}</p>
              <ul className="divide-y divide-line">
                {s.readyList.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.title}</div>
                      <div className="truncate text-sm text-muted">{tr("{0} · حتى", [r.member_name])}{' '}<span className="tabular-nums">{r.expires_at}</span></div>
                    </div>
                    <Button variant="outline" onClick={() => setRemind({ memberId: r.member_id, kind: 'ready' })} className="!px-2.5 !py-1"><Bell size={14} />{tr("إبلاغ")}</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <ReminderModal open={!!remind} onClose={() => setRemind(null)} memberId={remind?.memberId} kind={remind?.kind} />
    </>
  )
}
