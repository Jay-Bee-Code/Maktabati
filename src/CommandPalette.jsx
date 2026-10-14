import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search } from 'lucide-react'
import { call } from './api.js'
import { useFocusTrap } from './ui.jsx'
import { norm } from './text.js'
import { tr } from './i18n.js'

function Palette({ onClose, go, isAdmin }) {
  const ref = useRef(null)
  const listId = useId()
  const [q, setQ] = useState('')
  const [remote, setRemote] = useState({ books: [], members: [] })
  const [active, setActive] = useState(0)
  useFocusTrap(ref, onClose)

  const commands = useMemo(
    () => [
      { id: 'p-dashboard', group: tr("انتقال"), label: tr("نظرة عامة"), run: () => go('dashboard') },
      { id: 'p-desk', group: tr("انتقال"), label: tr("مكتب الإعارة"), run: () => go('desk') },
      { id: 'p-books', group: tr("انتقال"), label: tr("الكتب"), run: () => go('books') },
      { id: 'p-members', group: tr("انتقال"), label: tr("الأعضاء"), run: () => go('members') },
      { id: 'p-loans', group: tr("انتقال"), label: tr("سجل الإعارات"), run: () => go('loans') },
      ...(isAdmin ? [{ id: 'p-admin', group: tr("انتقال"), label: tr("الإدارة"), run: () => go('admin') }] : []),
      { id: 'a-book', group: tr("إجراء"), label: tr("إضافة كتاب جديد"), run: () => go('books', { newBook: true }) },
      { id: 'a-member', group: tr("إجراء"), label: tr("إضافة عضو جديد"), run: () => go('members', { newMember: true }) },
      { id: 'a-loan', group: tr("إجراء"), label: tr("إعارة كتاب"), run: () => go('desk') },
    ],
    [go, isAdmin]
  )

  useEffect(() => {
    if (q.trim().length < 2) { setRemote({ books: [], members: [] }); return }
    let live = true
    const t = setTimeout(async () => {
      try { const r = await call('search:all', q); if (live) setRemote(r) } catch { /* تجاهل */ }
    }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  const results = useMemo(() => {
    const n = norm(q)
    const cmds = commands.filter((c) => !n || norm(c.label).includes(n))
    return [
      ...cmds,
      ...remote.books.map((b) => ({ id: `b${b.id}`, group: tr("كتب"), label: b.title, hint: tr("{0} · {1} متاحة", [b.author, b.available]), run: () => go('books', { openBook: b.id }) })),
      ...remote.members.map((m) => ({ id: `m${m.id}`, group: tr("أعضاء"), label: m.name, hint: m.card_no, run: () => go('members', { openMember: m.id }) })),
    ]
  }, [q, commands, remote, go])

  useEffect(() => setActive(0), [q])

  const run = (item) => { onClose(); item?.run() }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={tr("بحث وأوامر")}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="w-full max-w-xl overflow-hidden rounded-xl bg-card shadow-2xl outline-none"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={18} className="text-muted" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-label={tr("ابحث عن كتاب أو عضو أو أمر")}
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={tr("ابحث عن كتاب أو عضو، أو اكتب أمرًا…")}
          className="w-full bg-transparent py-4 text-base outline-none placeholder:text-muted"
        />
        <kbd className="rounded border border-line px-1.5 py-0.5 text-xs text-muted">Esc</kbd>
      </div>
      <ul id={listId} role="listbox" className="max-h-96 overflow-auto p-2">
        {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{tr("لا توجد نتائج")}</li>}
        {results.map((r, i) => (
          <li key={r.id} role="presentation">
            {(i === 0 || results[i - 1].group !== r.group) && <div className="px-3 pb-1 pt-3 text-xs font-semibold text-muted">{r.group}</div>}
            <div
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); run(r) }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? 'bg-mist' : ''}`}
            >
              <span className="truncate font-medium">{r.label}</span>
              {r.hint && <span className="shrink-0 text-xs text-muted">{r.hint}</span>}
            </div>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

export default function CommandPalette({ open, onClose, go, isAdmin }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/45 px-4 pt-24"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <Palette onClose={onClose} go={go} isAdmin={isAdmin} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
