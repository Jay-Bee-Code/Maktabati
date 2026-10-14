import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, ChevronRight, ChevronLeft } from 'lucide-react'
import { tr, isRtl } from './i18n.js'

/* ألوان أجنحة الكتب: لون ثابت لكل تصنيف */
const SPINES = ['#0e5560', '#a97724', '#3b7a4d', '#7a3b4f', '#34506f', '#8a5a2b', '#4b6b5f', '#6a4c93', '#9a4a2f', '#2f6b7a']
export { SPINES }
export function catColor(name = '') {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SPINES[h % SPINES.length]
}

/* ---------- الإشعارات (مع إجراء اختياري مثل «تراجع») ---------- */
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const dismiss = useCallback((id) => setItems((i) => i.filter((x) => x.id !== id)), [])
  const notify = useCallback(
    (text, type = 'ok', action) => {
      const id = Date.now() + Math.random()
      setItems((i) => [...i, { id, text, type, action }])
      setTimeout(() => dismiss(id), action ? 7000 : type === 'err' ? 5000 : 3000)
    },
    [dismiss]
  )
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="fixed bottom-5 end-5 z-[70] flex flex-col gap-2" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className={`flex max-w-sm items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${
                t.type === 'err' ? 'bg-danger' : 'bg-teal-deep'
              }`}
            >
              <span>{t.text}</span>
              {t.action && (
                <button
                  className="shrink-0 cursor-pointer rounded px-1 font-semibold underline underline-offset-4 hover:bg-white/10"
                  onClick={() => {
                    dismiss(t.id)
                    t.action.run()
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- مكوّنات أساسية ---------- */
const variants = {
  primary: 'bg-teal text-white hover:bg-teal-deep',
  outline: 'border border-line bg-card text-ink hover:bg-mist',
  ghost: 'text-ink hover:bg-mist',
  danger: 'bg-danger text-white hover:bg-danger-deep',
}

export function Button({ variant = 'primary', className = '', ...props }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      {...props}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  )
}

export function IconButton({ label, className = '', children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`grid size-8 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-mist hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${className}`}
    >
      {children}
    </button>
  )
}

const tones = {
  ok: 'bg-ok-bg text-moss',
  warn: 'bg-warn-bg text-brass',
  bad: 'bg-bad-bg text-brick',
  mute: 'bg-mist text-muted',
}
export function Badge({ tone = 'mute', children }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

export const inputCls =
  'w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/20'

export function Field({ label, className = '', children }) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium ${className}`}>
      {label}
      {children}
    </label>
  )
}

/* مجموعة حقل لا تستعمل <label> (للقوائم المركّبة مثل Combobox) */
export function FieldGroup({ label, className = '', children }) {
  return (
    <div className={`flex flex-col gap-1.5 text-sm font-medium ${className}`}>
      <span>{label}</span>
      {children}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative w-full max-w-sm">
      <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${inputCls} ps-9`}
      />
    </div>
  )
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-4xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

export function Empty({ title, hint, action }) {
  return (
    <div className="grid place-items-center gap-3 px-6 py-16 text-center">
      <p className="font-display text-2xl font-bold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action}
    </div>
  )
}

/* ---------- حبس التركيز داخل النافذة المنبثقة ---------- */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function useFocusTrap(ref, onClose) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const previous = document.activeElement
    const items = () => [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)

    // التركيز الأولي: أول حقل إدخال، وإلا أول عنصر قابل للتركيز
    const first = node.querySelector('input:not([disabled]),select,textarea') || items()[0] || node
    first.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') {
        // قائمة مفتوحة (Combobox) تغلق نفسها أولًا
        if (e.target?.getAttribute?.('aria-expanded') === 'true') return
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const list = items()
      if (!list.length) return e.preventDefault()
      const a = list[0]
      const z = list[list.length - 1]
      if (e.shiftKey && (document.activeElement === a || document.activeElement === node)) {
        e.preventDefault()
        z.focus()
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault()
        a.focus()
      }
    }
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [ref])
}

