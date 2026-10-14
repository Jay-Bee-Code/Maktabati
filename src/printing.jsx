import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import JsBarcode from 'jsbarcode'
import { useRef } from 'react'
import { call } from './api.js'
import { useSettings } from './settings.jsx'
import { Button, Field, Modal, inputCls, useToast } from './ui.jsx'
import { tr } from './i18n.js'

/* ====================== محرّك الطباعة ======================
   print(node, opts) يرسم node داخل #print-root ثم يفتح حوار الطباعة (أو يحفظ PDF).
   يعيد 'printed' | 'saved' | 'canceled'. */
const PrintCtx = createContext(null)
export const usePrint = () => useContext(PrintCtx)

function printRoot() {
  let el = document.getElementById('print-root')
  if (!el) {
    el = document.createElement('div')
    el.id = 'print-root'
    document.body.appendChild(el)
  }
  return el
}

export const PAGE_A4 = '@page { size: A4; margin: 0 }'

export function PrintProvider({ children }) {
  const [job, setJob] = useState(null)
  const [host, setHost] = useState(null)
  useEffect(() => setHost(printRoot()), [])

  const print = useCallback(
    (node, { css = PAGE_A4, pdf = false, name = 'print', landscape = false } = {}) =>
      new Promise((resolve, reject) => {
        setJob({ node, css })
        // إطاران ليكتمل الرسم (ومعه رسم الباركود) قبل فتح حوار الطباعة
        requestAnimationFrame(() =>
          requestAnimationFrame(async () => {
            try {
              if (pdf) {
                const r = await call('print:pdf', { name, landscape })
                resolve(r.canceled ? 'canceled' : 'saved')
              } else {
                window.print()
                resolve('printed')
              }
            } catch (e) {
              reject(e)
            } finally {
              setJob(null)
            }
          })
        )
      }),
    []
  )
  const value = useMemo(() => ({ print }), [print])

  return (
    <PrintCtx.Provider value={value}>
      {children}
      {host && job && createPortal(<><style>{job.css}</style>{job.node}</>, host)}
    </PrintCtx.Provider>
  )
}

/* ====================== الباركود ====================== */
export function Barcode({ value, height = 34 }) {
  const ref = useRef(null)
  useEffect(() => {
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', displayValue: false, height, margin: 0, width: 2 })
    } catch { /* قيمة غير مدعومة: يبقى الرمز النصي أسفل الباركود */ }
  }, [value, height])
  return <svg ref={ref} role="img" aria-label={tr("باركود {0}", [value])} preserveAspectRatio="none" style={{ width: '100%', height }} />
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

/* ====================== الصفحات المطبوعة ====================== */
export const LABELS_PER_PAGE = 21
export const CARDS_PER_PAGE = 10

export function LabelSheet({ labels, skip = 0, library }) {
  const cells = [...Array(skip).fill(null), ...labels]
  return chunk(cells, LABELS_PER_PAGE).map((page, i) => (
    <section className="lbl-page" key={i}>
      {page.map((l, j) =>
        l ? (
          <div className="lbl" key={j}>
            <div className="lbl-lib">{library}{l.shelf ? ` · ${l.shelf}` : ''}</div>
            <div className="lbl-title">{l.title}</div>
            <div><Barcode value={l.barcode} /><div className="lbl-code">{l.barcode}</div></div>
          </div>
        ) : (
          <div className="lbl" key={j} />
        )
      )}
    </section>
  ))
}

export function CardSheet({ cards, skip = 0, library }) {
  const cells = [...Array(skip).fill(null), ...cards]
  return chunk(cells, CARDS_PER_PAGE).map((page, i) => (
    <section className="card-page" key={i}>
      {page.map((c, j) =>
        c ? (
          <div className="id-card" key={j}>
            <header>{library}</header>
            <div>
              <div className="nm">{c.name}</div>
              <div><Barcode value={c.card_no} height={30} /><div className="no">{c.card_no}</div></div>
            </div>
          </div>
        ) : (
          <div key={j} />
        )
      )}
    </section>
  ))
}

export function ReceiptSheet({ library, member, items, when }) {
  return (
    <div className="receipt">
      <h1>{library}</h1>
      <div className="meta">{tr("إيصال إعارة · {0}", [when])}</div>
      <p><strong>{member.name}</strong> <span dir="ltr">({member.card_no})</span></p>
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            <div>«{it.title}»</div>
            <div className="due"><span dir="ltr">{it.barcode}</span>{' '}{tr("· يُعاد قبل")}{' '}<span dir="ltr">{it.due_date}</span></div>
          </li>
        ))}
      </ul>
      <div className="foot">{tr("شكرًا لكم. يرجى إعادة الكتب في مواعيدها.")}</div>
    </div>
  )
}

