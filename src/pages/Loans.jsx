import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Plus, Undo2, RefreshCw, Printer, Bell } from 'lucide-react'
import { call } from '../api.js'
import { useDebounced, useList } from '../hooks.js'
import { useSettings } from '../settings.jsx'
import { OverdueDialog } from '../printing.jsx'
import { ReminderModal } from '../reminders.jsx'
import {
  Badge, Button, Combobox, DaysPicker, Empty, FieldGroup, Modal, PageHeader, Pager, Row, SearchBox, SegTabs,
  Table, Td, Th, useToast,
} from '../ui.jsx'
import { tr, tk } from '../i18n.js'

const PAGE = 25
const TABS = [['all', tk("الكل")], ['active', tk("جارية")], ['overdue', tk("متأخرة")], ['returned', tk("مُعادة")]]

export default function Loans() {
  const notify = useToast()
  const { settings } = useSettings()
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState(null)
  const [report, setReport] = useState(false)
  const [remind, setRemind] = useState(null)
  const dq = useDebounced(q)

  const { rows, total, ready, reload } = useList('loans:list', { status, search: dq, page, pageSize: PAGE }, setPage)

  const newLoan = useCallback(() => setForm({ book: null, member: null, days: settings.default_loan_days }), [settings.default_loan_days])
  useEffect(() => {
    window.addEventListener('app:new', newLoan)
    return () => window.removeEventListener('app:new', newLoan)
  }, [newLoan])

  const searchBooks = useCallback((s) => call('books:search', s), [])
  const searchMembers = useCallback((s) => call('members:search', s), [])

  const changeStatus = (s) => { setStatus(s); setPage(1) }
  const search = (v) => { setQ(v); setPage(1) }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.book) return notify(tr("اختر الكتاب من القائمة"), 'err')
    if (!form.member) return notify(tr("اختر العضو من القائمة"), 'err')
    try {
      await call('loans:borrow', { book_id: form.book.id, member_id: form.member.id, days: Number(form.days) })
      notify(tr("تمت إعارة «{0}» إلى {1}", [form.book.title, form.member.name]))
      setForm(null)
      reload()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const renew = async (l) => {
    try {
      const r = await call('loans:renew', l.id)
      notify(tr("تم تمديد «{0}» حتى {1}", [r.title, r.due_date]))
      reload()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const giveBack = async (l) => {
    try {
      await call('loans:return', l.id)
      notify(tr("تم إرجاع «{0}»", [l.title]))
      reload()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const badge = (l) =>
    l.status === 'overdue' ? <Badge tone="bad">{tr("متأخرة {0} يومًا", [l.days_late])}</Badge>
    : l.status === 'active' ? <Badge tone="warn">{tr("جارية")}</Badge>
    : <Badge tone="ok">{tr("مُعادة")}</Badge>

  return (
    <>
      <PageHeader
        title={tr("الإعارات")}
        subtitle={tr("{0} إعارة", [total])}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setReport(true)}><Printer size={16} />{tr("كشف المتأخرات")}</Button>
            <Button onClick={newLoan}><Plus size={16} />{tr("إعارة جديدة")}</Button>
          </div>
        }
      />

      <div className="mb-4 flex items-center justify-between gap-4">
        <SegTabs layoutId="loan-tab" value={status} onChange={changeStatus} tabs={TABS} />
        <SearchBox value={q} onChange={search} placeholder={tr("ابحث بعنوان الكتاب أو اسم العضو")} />
      </div>

      {ready && rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-card">
          <Empty
            title={tr("لا توجد إعارات هنا")}
            hint={q ? tr("جرّب كلمة بحث أخرى.") : status === 'overdue' ? tr("لا توجد كتب متأخرة. أحسنتم المتابعة.") : tr("سجّل إعارة جديدة لتظهر في هذه القائمة.")}
            action={q && <Button variant="outline" onClick={() => search('')}>{tr("مسح البحث")}</Button>}
          />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{tr("الكتاب")}</Th><Th>{tr("العضو")}</Th><Th>{tr("تاريخ الإعارة")}</Th><Th>{tr("موعد الإرجاع")}</Th><Th>{tr("الحالة")}</Th><Th className="w-72"><span className="sr-only">{tr("إجراءات")}</span></Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {rows.map((l) => (
                <Row key={l.id}>
                  <Td>
                    <div className="font-medium">{l.title}</div>
                    <div className="text-xs text-muted">{l.author}{l.renewals ? tr(" · جُدّدت {0}×", [l.renewals]) : ''}</div>
                  </Td>
                  <Td>{l.member_name}</Td>
                  <Td className="tabular-nums text-muted">{l.loan_date}</Td>
                  <Td className="tabular-nums text-muted">{l.return_date ? tr("أُعيد {0}", [l.return_date]) : l.due_date}</Td>
                  <Td>{badge(l)}</Td>
                  <Td>
                    <div className="flex justify-end gap-1.5">
                      {l.status === 'overdue' && (
                        <Button variant="outline" onClick={() => setRemind(l.member_id)} className="!px-3 !py-1.5"><Bell size={15} />{tr("تذكير")}</Button>
                      )}
                      {l.status === 'active' && (
                        <Button variant="outline" onClick={() => renew(l)} className="!px-3 !py-1.5"><RefreshCw size={15} />{tr("تمديد")}</Button>
                      )}
                      {!l.return_date && (
                        <Button variant="outline" onClick={() => giveBack(l)} className="!px-3 !py-1.5">
                          <Undo2 size={15} />{tr("إرجاع")}</Button>
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

      <OverdueDialog open={report} onClose={() => setReport(false)} />
      <ReminderModal open={!!remind} onClose={() => setRemind(null)} memberId={remind} kind="overdue" />

      <Modal open={!!form} onClose={() => setForm(null)} title={tr("إعارة جديدة")}>
        {form && (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FieldGroup label={tr("الكتاب")}>
              <Combobox
                ariaLabel={tr("الكتاب")}
                placeholder={tr("اكتب العنوان أو المؤلف أو ISBN")}
                value={form.book}
                onChange={(book) => setForm((f) => ({ ...f, book }))}
                fetcher={searchBooks}
                getLabel={(b) => b.title}
                emptyText={tr("لا توجد كتب متاحة بهذا البحث")}
                renderOption={(b) => (
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0"><span className="block truncate font-medium">{b.title}</span><span className="block truncate text-xs text-muted">{b.author}</span></span>
                    <Badge tone={b.available === 1 ? 'warn' : 'ok'}>{tr("{0} متاحة", [b.available])}</Badge>
                  </div>
                )}
              />
            </FieldGroup>
            <FieldGroup label={tr("العضو")}>
              <Combobox
                ariaLabel={tr("العضو")}
                placeholder={tr("اكتب اسم العضو أو هاتفه")}
                value={form.member}
                onChange={(member) => setForm((f) => ({ ...f, member }))}
                fetcher={searchMembers}
                getLabel={(m) => m.name}
                emptyText={tr("لا يوجد عضو بهذا البحث")}
                renderOption={(m) => (
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{m.name}</span>
                    <span className="shrink-0 text-xs text-muted">{tr("بحوزته {0}", [m.active_loans])}</span>
                  </div>
                )}
              />
            </FieldGroup>
            <FieldGroup label={tr("مدة الإعارة")}>
              <DaysPicker value={form.days} onChange={(days) => setForm((f) => ({ ...f, days }))} />
            </FieldGroup>
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setForm(null)}>{tr("إلغاء")}</Button>
              <Button type="submit">{tr("تسجيل الإعارة")}</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
