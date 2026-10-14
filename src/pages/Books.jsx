import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Plus, Pencil, Archive, ArchiveRestore, Printer } from 'lucide-react'
import { call } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useDebounced, useList } from '../hooks.js'
import { BookDrawer } from '../drawers.jsx'
import { LabelsDialog } from '../printing.jsx'
import {
  Badge, Button, Empty, Field, IconButton, Modal, PageHeader, Pager, Row, SearchBox, SegTabs,
  Table, Td, Th, catColor, inputCls, useToast,
} from '../ui.jsx'
import { tr } from '../i18n.js'

const PAGE = 25
const blank = { title: '', author: '', isbn: '', category: '', year: '', copies: 1, shelf: '' }

export default function Books({ params }) {
  const { isAdmin } = useAuth()
  const notify = useToast()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [view, setView] = useState('active')
  const [form, setForm] = useState(null)
  const [dup, setDup] = useState(null) // كتاب موجود بنفس ISBN
  const [drawer, setDrawer] = useState(null)
  const [labels, setLabels] = useState(false)

  // قادم من شريط الأوامر
  useEffect(() => {
    if (params?.openBook) setDrawer(params.openBook)
    if (params?.newBook) setForm(blank)
  }, [params])
  // Ctrl+N
  useEffect(() => {
    const h = () => setView('active') || setForm(blank)
    window.addEventListener('app:new', h)
    return () => window.removeEventListener('app:new', h)
  }, [])
  const dq = useDebounced(q)
  const archived = view === 'archived'

  const { rows, total, ready, reload } = useList('books:list', { search: dq, page, pageSize: PAGE, archived }, setPage)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const search = (v) => { setQ(v); setPage(1) }
  const changeView = (v) => { setView(v); setPage(1) }

  const save = async (e) => {
    e.preventDefault()
    try {
      await call('books:save', form)
      notify(form.id ? tr("تم حفظ التعديلات") : tr("تمت إضافة الكتاب"))
      setForm(null)
      reload()
    } catch (err) {
      if (err.code === 'DUP_ISBN') setDup(err.info)
      else notify(err.message, 'err')
    }
  }

  const addCopy = async () => {
    try {
      const r = await call('books:addCopy', dup.id)
      notify(tr("أصبح عدد نسخ «{0}» {1}", [r.title, r.copies]))
      setDup(null)
      setForm(null)
      reload()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const archive = async (b) => {
    try {
      await call('books:archive', b.id)
      reload()
      notify(tr("تمت أرشفة «{0}»", [b.title]), 'ok', {
        label: tr("تراجع"),
        run: async () => {
          try { await call('books:restore', b.id); reload() } catch (e) { notify(e.message, 'err') }
        },
      })
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const restore = async (b) => {
    try {
      await call('books:restore', b.id)
      notify(tr("تم استرجاع «{0}»", [b.title]))
      reload()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  return (
    <>
      <PageHeader
        title={tr("الكتب")}
        subtitle={archived ? tr("{0} مؤرشف", [total]) : tr("{0} عنوان", [total])}
        action={!archived && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLabels(true)}><Printer size={16} />{tr("ملصقات الباركود")}</Button>
            <Button onClick={() => setForm(blank)}><Plus size={16} />{tr("إضافة كتاب")}</Button>
          </div>
        )}
      />
      <div className="mb-4 flex items-center justify-between gap-4">
        <SearchBox value={q} onChange={search} placeholder={tr("ابحث بالعنوان أو المؤلف أو ISBN أو التصنيف")} />
        {isAdmin && <SegTabs layoutId="books-view" value={view} onChange={changeView} tabs={[['active', tr("النشطة")], ['archived', tr("المؤرشفة")]]} />}
      </div>

      {ready && rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-card">
          <Empty
            title={q ? tr("لا توجد نتائج") : archived ? tr("لا توجد كتب مؤرشفة") : tr("لا توجد كتب بعد")}
            hint={q ? tr("جرّب كلمة بحث أخرى.") : archived ? tr("الكتب المؤرشفة تُخفى من القوائم وتبقى في السجل، ويمكن استرجاعها.") : tr("ابدأ بإضافة أول كتاب إلى المكتبة.")}
            action={q ? <Button variant="outline" onClick={() => search('')}>{tr("مسح البحث")}</Button> : !archived && <Button onClick={() => setForm(blank)}><Plus size={16} />{tr("إضافة كتاب")}</Button>}
          />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{tr("الكتاب")}</Th><Th>{tr("التصنيف")}</Th><Th>{tr("الرفّ")}</Th><Th>{archived ? tr("النسخ") : tr("المتاح")}</Th><Th className="w-24"><span className="sr-only">{tr("إجراءات")}</span></Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {rows.map((b) => (
                <Row key={b.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: catColor(b.category || 'غير مصنّف' /* i18n-ignore: مفتاح لون لا نص معروض */) }} />
                      <div className="min-w-0">
                        <button type="button" onClick={() => setDrawer(b.id)} className="block max-w-full cursor-pointer truncate text-start font-medium hover:text-accent hover:underline">{b.title}</button>
                        <div className="truncate text-xs text-muted">
                          {b.author}{b.year ? ` · ${b.year}` : ''}{b.isbn ? <> · <span dir="ltr">{b.isbn}</span></> : null}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-muted">{b.category || '—'}</Td>
                  <Td className="text-muted">{b.shelf || '—'}</Td>
                  <Td>
                    {archived ? (
                      <Badge><span className="tabular-nums">{b.copies}</span></Badge>
                    ) : (
                      <Badge tone={b.available <= 0 ? 'bad' : b.available === 1 ? 'warn' : 'ok'}>
                        <span className="tabular-nums">{b.available} / {b.copies}</span>
                      </Badge>
                    )}
                    {!archived && b.reservations > 0 && <span className="ms-2 text-xs text-muted">{tr("حجوزات {0}", [b.reservations])}</span>}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {archived ? (
                        <Button variant="outline" onClick={() => restore(b)} className="!px-3 !py-1.5"><ArchiveRestore size={15} />{tr("استرجاع")}</Button>
                      ) : (
                        <>
                          <IconButton label={tr("تعديل")} onClick={() => setForm(b)}><Pencil size={16} /></IconButton>
                          {isAdmin && <IconButton label={tr("أرشفة")} onClick={() => archive(b)} className="hover:!text-brick"><Archive size={16} /></IconButton>}
                        </>
                      )}
                    </div>
                  </Td>
                </Row>
              ))}
            </AnimatePresence>
          </tbody>
        </Table>
      )}
      <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} />

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? tr("تعديل الكتاب") : tr("إضافة كتاب")} wide>
        {form && (
          <form onSubmit={save} className="grid grid-cols-2 gap-4">
            <Field label={tr("العنوان")} className="col-span-2"><input required value={form.title} onChange={set('title')} className={inputCls} /></Field>
            <Field label={tr("المؤلف")}><input required value={form.author} onChange={set('author')} className={inputCls} /></Field>
            <Field label={tr("ISBN (10 أو 13 خانة)")}><input value={form.isbn || ''} onChange={set('isbn')} dir="ltr" placeholder="978-0-306-40615-7" className={`${inputCls} text-end`} /></Field>
            <Field label={tr("التصنيف")}><input value={form.category || ''} onChange={set('category')} placeholder={tr("مثل: رواية، علوم، تاريخ")} className={inputCls} /></Field>
            <Field label={tr("الرفّ")}><input value={form.shelf || ''} onChange={set('shelf')} placeholder={tr("مثل: A-12")} className={inputCls} /></Field>
            <Field label={tr("سنة النشر")}><input type="number" value={form.year ?? ''} onChange={set('year')} className={inputCls} /></Field>
            {!form.id ? <Field label={tr("عدد النسخ")}><input type="number" min="0" max="1000" required value={form.copies} onChange={set('copies')} className={inputCls} /></Field> : <p className="self-end pb-2 text-xs text-muted">{tr("تُدار النسخ وحالتها من صفحة الكتاب (انقر على العنوان).")}</p>}
            <div className="col-span-2 mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setForm(null)}>{tr("إلغاء")}</Button>
              <Button type="submit">{tr("حفظ")}</Button>
            </div>
          </form>
        )}
      </Modal>

      <LabelsDialog open={labels} onClose={() => setLabels(false)} scope={{ kind: 'pending' }} />
      <BookDrawer id={drawer} onClose={() => setDrawer(null)} onChanged={reload} />

      <Modal open={!!dup} onClose={() => setDup(null)} title={tr("هذا الكتاب مسجَّل بالفعل")}>
        {dup && (
          <>
            <p className="text-sm leading-7 text-muted">{tr("رقم ISBN هذا يخص «")}<span className="font-medium text-ink">{dup.title}</span>{tr("» للمؤلف {0}، وله {1} نسخة.{2}", [dup.author, dup.copies, form && !form.id ? tr(" هل هذه نسخة إضافية منه؟") : tr(" عدّل الرقم ثم احفظ من جديد.")])}</p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDup(null)}>{tr("تعديل ISBN")}</Button>
              {form && !form.id && <Button onClick={addCopy}>{tr("إضافة نسخة إلى «{0}»", [dup.title])}</Button>}
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
