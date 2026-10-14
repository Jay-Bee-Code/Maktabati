import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Plus, Pencil, KeyRound, UserX, UserCheck, DatabaseBackup, FolderOpen, Download, Upload, RotateCcw } from 'lucide-react'
import { call } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useSettings } from '../settings.jsx'
import { useDebounced, useList } from '../hooks.js'
import { RecoveryCodePanel } from '../RecoveryCode.jsx'
import { LOCALES } from '../i18n.js'
import {
  Badge, Button, Confirm, Empty, Field, IconButton, Modal, PageHeader, Pager, Row, SearchBox, SegTabs, Table, Td, Th, inputCls, useToast,
} from '../ui.jsx'
import { tr, tk } from '../i18n.js'

const ROLE = { admin: tk("مدير"), librarian: tk("أمين مكتبة") }

/* ======================= المستخدمون ======================= */
function Users() {
  const { user: me } = useAuth()
  const notify = useToast()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)
  const [reset, setReset] = useState(null)

  const load = useCallback(async () => {
    try { setRows(await call('users:list')) } catch (e) { notify(e.message, 'err') }
  }, [notify])
  useEffect(() => { load() }, [load])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    try {
      await call('users:save', { ...form, active: form.active ?? 1 })
      notify(form.id ? tr("تم حفظ التعديلات") : tr("تمت إضافة المستخدم"))
      setForm(null)
      load()
    } catch (err) { notify(err.message, 'err') }
  }

  const toggle = async (u) => {
    try {
      await call('users:save', { id: u.id, display_name: u.display_name, role: u.role, active: u.active ? 0 : 1 })
      notify(u.active ? tr("تم إيقاف حساب {0}", [u.display_name]) : tr("تم تفعيل حساب {0}", [u.display_name]))
      load()
    } catch (err) { notify(err.message, 'err') }
  }

  const doReset = async (e) => {
    e.preventDefault()
    try {
      await call('users:resetPassword', { id: reset.id, password: reset.password })
      notify(tr("تم تعيين كلمة المرور الجديدة"))
      setReset(null)
    } catch (err) { notify(err.message, 'err') }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">{tr("المدير يدير كل شيء. أمين المكتبة يسجّل الإعارات ويعدّل الكتب والأعضاء، ولا يؤرشف ولا يدير النسخ الاحتياطية.")}</p>
        <Button onClick={() => setForm({ username: '', display_name: '', role: 'librarian', password: '' })}><Plus size={16} />{tr("إضافة مستخدم")}</Button>
      </div>
      <Table>
        <thead>
          <tr><Th>{tr("الاسم")}</Th><Th>{tr("اسم المستخدم")}</Th><Th>{tr("الصلاحية")}</Th><Th>{tr("الحالة")}</Th><Th className="w-32"><span className="sr-only">{tr("إجراءات")}</span></Th></tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {rows.map((u) => (
              <Row key={u.id}>
                <Td className="font-medium">{u.display_name}{u.id === me.id && <span className="ms-2 text-xs text-muted">{tr("(أنت)")}</span>}</Td>
                <Td className="text-muted"><span dir="ltr">{u.username}</span></Td>
                <Td><Badge tone={u.role === 'admin' ? 'warn' : 'mute'}>{tr(ROLE[u.role])}</Badge></Td>
                <Td><Badge tone={u.active ? 'ok' : 'bad'}>{u.active ? tr("نشط") : tr("موقوف")}</Badge></Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <IconButton label={tr("تعديل")} onClick={() => setForm(u)}><Pencil size={16} /></IconButton>
                    <IconButton label={tr("تعيين كلمة مرور جديدة")} onClick={() => setReset({ id: u.id, name: u.display_name, password: '' })}><KeyRound size={16} /></IconButton>
                    <IconButton label={u.active ? tr("إيقاف الحساب") : tr("تفعيل الحساب")} disabled={u.id === me.id} onClick={() => toggle(u)}>
                      {u.active ? <UserX size={16} /> : <UserCheck size={16} />}
                    </IconButton>
                  </div>
                </Td>
              </Row>
            ))}
          </AnimatePresence>
        </tbody>
      </Table>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? tr("تعديل المستخدم") : tr("إضافة مستخدم")}>
        {form && (
          <form onSubmit={save} className="flex flex-col gap-4">
            <Field label={tr("الاسم الكامل")}><input required value={form.display_name} onChange={set('display_name')} className={inputCls} /></Field>
            <Field label={tr("اسم المستخدم")}>
              <input required disabled={!!form.id} value={form.username} onChange={set('username')} dir="ltr" className={`${inputCls} text-end disabled:bg-mist`} />
            </Field>
            <Field label={tr("الصلاحية")}>
              <select value={form.role} disabled={form.id === me.id} onChange={set('role')} className={inputCls}>
                <option value="librarian">{tr("أمين مكتبة")}</option>
                <option value="admin">{tr("مدير")}</option>
              </select>
            </Field>
            {!form.id && (
              <Field label={tr("كلمة المرور (8 أحرف على الأقل)")}>
                <input type="password" required minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" dir="ltr" className={`${inputCls} text-end`} />
              </Field>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setForm(null)}>{tr("إلغاء")}</Button>
              <Button type="submit">{tr("حفظ")}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!reset} onClose={() => setReset(null)} title={tr("تعيين كلمة مرور جديدة")}>
        {reset && (
          <form onSubmit={doReset} className="flex flex-col gap-4">
            <p className="text-sm text-muted">{tr("كلمة مرور جديدة للمستخدم «{0}». أبلغه بها ليغيّرها بعد الدخول.", [reset.name])}</p>
            <Field label={tr("كلمة المرور الجديدة (8 أحرف على الأقل)")}>
              <input type="password" required minLength={8} value={reset.password} onChange={(e) => setReset((r) => ({ ...r, password: e.target.value }))} autoComplete="new-password" dir="ltr" className={`${inputCls} text-end`} />
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setReset(null)}>{tr("إلغاء")}</Button>
              <Button type="submit">{tr("تعيين")}</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}

/* ======================= النسخ الاحتياطي ======================= */
const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const fmtTime = (ms) => new Date(ms).toLocaleString('sv-SE').slice(0, 16)

function Backups() {
  const notify = useToast()
  const [data, setData] = useState({ dir: '', items: [] })
  const [ready, setReady] = useState(false)
  const [confirm, setConfirm] = useState(null) // { name } | { file: true }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setData(await call('backup:list')) } catch (e) { notify(e.message, 'err') } finally { setReady(true) }
  }, [notify])
  useEffect(() => { load() }, [load])

  const run = async (fn) => {
    setBusy(true)
    try { await fn() } catch (e) { notify(e.message, 'err') } finally { setBusy(false) }
  }

  const create = () => run(async () => { await call('backup:create'); notify(tr("تم إنشاء نسخة احتياطية")); load() })
  const exportCopy = () => run(async () => {
    const r = await call('backup:export')
    if (!r.canceled) notify(tr("تم حفظ النسخة في المكان الذي اخترته"))
  })

  const doRestore = () => run(async () => {
    const target = confirm
    setConfirm(null)
    const r = target.file ? await call('backup:restoreFile') : await call('backup:restore', { name: target.name })
    if (r.canceled) return
    notify(tr("تم الاسترجاع. سيُعاد تحميل التطبيق."))
    setTimeout(() => window.location.reload(), 900)
  })

  return (
    <>
      <p className="mb-4 max-w-2xl text-sm leading-7 text-muted">{tr("تُنشأ نسخة تلقائية كل يوم عند فتح التطبيق وعند إغلاقه، ويُحتفظ بآخر 14 نسخة. قبل أي استرجاع تُحفظ نسخة أمان من بياناتك الحالية.")}</p>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={create} disabled={busy}><DatabaseBackup size={16} />{tr("إنشاء نسخة الآن")}</Button>
        <Button variant="outline" onClick={exportCopy} disabled={busy}><Download size={16} />{tr("حفظ نسخة في مكان آخر")}</Button>
        <Button variant="outline" onClick={() => setConfirm({ file: true })} disabled={busy}><Upload size={16} />{tr("استرجاع من ملف")}</Button>
        <Button variant="ghost" onClick={() => call('backup:openFolder')}><FolderOpen size={16} />{tr("فتح المجلد")}</Button>
      </div>

      {ready && data.items.length === 0 ? (
        <div className="rounded-xl border border-line bg-card"><Empty title={tr("لا توجد نسخ احتياطية بعد")} hint={tr("أنشئ أول نسخة بزر «إنشاء نسخة الآن».")} /></div>
      ) : (
        <Table>
          <thead><tr><Th>{tr("الملف")}</Th><Th>{tr("النوع")}</Th><Th>{tr("التاريخ")}</Th><Th>{tr("الحجم")}</Th><Th className="w-28"><span className="sr-only">{tr("إجراءات")}</span></Th></tr></thead>
          <tbody>
            {data.items.map((b) => (
              <tr key={b.name} className="hover:bg-mist/40">
                <Td className="text-muted"><span dir="ltr">{b.name}</span></Td>
                <Td><Badge tone={b.code === 'auto' ? 'ok' : 'mute'}>{b.kind}</Badge></Td>
                <Td className="tabular-nums text-muted">{fmtTime(b.mtime)}</Td>
                <Td className="tabular-nums text-muted">{fmtSize(b.size)}</Td>
                <Td>
                  <div className="flex justify-end">
                    <Button variant="outline" onClick={() => setConfirm({ name: b.name })} disabled={busy} className="!px-3 !py-1.5"><RotateCcw size={15} />{tr("استرجاع")}</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Confirm
        open={!!confirm}
        title={tr("استرجاع نسخة احتياطية")}
        text={tr("ستُستبدل بيانات المكتبة الحالية بمحتوى النسخة المختارة، بما في ذلك المستخدمون وكلمات مرورهم. تُحفظ نسخة أمان من بياناتك الحالية أولًا، ثم ستحتاج لتسجيل الدخول من جديد.")}
        confirmLabel={tr("استرجاع")}
        onYes={doRestore}
        onNo={() => setConfirm(null)}
      />
    </>
  )
}


/* ======================= الإعدادات ======================= */
function SettingsTab() {
  const notify = useToast()
  const { settings, reload } = useSettings()
  const [f, setF] = useState(settings)
  useEffect(() => setF(settings), [settings])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    try {
      const nums = ['default_loan_days', 'max_loans', 'max_renewals', 'fine_per_day', 'fine_cap', 'fine_block_limit', 'hold_days']
      await call('settings:save', Object.fromEntries(Object.entries(f).map(([k, v]) => [k, nums.includes(k) ? Number(v) : v])))
      await reload()
      notify(tr("تم حفظ الإعدادات"))
    } catch (err) { notify(err.message, 'err') }
  }

  return (
    <form onSubmit={save} className="flex max-w-2xl flex-col gap-6 rounded-xl border border-line bg-card p-6">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-display text-xl font-bold">{tr("الإعارة")}</legend>
        <Field label={tr("اسم المكتبة")}><input required maxLength={60} value={f.library_name} onChange={set('library_name')} className={inputCls} /></Field>
        <Field label={tr("لغة المكتبة (الواجهة والرسائل والطباعة والتصدير)")}>
          <select value={f.language} onChange={set('language')} className={inputCls}>
            {LOCALES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label={tr("مدة الإعارة (أيام)")}><input type="number" min="1" max="120" required value={f.default_loan_days} onChange={set('default_loan_days')} className={inputCls} /></Field>
          <Field label={tr("أقصى كتب للعضو")}><input type="number" min="1" max="50" required value={f.max_loans} onChange={set('max_loans')} className={inputCls} /></Field>
          <Field label={tr("مرات التمديد (0 = معطّل)")}><input type="number" min="0" max="10" required value={f.max_renewals} onChange={set('max_renewals')} className={inputCls} /></Field>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-display text-xl font-bold">{tr("الغرامات والحجز")}</legend>
        <div className="grid grid-cols-3 gap-4">
          <Field label={tr("الغرامة لكل يوم تأخير (0 = بلا غرامات)")}><input type="number" min="0" required value={f.fine_per_day} onChange={set('fine_per_day')} className={inputCls} /></Field>
          <Field label={tr("سقف الغرامة الواحدة (0 = بلا سقف)")}><input type="number" min="0" required value={f.fine_cap} onChange={set('fine_cap')} className={inputCls} /></Field>
          <Field label={tr("منع الإعارة عند غرامات ≥ (0 = لا يمنع)")}><input type="number" min="0" required value={f.fine_block_limit} onChange={set('fine_block_limit')} className={inputCls} /></Field>
          <Field label={tr("رمز العملة")}><input required maxLength={10} value={f.currency} onChange={set('currency')} className={inputCls} /></Field>
          <Field label={tr("مدة الاحتفاظ بالحجز (أيام)")}><input type="number" min="1" max="30" required value={f.hold_days} onChange={set('hold_days')} className={inputCls} /></Field>
        </div>
      </fieldset>
      <p className="text-xs leading-6 text-muted">{tr("تسري التغييرات على العمليات الجديدة فقط، ولا تغيّر مواعيد الإعارات الجارية أو الغرامات المسجَّلة.")}</p>
      <div className="flex justify-end"><Button type="submit">{tr("حفظ الإعدادات")}</Button></div>
    </form>
  )
}

/* ======================= البيانات: استيراد وتصدير ======================= */
const KIND_AR = { books: tk("الكتب"), members: tk("الأعضاء"), loans: tk("الإعارات") }
const STATUS_TONE = { new: ['ok', tk("جديد")], duplicate: ['warn', tk("مكرر")], invalid: ['bad', tk("خطأ")] }

function DataTab() {
  const notify = useToast()
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [mode, setMode] = useState('skip')

  const run = async (fn) => {
    setBusy(true)
    try { await fn() } catch (e) { notify(e.message, 'err') } finally { setBusy(false) }
  }

  const exportKind = (kind) => run(async () => {
    const r = await call('excel:export', { kind })
    if (!r.canceled) notify(tr("تم تصدير {0} سجلًا من {1}", [r.count, tr(KIND_AR[kind])]))
  })
  const template = (kind) => run(async () => {
    const r = await call('excel:template', { kind })
    if (!r.canceled) notify(tr("تم حفظ القالب"))
  })
  const pick = (kind) => run(async () => {
    const r = await call('excel:pickImport', { kind })
    if (!r.canceled) { setMode('skip'); setPreview(r) }
  })
  const commit = () => run(async () => {
    const r = await call('excel:commitImport', { mode })
    const parts = [tr("أُضيف {0}", [r.created])]
    if (r.copiesAdded) parts.push(tr("{0} نسخة لكتب موجودة", [r.copiesAdded]))
    if (r.skipped) parts.push(tr("تُجوهل {0} مكرر", [r.skipped]))
    if (r.invalid) parts.push(tr("{0} صفًا به خطأ", [r.invalid]))
    notify(parts.join(' · '))
    setPreview(null)
  })

  const btn = (label, onClick, Icon = Download) => (
    <Button variant="outline" onClick={onClick} disabled={busy} className="justify-start"><Icon size={16} />{label}</Button>
  )
  const toImport = preview && (preview.counts.new + (preview.kind === 'books' && mode === 'copies' ? preview.counts.duplicate : 0))

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <section className="rounded-xl border border-line bg-card p-5">
          <h3 className="mb-1 font-display text-xl font-bold">{tr("تصدير إلى Excel")}</h3>
          <p className="mb-3 text-xs text-muted">{tr("ملفات xlsx بعناوين عربية.")}</p>
          <div className="flex flex-col gap-2">
            {btn(tr("تصدير الكتب"), () => exportKind('books'))}
            {btn(tr("تصدير الأعضاء"), () => exportKind('members'))}
            {btn(tr("تصدير سجل الإعارات"), () => exportKind('loans'))}
          </div>
        </section>
        <section className="rounded-xl border border-line bg-card p-5">
          <h3 className="mb-1 font-display text-xl font-bold">{tr("قوالب الاستيراد")}</h3>
          <p className="mb-3 text-xs text-muted">{tr("ملف جاهز بالأعمدة الصحيحة ومثال.")}</p>
          <div className="flex flex-col gap-2">
            {btn(tr("قالب الكتب"), () => template('books'))}
            {btn(tr("قالب الأعضاء"), () => template('members'))}
          </div>
        </section>
        <section className="rounded-xl border border-line bg-card p-5">
          <h3 className="mb-1 font-display text-xl font-bold">{tr("استيراد")}</h3>
          <p className="mb-3 text-xs text-muted">{tr("xlsx أو csv. تُعرض معاينة قبل أي إدخال.")}</p>
          <div className="flex flex-col gap-2">
            {btn(tr("استيراد كتب"), () => pick('books'), Upload)}
            {btn(tr("استيراد أعضاء"), () => pick('members'), Upload)}
          </div>
        </section>
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? tr("معاينة استيراد {0}", [tr(KIND_AR[preview.kind])]) : ''} wide>
        {preview && (
          <>
            <p className="mb-3 text-sm text-muted">{tr("الملف:")}{' '}<span dir="ltr">{preview.file}</span>{' '}{tr("· {0} صفًا", [preview.total])}</p>
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone="ok">{tr("جديد {0}", [preview.counts.new])}</Badge>
              <Badge tone="warn">{tr("مكرر {0}", [preview.counts.duplicate])}</Badge>
              <Badge tone="bad">{tr("أخطاء {0}", [preview.counts.invalid])}</Badge>
            </div>
            {preview.kind === 'books' && preview.counts.duplicate > 0 && (
              <fieldset className="mb-4 flex flex-col gap-2 text-sm">
                <legend className="mb-1 font-medium">{tr("الكتب المكررة (ISBN موجود)")}</legend>
                <label className="flex items-center gap-2"><input type="radio" name="dup-mode" checked={mode === 'skip'} onChange={() => setMode('skip')} />{tr("تجاهلها")}</label>
                <label className="flex items-center gap-2"><input type="radio" name="dup-mode" checked={mode === 'copies'} onChange={() => setMode('copies')} />{tr("إضافة نسخها كنسخ جديدة للكتاب الموجود")}</label>
              </fieldset>
            )}
            <div className="max-h-64 overflow-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead><tr className="bg-mist/60 text-xs text-muted"><th className="px-3 py-2 text-start">{tr("الصف")}</th><th className="px-3 py-2 text-start">{preview.kind === 'books' ? tr("الكتاب") : tr("العضو")}</th><th className="px-3 py-2 text-start">{tr("الحالة")}</th></tr></thead>
                <tbody>
                  {preview.items.map((it) => (
                    <tr key={it.row} className="border-t border-line/70">
                      <td className="px-3 py-2 tabular-nums text-muted">{it.row}</td>
                      <td className="px-3 py-2">{it.error ? <span className="text-brick">{it.error}</span> : (it.data.title || it.data.name)}</td>
                      <td className="px-3 py-2"><Badge tone={STATUS_TONE[it.status][0]}>{tr(STATUS_TONE[it.status][1])}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.total > preview.items.length && <p className="mt-2 text-xs text-muted">{tr("عُرض أول {0} صفًا (المشاكل أولًا).", [preview.items.length])}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPreview(null)}>{tr("إلغاء")}</Button>
              <Button onClick={commit} disabled={busy || toImport === 0}>{tr("استيراد {0} سجلًا", [toImport])}</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}


/* ======================= سجل العمليات ======================= */
const AUDIT_PAGE = 50

function AuditTab() {
  const notify = useToast()
  const [q, setQ] = useState('')
  const [user, setUser] = useState('')
  const [page, setPage] = useState(1)
  const [users, setUsers] = useState([])
  const dq = useDebounced(q)
  const { rows, total, ready } = useList('audit:list', { search: dq, username: user, page, pageSize: AUDIT_PAGE }, setPage)

  useEffect(() => {
    call('audit:users').then(setUsers).catch((e) => notify(e.message, 'err'))
  }, [notify])

  return (
    <>
      <p className="mb-4 max-w-2xl text-sm leading-7 text-muted">{tr("يسجَّل هنا من فعل ماذا ومتى. السجل للإلحاق فقط داخل التطبيق: لا يمكن تعديله أو حذفه منه. لا تُسجَّل كلمات المرور ولا رموز الاسترداد.")}</p>
      <div className="mb-4 flex items-center justify-between gap-4">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder={tr("ابحث في السجل")} />
        <select aria-label={tr("المستخدم")} value={user} onChange={(e) => { setUser(e.target.value); setPage(1) }} className={`${inputCls} !w-52`}>
          <option value="">{tr("كل المستخدمين")}</option>
          {users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {ready && rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-card"><Empty title={tr("لا توجد سجلات")} hint={q || user ? tr("جرّب تغيير البحث أو المستخدم.") : tr("ستظهر هنا العمليات فور حدوثها.")} /></div>
      ) : (
        <Table>
          <thead><tr><Th className="w-44">{tr("الوقت")}</Th><Th className="w-40">{tr("المستخدم")}</Th><Th>{tr("العملية")}</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-mist/40">
                <Td className="tabular-nums text-muted">{r.at.slice(0, 16)}</Td>
                <Td>{r.username ? <span dir="ltr">{r.username}</span> : <Badge tone="mute">{tr("غير مسجَّل الدخول")}</Badge>}</Td>
                <Td className={r.action.endsWith(':failed') ? 'text-brick' : ''}>{r.summary}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pager page={page} pageSize={AUDIT_PAGE} total={total} onPage={setPage} />
    </>
  )
}

/* ======================= الأمان: رمز الاسترداد ======================= */
function SecurityTab() {
  const notify = useToast()
  const [info, setInfo] = useState(null)
  const [ask, setAsk] = useState(false)
  const [pw, setPw] = useState('')
  const [code, setCode] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setInfo(await call('auth:recoveryInfo')) } catch (e) { notify(e.message, 'err') }
  }, [notify])
  useEffect(() => { load() }, [load])

  const generate = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await call('auth:newRecoveryCode', { password: pw })
      setAsk(false)
      setPw('')
      setCode(r.recoveryCode)
    } catch (err) {
      notify(err.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="max-w-xl rounded-xl border border-line bg-card p-6">
        <h2 className="mb-1 font-display text-2xl font-bold">{tr("رمز الاسترداد")}</h2>
        <p className="mb-4 text-sm leading-7 text-muted">{tr("يتيح لك إعادة تعيين كلمة مرور المدير من شاشة الدخول («نسيت كلمة المرور؟») إن فقدتها. بدونه، ضياع كلمة مرور المدير الوحيد يعني فقدان الوصول إلى البيانات.")}</p>
        {info && (
          info.exists ? (
            <p className="mb-4 text-sm">{tr("آخر إنشاء للرمز:")}{' '}<span className="font-semibold tabular-nums">{info.created_at}</span></p>
          ) : (
            <p role="alert" className="mb-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-brass">{tr("لم يُنشأ رمز استرداد بعد (حسابك أُنشئ قبل هذه الميزة). أنشئ واحدًا الآن واحفظه.")}</p>
          )
        )}
        <Button onClick={() => setAsk(true)}>{info?.exists ? tr("إنشاء رمز جديد (يبطل القديم)") : tr("إنشاء رمز استرداد")}</Button>
      </section>

      <Modal open={ask} onClose={() => setAsk(false)} title={tr("تأكيد كلمة المرور")}>
        <form onSubmit={generate} className="flex flex-col gap-4">
          <p className="text-sm text-muted">{tr("أدخل كلمة مرورك لإنشاء رمز جديد. سيبطل الرمز السابق فورًا.")}</p>
          <Field label={tr("كلمة المرور الحالية")}>
            <input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" dir="ltr" className={`${inputCls} text-end`} />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAsk(false)}>{tr("إلغاء")}</Button>
            <Button type="submit" disabled={busy}>{tr("إنشاء")}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!code} onClose={() => {}} closable={false} title={tr("رمز الاسترداد الجديد")}>
        {code && (
          <RecoveryCodePanel
            code={code}
            intro={tr("هذا رمزك الجديد، والرمز السابق لم يعد صالحًا.")}
            doneLabel={tr("تم")}
            onDone={() => { setCode(null); load() }}
          />
        )}
      </Modal>
    </>
  )
}

export default function Admin() {
  const [tab, setTab] = useState('users')
  return (
    <>
      <PageHeader title={tr("الإدارة")} subtitle={tr("المستخدمون والإعدادات والبيانات والنسخ والسجل والأمان")} />
      <div className="mb-5">
        <SegTabs layoutId="admin-tab" value={tab} onChange={setTab} tabs={[['users', tr("المستخدمون")], ['settings', tr("الإعدادات")], ['data', tr("البيانات")], ['backups', tr("النسخ الاحتياطي")], ['audit', tr("سجل العمليات")], ['security', tr("الأمان")]]} />
      </div>
      {tab === 'users' ? <Users /> : tab === 'settings' ? <SettingsTab /> : tab === 'data' ? <DataTab /> : tab === 'audit' ? <AuditTab /> : tab === 'security' ? <SecurityTab /> : <Backups />}
    </>
  )
}
