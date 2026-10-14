import { useCallback, useEffect, useState } from 'react'
import { Plus, ArrowLeftRight, Printer, BookmarkPlus, RefreshCw } from 'lucide-react'
import { call } from './api.js'
import { useAuth } from './auth.jsx'
import { useSettings } from './settings.jsx'
import { LabelsDialog, CardsDialog } from './printing.jsx'
import { Badge, Button, Combobox, Drawer, Field, FieldGroup, Modal, inputCls, useToast } from './ui.jsx'
import { tr, tk } from './i18n.js'

const COPY_STATUS = { ok: tk("سليمة"), damaged: tk("تالفة"), lost: tk("مفقودة") }
const loanBadge = (l) =>
  l.status === 'overdue' ? <Badge tone="bad">{tr("متأخرة {0} يومًا", [l.days_late])}</Badge>
  : l.status === 'active' ? <Badge tone="warn">{tr("جارية")}</Badge>
  : <Badge tone="ok">{tr("مُعادة")}</Badge>

function Section({ title, children }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="mb-2 font-display text-xl font-bold">{title}</h3>
      {children}
    </section>
  )
}

function Meta({ items }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      {items.filter(([, v]) => v).map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const resBadge = (r) =>
  r.status === 'ready' ? <Badge tone="ok">{tr("جاهز حتى {0}", [r.expires_at])}</Badge> : <Badge tone="warn">{tr("بالانتظار · الدور {0}", [r.position])}</Badge>

/* ---------- حجز كتاب لعضو ---------- */
function ReserveDialog({ open, onClose, book, onDone }) {
  const notify = useToast()
  const [member, setMember] = useState(null)
  useEffect(() => { if (open) setMember(null) }, [open])
  const fetcher = useCallback((q) => call('members:search', q), [])

  const submit = async (e) => {
    e.preventDefault()
    if (!member) return notify(tr("اختر العضو من القائمة"), 'err')
    try {
      const r = await call('reservations:create', { book_id: book.id, member_id: member.id })
      notify(tr("تم الحجز لـ {0} (الدور {1})", [member.name, r.position]))
      onClose()
      onDone()
    } catch (err) { notify(err.message, 'err') }
  }

  return (
    <Modal open={open} onClose={onClose} title={tr("حجز الكتاب لعضو")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{tr("«{0}» غير متاح الآن. سيُحتفظ به للعضو أول ما تتوفر نسخة.", [book?.title])}</p>
        <FieldGroup label={tr("العضو")}>
          <Combobox
            ariaLabel={tr("العضو")}
            placeholder={tr("اكتب اسم العضو أو رقم بطاقته")}
            value={member}
            onChange={setMember}
            fetcher={fetcher}
            getLabel={(m) => m.name}
            emptyText={tr("لا يوجد عضو بهذا البحث")}
            renderOption={(m) => (
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">{m.name}</span>
                <span className="shrink-0 text-xs text-muted" dir="ltr">{m.card_no}</span>
              </div>
            )}
          />
        </FieldGroup>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{tr("إلغاء")}</Button>
          <Button type="submit">{tr("تأكيد الحجز")}</Button>
        </div>
      </form>
    </Modal>
  )
}

/* ======================= كتاب ======================= */
export function BookDrawer({ id, onClose, onChanged }) {
  const notify = useToast()
  const [d, setD] = useState(null)
  const [labels, setLabels] = useState(false)
  const [reserve, setReserve] = useState(false)

  const load = useCallback(async () => {
    try { setD(await call('books:get', id)) } catch (e) { notify(e.message, 'err') }
  }, [id, notify])

  useEffect(() => {
    setD(null)
    if (id) load()
  }, [id, load])

  const changed = () => { load(); onChanged?.() }

  const setStatus = async (copy, status) => {
    try { await call('copies:setStatus', { id: copy.id, status }); notify(tr("تم تغيير حالة {0}", [copy.barcode])); changed() }
    catch (e) { notify(e.message, 'err') }
  }
  const addCopy = async () => {
    try { const r = await call('books:addCopy', id); notify(tr("أُضيفت نسخة جديدة: {0}", [r.barcode])); changed() }
    catch (e) { notify(e.message, 'err') }
  }
  const cancelRes = async (r) => {
    try { await call('reservations:cancel', r.id); notify(tr("أُلغي حجز {0}", [r.member_name])); changed() }
    catch (e) { notify(e.message, 'err') }
  }

  const b = d?.book
  return (
    <>
      <Drawer open={!!id} onClose={onClose} title={b ? b.title : '…'}>
        {b && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge tone={b.available <= 0 ? 'bad' : b.available === 1 ? 'warn' : 'ok'}>
                <span className="tabular-nums">{tr("{0} متاحة من {1}", [b.available, b.copies])}</span>
              </Badge>
              {b.archived_at && <Badge>{tr("مؤرشف")}</Badge>}
              {!b.archived_at && b.available <= 0 && b.copies > 0 && (
                <Button variant="outline" onClick={() => setReserve(true)} className="!px-3 !py-1"><BookmarkPlus size={15} />{tr("حجز لعضو")}</Button>
              )}
            </div>
            <Meta items={[[tr("المؤلف"), b.author], [tr("سنة النشر"), b.year], ['ISBN', b.isbn && <span dir="ltr">{b.isbn}</span>], [tr("التصنيف"), b.category], [tr("الرفّ"), b.shelf]]} />

            <Section title={tr("النسخ")}>
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-mist/60 text-xs text-muted">
                      <th className="px-3 py-2 text-start font-semibold">{tr("الباركود")}</th>
                      <th className="px-3 py-2 text-start font-semibold">{tr("الحالة")}</th>
                      <th className="px-3 py-2 text-start font-semibold">{tr("الإعارة")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.copies.map((c) => (
                      <tr key={c.id} className="border-t border-line/70">
                        <td className="px-3 py-2 tabular-nums" dir="ltr">{c.barcode}</td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={tr("حالة النسخة {0}", [c.barcode])}
                            value={c.status}
                            disabled={!!c.loan_id}
                            onChange={(e) => setStatus(c, e.target.value)}
                            className={`${inputCls} !w-28 !py-1`}
                          >
                            {Object.entries(COPY_STATUS).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">
                          {c.loan_id ? <>{tr("عند {0} حتى", [c.member_name])}{' '}<span className="tabular-nums">{c.due_date}</span></> : '—'}
                        </td>
                      </tr>
                    ))}
                    {d.copies.length === 0 && <tr><td colSpan="3" className="px-3 py-4 text-center text-muted">{tr("لا توجد نسخ")}</td></tr>}
                  </tbody>
                </table>
              </div>
              {!b.archived_at && (
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" onClick={addCopy}><Plus size={15} />{tr("إضافة نسخة")}</Button>
                  <Button variant="outline" onClick={() => setLabels(true)}><Printer size={15} />{tr("طباعة الملصقات")}</Button>
                </div>
              )}
            </Section>

            {d.reservations.length > 0 && (
              <Section title={tr("الحجوزات")}>
                <ul className="divide-y divide-line text-sm">
                  {d.reservations.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0 truncate font-medium">{r.member_name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {resBadge(r)}
                        <Button variant="outline" onClick={() => cancelRes(r)} className="!px-3 !py-1.5">{tr("إلغاء")}</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title={tr("آخر الإعارات")}>
              {d.history.length === 0 ? (
                <p className="text-sm text-muted">{tr("لم يُستعر هذا الكتاب بعد.")}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {d.history.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{l.member_name}</div>
                        <div className="text-xs tabular-nums text-muted">{l.loan_date} ← {l.return_date || l.due_date}</div>
                      </div>
                      {loanBadge(l)}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </Drawer>
      {/* النوافذ خارج الدرج لأن تحويله (transform) يغيّر مرجع التموضع الثابت */}
      <LabelsDialog open={labels} onClose={() => setLabels(false)} scope={{ kind: 'book', id }} onDone={changed} />
      <ReserveDialog open={reserve} onClose={() => setReserve(false)} book={b} onDone={changed} />
    </>
  )
}

/* ---------- إضافة غرامة يدوية (للمدير) ---------- */
function AddFineDialog({ open, onClose, member, onDone }) {
  const notify = useToast()
  const { settings } = useSettings()
  const [f, setF] = useState({ amount: '', reason: '' })
  useEffect(() => { if (open) setF({ amount: '', reason: '' }) }, [open])

  const submit = async (e) => {
    e.preventDefault()
    try {
      await call('fines:add', { member_id: member.id, amount: Number(f.amount), reason: f.reason })
      notify(tr("أُضيفت الغرامة"))
      onClose()
      onDone()
    } catch (err) { notify(err.message, 'err') }
  }

  return (
    <Modal open={open} onClose={onClose} title={tr("إضافة غرامة")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={tr("المبلغ ({0})", [settings.currency])}><input type="number" min="1" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={inputCls} /></Field>
        <Field label={tr("السبب")}><input required maxLength={120} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={tr("مثل: كتاب تالف")} className={inputCls} /></Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{tr("إلغاء")}</Button>
          <Button type="submit">{tr("إضافة")}</Button>
        </div>
      </form>
    </Modal>
  )
}

/* ======================= عضو ======================= */
export function MemberDrawer({ id, onClose, onChanged, onBorrow }) {
  const notify = useToast()
  const { isAdmin } = useAuth()
  const { settings } = useSettings()
  const [d, setD] = useState(null)
  const [card, setCard] = useState(false)
  const [fineOpen, setFineOpen] = useState(false)

  const load = useCallback(async () => {
    try { setD(await call('members:get', id)) } catch (e) { notify(e.message, 'err') }
  }, [id, notify])

  useEffect(() => {
    setD(null)
    if (id) load()
  }, [id, load])

  const changed = () => { load(); onChanged?.() }
  const act = async (fn, okMsg) => {
    try { const r = await fn(); notify(typeof okMsg === 'function' ? okMsg(r) : okMsg); changed() }
    catch (e) { notify(e.message, 'err') }
  }

  const m = d?.member
  const cur = settings.currency
  return (
    <>
      <Drawer open={!!id} onClose={onClose} title={m ? m.name : '…'}>
        {m && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge tone="mute"><span dir="ltr" className="tabular-nums">{m.card_no}</span></Badge>
              {m.archived_at && <Badge>{tr("مؤرشف")}</Badge>}
              {m.unpaid_fines > 0 && <Badge tone="bad">{tr("غرامات {0} {1}", [m.unpaid_fines, cur])}</Badge>}
            </div>
            <Meta items={[[tr("الهاتف"), m.phone && <span dir="ltr">{m.phone}</span>], [tr("البريد"), m.email && <span dir="ltr">{m.email}</span>], [tr("العنوان"), m.address], [tr("تاريخ الانضمام"), m.joined_at], [tr("إجمالي الإعارات"), d.total]]} />
            <div className="mt-4 flex flex-wrap gap-2">
              {!m.archived_at && onBorrow && <Button onClick={() => onBorrow(m)}><ArrowLeftRight size={16} />{tr("إعارة كتاب لهذا العضو")}</Button>}
              <Button variant="outline" onClick={() => setCard(true)}><Printer size={16} />{tr("طباعة البطاقة")}</Button>
            </div>

            <Section title={tr("بحوزته الآن")}>
              {d.open.length === 0 ? (
                <p className="text-sm text-muted">{tr("لا توجد كتب بحوزته.")}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {d.open.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{l.title}</div>
                        <div className="text-xs tabular-nums text-muted">{tr("حتى {0}{1}", [l.due_date, l.renewals ? tr(" · جُدّدت {0}×", [l.renewals]) : ''])}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {loanBadge(l)}
                        {l.status !== 'overdue' && (
                          <Button variant="outline" onClick={() => act(() => call('loans:renew', l.id), (r) => tr("تم تمديد «{0}» حتى {1}", [r.title, r.due_date]))} className="!px-3 !py-1.5"><RefreshCw size={14} />{tr("تمديد")}</Button>
                        )}
                        <Button variant="outline" onClick={() => act(() => call('loans:return', l.id), tr("تم إرجاع «{0}»", [l.title]))} className="!px-3 !py-1.5">{tr("إرجاع")}</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {d.reservations.length > 0 && (
              <Section title={tr("حجوزاته")}>
                <ul className="divide-y divide-line text-sm">
                  {d.reservations.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0 truncate font-medium">{r.title}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {resBadge(r)}
                        <Button variant="outline" onClick={() => act(() => call('reservations:cancel', r.id), tr("أُلغي الحجز"))} className="!px-3 !py-1.5">{tr("إلغاء")}</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title={tr("الغرامات")}>
              {d.fines.length === 0 ? (
                <p className="text-sm text-muted">{tr("لا توجد غرامات غير مسددة.")}</p>
              ) : (
                <>
                  <ul className="divide-y divide-line text-sm">
                    {d.fines.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate">{f.reason}</div>
                          <div className="text-xs tabular-nums text-muted">{f.created_at}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-semibold tabular-nums">{f.amount} {cur}</span>
                          <Button variant="outline" onClick={() => act(() => call('fines:pay', f.id), tr("سُدِّدت الغرامة"))} className="!px-3 !py-1.5">{tr("تسديد")}</Button>
                          {isAdmin && <Button variant="ghost" onClick={() => act(() => call('fines:waive', f.id), tr("أُعفي العضو من الغرامة"))} className="!px-3 !py-1.5">{tr("إعفاء")}</Button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Button onClick={() => act(() => call('fines:payMember', { member_id: m.id }), (r) => tr("سُدِّد {0} {1}", [r.paid, cur]))} className="mt-3">{tr("تسديد الكل ({0} {1})", [m.unpaid_fines, cur])}</Button>
                </>
              )}
              {isAdmin && <Button variant="ghost" onClick={() => setFineOpen(true)} className="mt-2 !px-2"><Plus size={15} />{tr("إضافة غرامة")}</Button>}
            </Section>

            <Section title={tr("السجل")}>
              {d.history.length === 0 ? (
                <p className="text-sm text-muted">{tr("لا يوجد سجل بعد.")}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {d.history.map((l) => (
                    <li key={l.id} className="py-2.5">
                      <div className="truncate font-medium">{l.title}</div>
                      <div className="text-xs tabular-nums text-muted">{l.loan_date} ← {l.return_date}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </Drawer>
      <CardsDialog open={card} onClose={() => setCard(false)} scope={{ kind: 'one', id }} />
      <AddFineDialog open={fineOpen} onClose={() => setFineOpen(false)} member={m} onDone={changed} />
    </>
  )
}