function Dialog({ onClose, title, wide, closable = true, children }) {
  const ref = useRef(null)
  const titleId = useId()
  useFocusTrap(ref, onClose)
  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className={`max-h-[90vh] w-full overflow-auto rounded-xl bg-card shadow-2xl outline-none ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
    >
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <h2 id={titleId} className="font-display text-2xl font-bold">{title}</h2>
        {closable && (
          <IconButton label={tr("إغلاق")} onClick={onClose}>
            <X size={18} />
          </IconButton>
        )}
      </div>
      <div className="p-6">{children}</div>
    </motion.div>
  )
}

export function Modal({ open, onClose, title, children, wide = false, z = 'z-50', closable = true }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`fixed inset-0 ${z} grid place-items-center bg-ink/45 p-4`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <Dialog onClose={onClose} title={title} wide={wide} closable={closable}>
            {children}
          </Dialog>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Confirm({ open, title, text, confirmLabel = tr("تأكيد"), danger = true, onYes, onNo }) {
  return (
    <Modal open={open} onClose={onNo} title={title}>
      <p className="text-sm leading-7 text-muted">{text}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onNo}>{tr("إلغاء")}</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onYes}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}

/* ---------- جداول ---------- */
export const Table = ({ children }) => (
  <div className="overflow-hidden rounded-xl border border-line bg-card">
    <table className="w-full text-sm">{children}</table>
  </div>
)
export const Th = ({ children, className = '' }) => (
  <th className={`border-b border-line bg-mist/60 px-4 py-3 text-start text-xs font-semibold text-muted ${className}`}>{children}</th>
)
export const Td = ({ children, className = '' }) => <td className={`border-b border-line/70 px-4 py-3 align-middle ${className}`}>{children}</td>

export function Row({ children }) {
  return (
    <motion.tr
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="transition-colors hover:bg-mist/40"
    >
      {children}
    </motion.tr>
  )
}

/* ---------- تبويبات مقسّمة ---------- */
export function SegTabs({ tabs, value, onChange, layoutId }) {
  return (
    <div className="inline-flex gap-1 rounded-lg bg-mist p-1" role="tablist">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`relative cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${value === id ? 'text-ink' : 'text-muted hover:text-ink'}`}
        >
          {value === id && (
            <motion.span layoutId={layoutId} className="absolute inset-0 rounded-md bg-card shadow-sm" transition={{ type: 'spring', stiffness: 450, damping: 36 }} />
          )}
          <span className="relative">{tr(label)}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------- ترقيم الصفحات ---------- */
export function Pager({ page, pageSize, total, onPage }) {
  if (total <= pageSize) return null
  const pages = Math.ceil(total / pageSize)
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav className="mt-4 flex items-center justify-between text-sm text-muted" aria-label={tr("الصفحات")}>
      <span className="tabular-nums">{tr("{0}–{1} من {2}", [from, to, total])}</span>
      <div className="flex items-center gap-1">
        <IconButton label={tr("الصفحة السابقة")} disabled={page <= 1} onClick={() => onPage(page - 1)}>{isRtl() ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</IconButton>
        <span className="px-2 tabular-nums">{page} / {pages}</span>
        <IconButton label={tr("الصفحة التالية")} disabled={page >= pages} onClick={() => onPage(page + 1)}>{isRtl() ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}</IconButton>
      </div>
    </nav>
  )
}

/* ---------- قائمة قابلة للبحث (Combobox) ---------- */
/**
 * requireQuery: يتجاهل Enter إذا كان الحقل فارغًا (مهم مع الماسح الضوئي كي لا تُختار أول نتيجة بالخطأ).
 * Enter يجلب النتائج فورًا إن لم تكن نتائج الاستعلام الحالي قد وصلت، فلا يسبقه الماسح السريع.
 */
export function Combobox({
  value, onChange, fetcher, getLabel, renderOption, placeholder, ariaLabel,
  emptyText = tr("لا توجد نتائج"), autoFocus = false, disabled = false, requireQuery = false,
}) {
  const listId = useId()
  const [query, setQuery] = useState(value ? getLabel(value) : '')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [active, setActive] = useState(0)
  const seq = useRef(0)
  const loadedFor = useRef(null) // الاستعلام الذي تخصه النتائج المعروضة

  useEffect(() => {
    if (!open) return
    const q = value ? '' : query
    const t = setTimeout(async () => {
      const id = ++seq.current
      try {
        const r = await fetcher(q)
        if (id === seq.current) { setItems(r); setActive(0); loadedFor.current = q }
      } catch { /* يعرض الأب الأخطاء عند الإرسال */ }
    }, 150)
    return () => clearTimeout(t)
  }, [open, query, value, fetcher])

  const choose = (item) => {
    onChange(item)
    setQuery(getLabel(item))
    setOpen(false)
  }

  const pick = async () => {
    const q = value ? '' : query
    if (requireQuery && !q.trim()) return
    let list = items
    let idx = active
    if (loadedFor.current !== q) {
      try {
        const id = ++seq.current
        list = await fetcher(q)
        if (id !== seq.current) return
        setItems(list)
        loadedFor.current = q
        idx = 0
      } catch { return }
    }
    if (list[idx]) choose(list[idx])
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && open) { e.preventDefault(); pick() }
    else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false) }
  }

  return (
    <div>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        className={`${inputCls} disabled:bg-mist disabled:cursor-not-allowed`}
        onChange={(e) => { setQuery(e.target.value); if (value) onChange(null); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className="mt-1 max-h-52 overflow-auto rounded-lg border border-line bg-card shadow-sm">
          {items.length === 0 && <li className="px-3 py-3 text-sm text-muted">{emptyText}</li>}
          {items.map((it, i) => (
            <li
              key={it.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(it) }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-mist' : ''}`}
            >
              {renderOption(it)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------- منتقي مدة الإعارة ---------- */
export function DaysPicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      {[7, 14, 30].map((d) => (
        <button
          type="button"
          key={d}
          aria-pressed={Number(value) === d}
          onClick={() => onChange(d)}
          className={`cursor-pointer rounded-lg border px-3 py-2 text-sm transition-colors ${
            Number(value) === d ? 'border-teal bg-teal text-white' : 'border-line bg-card hover:bg-mist'
          }`}
        >{tr("{0} يومًا", [d])}</button>
      ))}
      <input
        type="number" min="1" max="120" required aria-label={tr("عدد الأيام")}
        value={value} onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} !w-24`}
      />
    </div>
  )
}

/* ---------- درج جانبي للتفاصيل ---------- */
function DrawerPanel({ onClose, title, children }) {
  const dx = isRtl() ? -56 : 56 // الدرج عند نهاية السطر: يسار الشاشة في العربية، ويمينها في الفرنسية
  const ref = useRef(null)
  const titleId = useId()
  useFocusTrap(ref, onClose)
  return (
    <motion.aside
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      initial={{ x: dx, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: dx, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className="absolute inset-y-0 end-0 flex w-full max-w-xl flex-col bg-card shadow-2xl outline-none"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <h2 id={titleId} className="font-display text-2xl font-bold leading-snug">{title}</h2>
        <IconButton label={tr("إغلاق")} onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div className="flex-1 overflow-auto p-6">{children}</div>
    </motion.aside>
  )
}

export function Drawer({ open, onClose, title, children }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 bg-ink/35"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <DrawerPanel onClose={onClose} title={title}>{children}</DrawerPanel>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
