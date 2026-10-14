import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LayoutDashboard, BookOpen, Users, ArrowLeftRight, ScanBarcode, ShieldCheck, Library, KeyRound, LogOut, Search, BarChart3, Tv, Sun, Moon, Monitor } from 'lucide-react'
import Dashboard from './pages/Dashboard.jsx'
import Books from './pages/Books.jsx'
import Members from './pages/Members.jsx'
import Loans from './pages/Loans.jsx'
import Desk from './pages/Desk.jsx'
import Admin from './pages/Admin.jsx'
import Reports from './pages/Reports.jsx'
import Kiosk from './Kiosk.jsx'
import { call } from './api.js'
import { useTheme, MODE_LABEL } from './theme.js'
import Login from './Login.jsx'
import ChangePassword from './ChangePassword.jsx'
import CommandPalette from './CommandPalette.jsx'
import { SettingsProvider, useSettings } from './settings.jsx'
import { PrintProvider } from './printing.jsx'
import { useAuth } from './auth.jsx'
import { IconButton } from './ui.jsx'
import { tr, tk } from './i18n.js'

const NAV = [
  { id: 'dashboard', label: tk("نظرة عامة"), icon: LayoutDashboard, Page: Dashboard },
  { id: 'desk', label: tk("مكتب الإعارة"), icon: ScanBarcode, Page: Desk },
  { id: 'books', label: tk("الكتب"), icon: BookOpen, Page: Books },
  { id: 'members', label: tk("الأعضاء"), icon: Users, Page: Members },
  { id: 'loans', label: tk("الإعارات"), icon: ArrowLeftRight, Page: Loans },
  { id: 'reports', label: tk("التقارير"), icon: BarChart3, Page: Reports, adminOnly: true },
  { id: 'admin', label: tk("الإدارة"), icon: ShieldCheck, Page: Admin, adminOnly: true },
]

const ROLE = { admin: tk("مدير"), librarian: tk("أمين مكتبة") }

function Shell({ page, params, go }) {
  const { user, isAdmin, logout } = useAuth()
  const { settings } = useSettings()
  useEffect(() => { document.title = settings.library_name }, [settings.library_name])
  const [pwOpen, setPwOpen] = useState(false)
  const [palette, setPalette] = useState(false)
  const [kiosk, setKiosk] = useState(false)
  const { mode, cycle } = useTheme()
  const ThemeIcon = { light: Sun, dark: Moon, system: Monitor }[mode]

  const enterKiosk = async () => {
    try { await call('app:fullscreen', { on: true }) } catch { /* يعمل دون ملء الشاشة */ }
    setPalette(false)
    setKiosk(true)
  }

  const kioskRef = useRef(false)
  useEffect(() => { kioskRef.current = kiosk }, [kiosk])

  // اختصارات لوحة المفاتيح (بالمفتاح الفعلي code ليعمل مع التخطيط العربي)
  useEffect(() => {
    const onKey = (e) => {
      if (kioskRef.current || !(e.ctrlKey || e.metaKey)) return
      if (e.code === 'KeyK') {
        e.preventDefault()
        setPalette((p) => !p)
      } else if (e.code === 'KeyN') {
        if (document.querySelector('[role="dialog"]')) return
        e.preventDefault()
        window.dispatchEvent(new Event('app:new'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = NAV.filter((n) => !n.adminOnly || isAdmin)
  const Current = (items.find((n) => n.id === page) || items[0]).Page

  return (
    <>
    <div className="flex h-full" inert={kiosk}>
      <aside className="flex w-60 shrink-0 flex-col border-e border-line bg-card px-3 py-5">
        <div className="mb-6 flex items-center gap-3 px-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-teal text-white">
            <Library size={22} />
          </div>
          <div className="font-display text-2xl font-bold leading-tight">{settings.library_name}</div>
        </div>

        <button
          onClick={() => setPalette(true)}
          className="mb-4 flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-muted transition-colors hover:bg-mist"
        >
          <Search size={15} />
          <span className="flex-1 text-start">{tr("بحث وأوامر")}</span>
          <kbd className="rounded border border-line px-1 text-[11px]" dir="ltr">Ctrl K</kbd>
        </button>

        <button
          onClick={enterKiosk}
          className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-mist hover:text-ink"
        >
          <Tv size={15} />{tr("وضع القارئ")}</button>

        <nav className="flex flex-col gap-1">
          {items.map(({ id, label, icon: Icon }) => {
            const active = id === page
            return (
              <button
                key={id}
                onClick={() => go(id)}
                className={`relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? 'text-white' : 'text-ink hover:bg-mist'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-lg bg-teal"
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                  />
                )}
                <Icon size={18} className="relative" />
                <span className="relative">{tr(label)}</span>
              </button>
            )
          })}
        </nav>

        <div className="mt-auto flex items-center gap-2 rounded-lg bg-mist/70 p-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.display_name}</div>
            <div className="text-xs text-muted">{tr(ROLE[user.role])}</div>
          </div>
          <IconButton label={tr("المظهر: {0} (انقر للتبديل)", [tr(MODE_LABEL[mode])])} onClick={cycle}><ThemeIcon size={16} /></IconButton>
          <IconButton label={tr("تغيير كلمة المرور")} onClick={() => setPwOpen(true)}><KeyRound size={16} /></IconButton>
          <IconButton label={tr("تسجيل الخروج")} onClick={logout}><LogOut size={16} /></IconButton>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="mx-auto max-w-6xl px-8 py-8"
          >
            <Current go={go} params={params} />
          </motion.div>
        </AnimatePresence>
      </main>

      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
      <CommandPalette open={palette && !kiosk} onClose={() => setPalette(false)} go={go} isAdmin={isAdmin} />
    </div>
    {kiosk && <Kiosk onExit={() => setKiosk(false)} />}
    </>
  )
}

export default function App() {
  const { phase, lang, user } = useAuth()
  // الصفحة الحالية هنا لا في Shell: تغيير اللغة يعيد بناء Shell ولا يجب أن يطرد المستخدم من صفحته
  const [page, setPage] = useState('dashboard')
  const [params, setParams] = useState(null)
  const go = useCallback((p, prm) => {
    setPage(p)
    setParams(prm ? { ...prm, _t: Date.now() } : null) // _t يضمن إعادة تنفيذ الأثر عند تكرار الأمر نفسه
  }, [])
  // عند تبدّل المستخدم (لا عند تبدّل اللغة) نعود للصفحة الرئيسية
  const lastUser = useRef(null)
  useEffect(() => {
    const id = user?.id ?? null
    if (lastUser.current !== id) { lastUser.current = id; go('dashboard') }
  }, [user?.id, go])

  if (phase === 'loading') return null
  // key={lang}: تغيير اللغة يعيد بناء الواجهة كلها فتُقرأ كل النصوص من جديد
  if (phase !== 'ready') return <Login key={lang} />
  return (
    <SettingsProvider key={lang}>
      <PrintProvider>
        <Shell page={page} params={params} go={go} />
      </PrintProvider>
    </SettingsProvider>
  )
}