export function OverdueSheet({ library, rows, when }) {
  return (
    <div className="report">
      <h1>{tr("كشف الكتب المتأخرة")}</h1>
      <div className="meta">{tr("{0} · {1} · {2} إعارة", [library, when, rows.length])}</div>
      <table>
        <thead><tr><th>{tr("العضو")}</th><th>{tr("الهاتف")}</th><th>{tr("الكتاب")}</th><th>{tr("الباركود")}</th><th>{tr("موعد الإرجاع")}</th><th>{tr("أيام التأخير")}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.member_name}</td>
              <td dir="ltr">{r.member_phone || '—'}</td>
              <td>{r.title}</td>
              <td dir="ltr">{r.barcode || '—'}</td>
              <td dir="ltr">{r.due_date}</td>
              <td>{r.days_late}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const nowText = () => new Date().toLocaleString('sv-SE').slice(0, 16)

/** إيصال الإعارة (يُطبع مباشرة دون حوار) */
export function useReceipt() {
  const { print } = usePrint()
  const { settings } = useSettings()
  return (member, items) =>
    print(<ReceiptSheet library={settings.library_name} member={member} items={items} when={nowText()} />, {
      css: '@page { size: 80mm auto; margin: 3mm }',
      name: 'receipt',
    })
}

/* ====================== حوار الطباعة الموحّد ======================
   load: يجلب العناصر. perPage>0 يعرض «ابدأ من الخانة». onConfirm يُستدعى بعد سؤال «هل طُبعت بنجاح؟». */
export function PrintDialog({
  open, onClose, title, load, emptyText, noun, perPage = 0, makeNode, css = PAGE_A4, pdfName, landscape = false,
  confirmQuestion, onConfirm,
}) {
  const { print } = usePrint()
  const notify = useToast()
  const [items, setItems] = useState(null)
  const [start, setStart] = useState(1)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!open) return
    setItems(null); setStart(1); setAsking(false)
    let live = true
    load().then((r) => live && setItems(r)).catch((e) => { notify(e.message, 'err'); onClose() })
    return () => { live = false }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const skip = perPage ? Math.min(Math.max(Number(start) || 1, 1), perPage) - 1 : 0
  const pages = items && perPage ? Math.ceil((skip + items.length) / perPage) : 1

  const run = async (pdf) => {
    setBusy(true)
    try {
      const r = await print(makeNode(items, skip), { css, pdf, name: pdfName, landscape })
      if (r === 'canceled') return
      if (onConfirm) setAsking(true)
      else { notify(pdf ? tr("تم حفظ ملف PDF") : tr("أُرسلت إلى الطابعة")); onClose() }
    } catch (e) {
      notify(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    try { await onConfirm(items); notify(tr("تم التعليم كمطبوعة")); onClose() } catch (e) { notify(e.message, 'err') }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {items === null ? (
        <p className="py-6 text-center text-sm text-muted">{tr("جارٍ التحميل…")}</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{emptyText}</p>
      ) : asking ? (
        <>
          <p className="text-sm leading-7">{confirmQuestion}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAsking(false)}>{tr("لا، سأعيد الطباعة")}</Button>
            <Button onClick={confirm}>{tr("نعم، طُبعت بنجاح")}</Button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm">
            <span className="font-semibold tabular-nums">{items.length}</span> {noun}
            {perPage > 0 && <>{' '}{tr("على")}{' '}<span className="font-semibold tabular-nums">{pages}</span> {pages === 1 ? tr("صفحة") : tr("صفحات")}</>}
          </p>
          {perPage > 0 && (
            <Field label={tr("ابدأ من الخانة (1–{0})", [perPage])} className="mb-4 max-w-48">
              <input type="number" min="1" max={perPage} value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
              <span className="text-xs font-normal text-muted">{tr("لاستعمال ورقة ملصقات استُعمل جزء منها سابقًا.")}</span>
            </Field>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => run(true)}>{tr("حفظ PDF")}</Button>
            <Button disabled={busy} onClick={() => run(false)}>{tr("طباعة")}</Button>
          </div>
        </>
      )}
    </Modal>
  )
}

/* ====================== حوارات جاهزة ====================== */
/** scope: { kind: 'pending' } أو { kind: 'book', id } */
export function LabelsDialog({ open, onClose, scope, onDone }) {
  const { settings } = useSettings()
  return (
    <PrintDialog
      open={open}
      onClose={onClose}
      title={scope?.kind === 'book' ? tr("طباعة ملصقات نسخ الكتاب") : tr("طباعة ملصقات الباركود")}
      load={() => (scope?.kind === 'book' ? call('labels:book', scope.id) : call('labels:pending'))}
      emptyText={tr("لا توجد ملصقات غير مطبوعة. كل النسخ الحالية مطبوعة.")}
      noun={tr("ملصقًا")}
      perPage={LABELS_PER_PAGE}
      makeNode={(items, skip) => <LabelSheet labels={items} skip={skip} library={settings.library_name} />}
      pdfName="labels"
      confirmQuestion={tr("هل طُبعت الملصقات بنجاح؟ سنعلّمها كمطبوعة فلا تظهر في «الملصقات غير المطبوعة» مرة أخرى.")}
      onConfirm={async (items) => { await call('labels:mark', { ids: items.map((i) => i.id) }); onDone?.() }}
    />
  )
}

/** scope: { kind: 'all' } أو { kind: 'one', id } */
export function CardsDialog({ open, onClose, scope }) {
  const { settings } = useSettings()
  return (
    <PrintDialog
      open={open}
      onClose={onClose}
      title={scope?.kind === 'one' ? tr("طباعة بطاقة العضو") : tr("طباعة بطاقات الأعضاء")}
      load={() => call('cards:list', scope?.kind === 'one' ? { ids: [scope.id] } : {})}
      emptyText={tr("لا يوجد أعضاء.")}
      noun={tr("بطاقة")}
      perPage={CARDS_PER_PAGE}
      makeNode={(items, skip) => <CardSheet cards={items} skip={skip} library={settings.library_name} />}
      pdfName="cards"
    />
  )
}

export function OverdueDialog({ open, onClose }) {
  const { settings } = useSettings()
  return (
    <PrintDialog
      open={open}
      onClose={onClose}
      title={tr("كشف الكتب المتأخرة")}
      load={() => call('overdue:all')}
      emptyText={tr("لا توجد كتب متأخرة حاليًا.")}
      noun={tr("إعارة متأخرة")}
      makeNode={(items) => <OverdueSheet library={settings.library_name} rows={items} when={nowText()} />}
      css="@page { size: A4; margin: 12mm }"
      pdfName="overdue"
    />
  )
}
