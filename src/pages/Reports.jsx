import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { call } from '../api.js'
import { useSettings } from '../settings.jsx'
import { Empty, PageHeader, SegTabs, catColor, useToast } from '../ui.jsx'
import { tr, tk, dateTag, isRtl } from '../i18n.js'
import { catLabel } from '../categories.js'

const PERIODS = [['30', tk("30 يومًا")], ['90', tk("90 يومًا")], ['365', tk("12 شهرًا")], ['all', tk("الكل")]]

const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(dateTag(), { month: 'short' })
}

/* ---------- رسم أعمدة الإعارات الشهرية ----------
   الزمن يسير من اليمين إلى اليسار (أقدم شهر في اليمين) ليوافق اتجاه الواجهة. */
function MonthlyChart({ data }) {
  const W = 720, H = 220, padX = 16, top = 24, bottom = 30
  const step = (W - padX * 2) / data.length
  const max = Math.max(1, ...data.map((d) => d.n))
  const base = H - bottom
  const bw = Math.min(34, step * 0.62)
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr("الإعارات الشهرية خلال آخر 12 شهرًا")} className="w-full">
        <line x1={padX} x2={W - padX} y1={base} y2={base} stroke="var(--color-line)" strokeWidth="1" />
        {data.map((d, i) => {
          const h = (d.n / max) * (base - top)
          // الزمن يسير مع اتجاه القراءة: أقدم شهر عند بداية السطر
          const x = isRtl() ? W - padX - (i + 0.5) * step : padX + (i + 0.5) * step
          const last = i === data.length - 1
          return (
            <g key={d.month}>
              <motion.rect
                x={x - bw / 2} width={bw} rx="4"
                fill={last ? 'var(--color-brass)' : 'var(--color-teal)'}
                initial={{ height: 0, y: base }}
                animate={{ height: h, y: base - h }}
                transition={{ type: 'spring', stiffness: 120, damping: 18, delay: i * 0.04 }}
              />
              {d.n > 0 && <text x={x} y={base - h - 6} textAnchor="middle" fontSize="12" fill="var(--color-ink)">{d.n}</text>}
              <text x={x} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--color-muted)">{monthLabel(d.month)}</text>
            </g>
          )
        })}
      </svg>
      {/* نسخة نصية لقارئات الشاشة */}
      <table className="sr-only" aria-label={tr("الإعارات الشهرية")}>
        <tbody>{data.map((d) => <tr key={d.month}><td>{d.month}</td><td>{d.n}</td></tr>)}</tbody>
      </table>
      <figcaption className="mt-1 text-xs text-muted">{tr("الشهر الحالي بلون مختلف، وقد لا يكون مكتملًا.")}</figcaption>
    </figure>
  )
}

