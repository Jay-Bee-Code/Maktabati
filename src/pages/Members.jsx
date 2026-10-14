import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Plus, Pencil, Archive, ArchiveRestore, Printer } from 'lucide-react'
import { call } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useDebounced, useList } from '../hooks.js'
import { MemberDrawer } from '../drawers.jsx'
import { CardsDialog } from '../printing.jsx'
import {
  Badge, Button, Empty, Field, IconButton, Modal, PageHeader, Pager, Row, SearchBox, SegTabs,
  Table, Td, Th, inputCls, useToast,
} from '../ui.jsx'
import { tr } from '../i18n.js'

const PAGE = 25
const blank = { name: '', phone: '', email: '', address: '', card_no: '' }

export default function Members({ params, go }) {
  const { isAdmin } = useAuth()
  const notify = useToast()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [view, setView] = useState('active')
  const [form, setForm] = useState(null)
  const [drawer, setDrawer] = useState(null)
  const [cards, setCards] = useState(false)

  useEffect(() => {
    if (params?.openMember) setDrawer(params.openMember)
    if (params?.newMember) setForm(blank)
  }, [params])
  useEffect(() => {
    const h = () => setView('active') || setForm(blank)
    window.addEventListener('app:new', h)
    return () => window.removeEventListener('app:new', h)
  }, [])
  const dq = useDebounced(q)
  const archived = view === 'archived'

  const { rows, total, ready, reload } = useList('members:list', { search: dq, page, pageSize: PAGE, archived }, setPage)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const search = (v) => { setQ(v); setPage(1) }
  const changeView = (v) => { setView(v); setPage(1) }

  const save = async (e) => {
    e.preventDefault()
    try {
      await call('members:save', form)
      notify(form.id ? tr("تم حفظ التعديلات") : tr("تمت إضافة العضو"))
      setForm(null)
      reload()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const archive = async (m) => {
    try {
      await call('members:archive', m.id)
      reload()
      notify(tr("تمت أرشفة «{0}»", [m.name]), 'ok', {
        label: tr("تراجع"),
        run: async () => {
          try { await call('members:restore', m.id); reload() } catch (e) { notify(e.message, 'err') }
        },
      })
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const restore = async (m) => {
    try {
      await call('members:restore', m.id)
      notify(tr("تم استرجاع «{0}»", [m.name]))
      reload()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  return (
    <>
      <PageHeader
        title={tr("الأعضاء")}
        subtitle={archived ? tr("{0} مؤرشف", [total]) : tr("{0} عضو", [total])}
        action={!archived && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCards(true)}><Printer size={16} />{tr("طباعة البطاقات")}</Button>
            <Button onClick={() => setForm(blank)}><Plus size={16} />{tr("إضافة عضو")}</Button>
          </div>
        )}
      />
      <div className="mb-4 flex items-center justify-between gap-4">
        <SearchBox value={q} onChange={search} placeholder={tr("ابحث بالاسم أو الهاتف أو البريد")} />
        {isAdmin && <SegTabs layoutId="members-view" value={view} onChange={changeView} tabs={[['active', tr("النشطون")], ['archived', tr("المؤرشفون")]]} />}
      </div>

      {ready && rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-card">
          <Empty
            title={q ? tr("لا توجد نتائج") : archived ? tr("لا يوجد أعضاء مؤرشفون") : tr("لا يوجد أعضاء بعد")}
            hint={q ? tr("جرّب كلمة بحث أخرى.") : archived ? tr("الأعضاء المؤرشفون يُخفون من القوائم ويبقى سجل إعاراتهم، ويمكن استرجاعهم.") : tr("سجّل أول عضو ليتمكن من استعارة الكتب.")}
            action={q ? <Button variant="outline" onClick={() => search('')}>{tr("مسح البحث")}</Button> : !archived && <Button onClick={() => setForm(blank)}><Plus size={16} />{tr("إضافة عضو")}</Button>}
          />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{tr("الاسم")}</Th><Th>{tr("الهاتف")}</Th><Th>{tr("البريد")}</Th><Th>{tr("تاريخ الانضمام")}</Th><Th>{tr("كتب بحوزته")}</Th><Th className="w-28"><span className="sr-only">{tr("إجراءات")}</span></Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {rows.map((m) => (
                <Row key={m.id}>
                  <Td>
                    <button type="button" onClick={() => setDrawer(m.id)} className="block max-w-full cursor-pointer truncate text-start font-medium hover:text-accent hover:underline">{m.name}</button>
                    <div className="flex items-center gap-2 text-xs tabular-nums text-muted"><span dir="ltr">{m.card_no}</span>{m.unpaid_fines > 0 && <Badge tone="bad">{tr("غرامة {0}", [m.unpaid_fines])}</Badge>}</div>
                  </Td>
                  <Td className="tabular-nums text-muted"><span dir="ltr">{m.phone || '—'}</span></Td>
                  <Td className="text-muted"><span dir="ltr">{m.email || '—'}</span></Td>
                  <Td className="tabular-nums text-muted">{m.joined_at}</Td>
                  <Td><Badge tone={m.active_loans ? 'warn' : 'mute'}><span className="tabular-nums">{m.active_loans}</span></Badge></Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {archived ? (
                        <Button variant="outline" onClick={() => restore(m)} className="!px-3 !py-1.5"><ArchiveRestore size={15} />{tr("استرجاع")}</Button>
                      ) : (
                        <>
                          <IconButton label={tr("تعديل")} onClick={() => setForm(m)}><Pencil size={16} /></IconButton>
                          {isAdmin && <IconButton label={tr("أرشفة")} onClick={() => archive(m)} className="hover:!text-brick"><Archive size={16} /></IconButton>}
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

      <CardsDialog open={cards} onClose={() => setCards(false)} scope={{ kind: 'all' }} />
      <MemberDrawer id={drawer} onClose={() => setDrawer(null)} onChanged={reload} onBorrow={(m) => { setDrawer(null); go('desk', { member: m }) }} />

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? tr("تعديل العضو") : tr("إضافة عضو")}>
        {form && (
          <form onSubmit={save} className="grid grid-cols-2 gap-4">
            <Field label={tr("الاسم الكامل")} className="col-span-2"><input required value={form.name} onChange={set('name')} className={inputCls} /></Field>
            <Field label={tr("الهاتف")}><input value={form.phone || ''} onChange={set('phone')} dir="ltr" className={`${inputCls} text-end`} /></Field>
            <Field label={tr("البريد الإلكتروني")}><input type="email" value={form.email || ''} onChange={set('email')} dir="ltr" className={`${inputCls} text-end`} /></Field>
            <Field label={tr("العنوان")} className="col-span-2"><input value={form.address || ''} onChange={set('address')} className={inputCls} /></Field>
            <Field label={tr("رقم البطاقة (اختياري، يُولَّد تلقائيًا)")} className="col-span-2"><input value={form.card_no || ''} onChange={set('card_no')} dir="ltr" placeholder="M00001" className={`${inputCls} text-end`} /></Field>
            <div className="col-span-2 mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setForm(null)}>{tr("إلغاء")}</Button>
              <Button type="submit">{tr("حفظ")}</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