/* ---------- قائمة مرتبة بشريط نسبي ---------- */
function RankList({ title, rows, label, sub, color, empty }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  return (
    <section className="rounded-xl border border-line bg-card p-6">
      <h2 className="mb-3 font-display text-2xl font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-muted">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <li key={r.id ?? r.name} className="relative overflow-hidden rounded-lg bg-mist/50 px-3 py-2">
              <motion.span
                aria-hidden="true"
                className="absolute inset-y-0 start-0 rounded-lg opacity-20"
                style={{ backgroundColor: color(r) }}
                initial={{ width: 0 }}
                animate={{ width: `${(r.n / max) * 100}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20, delay: i * 0.04 }}
              />
              <div className="relative flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{label(r)}</span>
                  {sub && <span className="block truncate text-xs text-muted">{sub(r)}</span>}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{r.n}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Tile({ value, label, tone }) {
  return (
    <div className="flex-1 px-5 py-4">
      <div className={`text-3xl font-semibold tabular-nums ${tone || ''}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  )
}

export default function Reports() {
  const notify = useToast()
  const { settings } = useSettings()
  const [period, setPeriod] = useState('90')
  const [r, setR] = useState(null)

  useEffect(() => {
    let live = true
    call('reports:get', { days: period === 'all' ? 'all' : Number(period) })
      .then((d) => live && setR(d))
      .catch((e) => notify(e.message, 'err'))
    return () => { live = false }
  }, [period, notify])

  const s = r?.summary
  const anyFines = s && (s.finesCharged || s.finesCollected || s.finesWaived)

  return (
    <>
      <PageHeader
        title={tr("التقارير")}
        subtitle={tr("نشاط المكتبة وأكثر الكتب والأعضاء استعارة")}
        action={<SegTabs layoutId="report-period" value={period} onChange={setPeriod} tabs={PERIODS} />}
      />
      {!r ? null : (
        <div className="flex flex-col gap-6">
          <section className="flex divide-x rtl:divide-x-reverse divide-line overflow-hidden rounded-xl border border-line bg-card" aria-label={tr("ملخص الفترة")}>
            <Tile value={s.loans} label={tr("إعارات الفترة")} />
            <Tile value={s.returns} label={tr("إرجاعات الفترة")} />
            <Tile value={s.avgLoanDays} label={tr("متوسط مدة الإعارة (يومًا)")} />
            <Tile value={`${s.lateRate}%`} label={tr("نسبة الإرجاع المتأخر")} tone={s.lateRate >= 25 ? 'text-brick' : ''} />
            <Tile value={s.overdueNow} label={tr("متأخرة الآن")} tone={s.overdueNow ? 'text-brick' : ''} />
          </section>

          {anyFines > 0 && (
            <section className="flex divide-x rtl:divide-x-reverse divide-line overflow-hidden rounded-xl border border-line bg-card" aria-label={tr("الغرامات")}>
              <Tile value={s.finesCharged} label={tr("غرامات مفروضة ({0})", [settings.currency])} />
              <Tile value={s.finesCollected} label={tr("غرامات محصّلة ({0})", [settings.currency])} tone="text-moss" />
              <Tile value={s.finesWaived} label={tr("غرامات معفاة ({0})", [settings.currency])} />
            </section>
          )}

          <section className="rounded-xl border border-line bg-card p-6">
            <h2 className="mb-1 font-display text-2xl font-bold">{tr("الإعارات الشهرية")}</h2>
            <p className="mb-3 text-sm text-muted">{tr("آخر 12 شهرًا (لا تتأثر بالفترة المختارة أعلاه)")}</p>
            <MonthlyChart data={r.monthly} />
          </section>

          <div className="grid grid-cols-2 gap-6">
            <RankList title={tr("أكثر الكتب استعارة")} rows={r.topBooks} label={(x) => x.title} sub={(x) => x.author} color={(x) => catColor(x.title)} empty={tr("لا توجد إعارات في هذه الفترة.")} />
            <RankList title={tr("أنشط الأعضاء")} rows={r.topMembers} label={(x) => x.name} color={(x) => catColor(x.name)} empty={tr("لا توجد إعارات في هذه الفترة.")} />
            <RankList title={tr("الإعارات حسب التصنيف")} rows={r.byCategory} label={(x) => catLabel(x.name)} color={(x) => catColor(x.name)} empty={tr("لا توجد إعارات في هذه الفترة.")} />

            <section className="rounded-xl border border-line bg-card p-6">
              <h2 className="mb-1 font-display text-2xl font-bold">{tr("كتب راكدة")}</h2>
              <p className="mb-3 text-sm text-muted">
                {period === 'all' ? tr("كتب لم تُستعر أبدًا") : tr("كتب أقدم من الفترة ولم تُستعر خلالها")}: <span className="font-semibold tabular-nums text-ink">{r.idle.count}</span>
              </p>
              {r.idle.sample.length === 0 ? (
                <Empty title={tr("لا شيء راكد")} hint={tr("كل كتبك المضافة سابقًا استُعيرت في هذه الفترة.")} />
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {r.idle.sample.map((b) => (
                    <li key={b.id} className="py-2">
                      <div className="truncate font-medium">{b.title}</div>
                      <div className="truncate text-xs text-muted">{b.author}</div>
                    </li>
                  ))}
                </ul>
              )}
              {r.idle.count > r.idle.sample.length && <p className="mt-2 text-xs text-muted">{tr("عُرض أقدم {0} فقط.", [r.idle.sample.length])}</p>}
            </section>
          </div>
        </div>
      )}
    </>
  )
}
