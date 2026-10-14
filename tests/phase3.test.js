const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createDb } = require('../electron/db')

const fresh = () => createDb(':memory:')
const book = (d, o = {}) => d.saveBook({ title: 'ك', author: 'م', copies: 1, ...o })
const member = (d, name) => d.saveMember({ name })
const setDue = (d, loanId, sql) => d.raw.prepare(`UPDATE loans SET due_date = ${sql} WHERE id = ?`).run(loanId)
const today = (d, mod = '') => d.raw.prepare(`SELECT date('now','localtime'${mod ? `, '${mod}'` : ''}) x`).get().x

test('الإعدادات الجديدة: تحقق وحفظ جزئي', () => {
  const d = fresh()
  assert.throws(() => d.saveSettings({ max_renewals: 11 }), /التمديد|مرات/)
  assert.throws(() => d.saveSettings({ fine_per_day: -1 }), /الغرامة/)
  assert.throws(() => d.saveSettings({ hold_days: 0 }), /الاحتفاظ/)
  assert.throws(() => d.saveSettings({ currency: '' }), /العملة/)
  const s = d.saveSettings({ fine_per_day: 10, currency: 'DZD' }) // حفظ جزئي يُبقي الباقي
  assert.equal(s.fine_per_day, 10)
  assert.equal(s.default_loan_days, 14)
  assert.equal(s.currency, 'DZD')
})

test('الغرامات: تُحسب عند الإرجاع المتأخر مع السقف، ثم التسديد والإعفاء', () => {
  const d = fresh()
  d.saveSettings({ fine_per_day: 10 })
  const m = member(d, 'ع')
  const l1 = d.borrow({ member_id: m, book_id: book(d, { title: 'أ' }) })
  setDue(d, l1.id, "date('now','localtime','-4 days')")
  const r1 = d.returnLoan(l1.id)
  assert.equal(r1.fine, 40)
  assert.equal(d.getMember(m).member.unpaid_fines, 40)

  d.saveSettings({ fine_cap: 25 })
  const l2 = d.borrow({ member_id: m, book_id: book(d, { title: 'ب' }) })
  setDue(d, l2.id, "date('now','localtime','-9 days')")
  assert.equal(d.returnLoan(l2.id).fine, 25) // السقف

  // إرجاع في الموعد: لا غرامة
  const l3 = d.borrow({ member_id: m, book_id: book(d, { title: 'ج' }) })
  assert.equal(d.returnLoan(l3.id).fine, 0)

  const list = d.listFines({ member_id: m })
  assert.equal(list.total, 2)
  assert.equal(list.sum, 65)
  d.payFine(list.rows[0].id)
  assert.throws(() => d.payFine(list.rows[0].id), /مسددة/)
  assert.equal(d.getMember(m).member.unpaid_fines, 40)
  d.waiveFine(list.rows[1].id)
  assert.throws(() => d.waiveFine(list.rows[1].id), /مسبقًا/)
  assert.equal(d.getMember(m).member.unpaid_fines, 0)
  assert.throws(() => d.payMemberFines(m), /لا توجد/)
  assert.equal(d.listFines({ member_id: m, status: 'paid' }).total, 1)
  assert.equal(d.listFines({ member_id: m, status: 'waived' }).total, 1)
  assert.equal(d.listFines({ member_id: m, status: 'all' }).total, 2)
})

test('الغرامات: لا تُحتسب إذا كانت الغرامة اليومية صفرًا', () => {
  const d = fresh()
  const m = member(d, 'ع')
  const l = d.borrow({ member_id: m, book_id: book(d) })
  setDue(d, l.id, "date('now','localtime','-30 days')")
  assert.equal(d.returnLoan(l.id).fine, 0)
  assert.equal(d.listFines({ status: 'all' }).total, 0)
})

test('الغرامات اليدوية، والتسديد الجماعي، ومنع الاستعارة بسبب الغرامات', () => {
  const d = fresh()
  const m = member(d, 'ع')
  assert.throws(() => d.addFine({ member_id: m, amount: 0, reason: 'x' }), /المبلغ/)
  assert.throws(() => d.addFine({ member_id: m, amount: 50, reason: '' }), /سبب/)
  assert.throws(() => d.addFine({ member_id: 999, amount: 50, reason: 'x' }), /غير موجود/)
  d.addFine({ member_id: m, amount: 300, reason: 'كتاب تالف' })
  d.addFine({ member_id: m, amount: 200, reason: 'غلاف ممزق' })
  d.saveSettings({ fine_block_limit: 500 })
  let e
  try { d.borrow({ member_id: m, book_id: book(d) }) } catch (x) { e = x }
  assert.equal(e.code, 'FINES')
  assert.match(e.message, /500 دج/)
  assert.deepEqual(d.payMemberFines(m), { paid: 500 })
  assert.ok(d.borrow({ member_id: m, book_id: 1 }).id) // بعد التسديد
  d.saveSettings({ fine_block_limit: 0 })
})

test('التمديد: يضيف المدة من الموعد الحالي، ويحترم الحدود', () => {
  const d = fresh()
  const m = member(d, 'ع')
  const l = d.borrow({ member_id: m, book_id: book(d), days: 3 })
  const r1 = d.renewLoan(l.id)
  assert.equal(r1.renewals, 1)
  assert.equal(r1.due_date, today(d, '+17 days')) // 3 + 14 من تاريخ الموعد الحالي لا من اليوم
  assert.equal(d.renewLoan(l.id).renewals, 2)
  assert.throws(() => d.renewLoan(l.id), /الحد الأقصى للتمديد \(2\)/)

  const l2 = d.borrow({ member_id: m, book_id: book(d, { title: 'ب' }) })
  setDue(d, l2.id, "date('now','localtime','-1 days')")
  assert.throws(() => d.renewLoan(l2.id), /متأخرة/)

  d.returnLoan(l.id)
  assert.throws(() => d.renewLoan(l.id), /ليست مفتوحة/)

  d.saveSettings({ max_renewals: 0 })
  const l3 = d.borrow({ member_id: m, book_id: book(d, { title: 'ج' }) })
  assert.throws(() => d.renewLoan(l3.id), /غير مفعّل/)
})

test('التمديد يُمنع عند وجود حجز من عضو آخر وعند غرامات تتجاوز الحد', () => {
  const d = fresh()
  const a = member(d, 'أ')
  const b = member(d, 'ب')
  const bk = book(d)
  const l = d.borrow({ member_id: a, book_id: bk })
  d.reserve({ book_id: bk, member_id: b })
  assert.throws(() => d.renewLoan(l.id), /حجز على هذا الكتاب/)

  const d2 = fresh()
  const m = member(d2, 'ع')
  const l2 = d2.borrow({ member_id: m, book_id: book(d2) })
  d2.addFine({ member_id: m, amount: 100, reason: 'x' })
  d2.saveSettings({ fine_block_limit: 50 })
  assert.throws(() => d2.renewLoan(l2.id), /غرامات/)
})

test('الحجز: لا يُقبل والكتاب متاح، ثم الطابور والترقية عند الإرجاع', () => {
  const d = fresh()
  const [a, b, c] = ['أ', 'ب', 'ج'].map((n) => member(d, n))
  const bk = book(d, { title: 'مطلوب' })
  assert.throws(() => d.reserve({ book_id: bk, member_id: b }), /متاح الآن/)
  const la = d.borrow({ member_id: a, book_id: bk })
  assert.throws(() => d.reserve({ book_id: bk, member_id: a }), /يستعير/)
  assert.equal(d.reserve({ book_id: bk, member_id: b }).position, 1)
  assert.equal(d.reserve({ book_id: bk, member_id: c }).position, 2)
  assert.throws(() => d.reserve({ book_id: bk, member_id: b }), /حجز لهذا الكتاب بالفعل/)
  assert.equal(d.getBook(bk).book.reservations, 2)

  const r = d.returnLoan(la.id)
  assert.equal(r.holdFor, 'ب')
  const ready = d.readyReservations()
  assert.equal(ready.length, 1)
  assert.equal(ready[0].member_name, 'ب')
  assert.equal(ready[0].expires_at, today(d, '+3 days'))
  assert.equal(d.getBook(bk).book.available, 0) // محجوزة لـ ب

  // ج لا يأخذ النسخة المحجوزة لـ ب
  assert.throws(() => d.borrow({ member_id: c, book_id: bk }), /محجوزة لأعضاء آخرين/)
  assert.throws(() => d.borrow({ member_id: c, barcode: 'B00001-1' }), /محجوزة لأعضاء آخرين/)

  // ب يستلم نسخته فيتحقق حجزه، وج ينتظر
  const lb = d.borrow({ member_id: b, book_id: bk })
  assert.equal(d.readyReservations().length, 0)
  assert.equal(d.reservationsFor({ book_id: bk }).length, 1)
  assert.equal(d.reservationsFor({ book_id: bk })[0].position, 1)

  assert.equal(d.returnLoan(lb.id).holdFor, 'ج')
})

test('الحجز: الإلغاء والانتهاء ينقلان النسخة للتالي', () => {
  const d = fresh()
  const [a, b, c, e] = ['أ', 'ب', 'ج', 'د'].map((n) => member(d, n))
  const bk = book(d)
  const la = d.borrow({ member_id: a, book_id: bk })
  for (const m of [b, c, e]) d.reserve({ book_id: bk, member_id: m })
  d.returnLoan(la.id) // ب جاهز
  const rb = d.readyReservations()[0]
  d.cancelReservation(rb.id) // يلغيه موظف: تنتقل لـ ج
  assert.equal(d.readyReservations()[0].member_name, 'ج')
  assert.throws(() => d.cancelReservation(rb.id), /لم يعد قائمًا/)

  // ج لم يستلم: تفوت المهلة
  d.raw.prepare("UPDATE reservations SET expires_at = date('now','localtime','-1 days') WHERE status = 'ready'").run()
  const now = d.readyReservations()
  assert.equal(now.length, 1)
  assert.equal(now[0].member_name, 'د')
  assert.equal(d.raw.prepare("SELECT COUNT(*) c FROM reservations WHERE status = 'expired'").get().c, 1)
})

test('الحجز: تلف النسخة المحجوزة يعيد صاحبها للانتظار، وإضافة نسخة تُجهّزه', () => {
  const d = fresh()
  const [a, b] = ['أ', 'ب'].map((n) => member(d, n))
  const bk = book(d)
  const la = d.borrow({ member_id: a, book_id: bk })
  d.reserve({ book_id: bk, member_id: b })
  d.returnLoan(la.id)
  assert.equal(d.readyReservations().length, 1)
  const copy = d.getBook(bk).copies[0]
  d.setCopyStatus({ id: copy.id, status: 'damaged' })
  assert.equal(d.readyReservations().length, 0)
  assert.equal(d.reservationsFor({ book_id: bk })[0].status, 'waiting')
  d.addCopy(bk) // نسخة جديدة تُرقّي المنتظر
  assert.equal(d.readyReservations()[0].member_name, 'ب')
  d.setCopyStatus({ id: copy.id, status: 'ok' }) // وإعادة السليمة لا تخرّب شيئًا
  assert.equal(d.readyReservations().length, 1)
})

test('الحجز: أرشفة عضو تلغي حجوزاته وتنقل النسخة، وأرشفة كتاب تلغي حجوزاته', () => {
  const d = fresh()
  const [a, b, c] = ['أ', 'ب', 'ج'].map((n) => member(d, n))
  const bk = book(d)
  const la = d.borrow({ member_id: a, book_id: bk })
  d.reserve({ book_id: bk, member_id: b })
  d.reserve({ book_id: bk, member_id: c })
  d.returnLoan(la.id) // ب جاهز
  d.archiveMember(b)
  assert.equal(d.readyReservations()[0].member_name, 'ج')

  const bk2 = book(d, { title: 'آخر' })
  const l2 = d.borrow({ member_id: a, book_id: bk2 })
  d.reserve({ book_id: bk2, member_id: c })
  d.returnLoan(l2.id)
  d.archiveBook(bk2)
  assert.equal(d.reservationsFor({ book_id: bk2 }).length, 0)
})

test('الحجز: العضو المؤرشف المنتظر يُتجاوز عند الترقية', () => {
  const d = fresh()
  const [a, b, c] = ['أ', 'ب', 'ج'].map((n) => member(d, n))
  const bk = book(d)
  const la = d.borrow({ member_id: a, book_id: bk })
  d.reserve({ book_id: bk, member_id: b })
  d.reserve({ book_id: bk, member_id: c })
  d.archiveMember(b)
  d.returnLoan(la.id)
  assert.equal(d.readyReservations()[0].member_name, 'ج')
})

test('عضو لديه حجز منتظر يستعير الكتاب مباشرة فيتحقق الحجز', () => {
  const d = fresh()
  const [a, b] = ['أ', 'ب'].map((n) => member(d, n))
  const bk = book(d, { copies: 2 })
  d.borrow({ member_id: a, book_id: bk })
  d.borrow({ member_id: member(d, 'ج'), book_id: bk })
  d.reserve({ book_id: bk, member_id: b })
  d.addCopy(bk) // تصبح متاحة: ب جاهز
  assert.equal(d.readyReservations()[0].member_name, 'ب')
  d.borrow({ member_id: b, book_id: bk })
  assert.equal(d.reservationsFor({ book_id: bk }).length, 0)
})

test('رسائل التذكير: متأخرات وحجز جاهز', () => {
  const d = fresh()
  d.saveSettings({ library_name: 'مكتبة الأمل', fine_per_day: 5 })
  const m = member(d, 'سارة')
  const l1 = d.borrow({ member_id: m, book_id: book(d, { title: 'أ' }) })
  const l2 = d.borrow({ member_id: m, book_id: book(d, { title: 'ب' }) })
  assert.throws(() => d.reminderText({ member_id: m }), /لا توجد كتب متأخرة/)
  setDue(d, l1.id, "date('now','localtime','-3 days')")
  setDue(d, l2.id, "date('now','localtime','-8 days')")
  d.addFine({ member_id: m, amount: 70, reason: 'x' })
  const r = d.reminderText({ member_id: m })
  assert.match(r.text, /سارة/)
  assert.match(r.text, /«أ».*متأخر 3 يومًا/)
  assert.match(r.text, /«ب».*متأخر 8 يومًا/)
  assert.match(r.text, /70 دج/)
  assert.match(r.text, /مكتبة الأمل/)
  assert.match(r.subject, /تذكير/)

  const x = member(d, 'خالد')
  const bk = book(d, { title: 'مطلوب' })
  const lx = d.borrow({ member_id: x, book_id: bk })
  d.reserve({ book_id: bk, member_id: m })
  assert.throws(() => d.reminderText({ member_id: m, kind: 'ready' }), /لا توجد حجوزات جاهزة/)
  d.returnLoan(lx.id)
  const rr = d.reminderText({ member_id: m, kind: 'ready' })
  assert.match(rr.text, /«مطلوب»/)
  assert.match(rr.text, new RegExp(today(d, '+3 days')))
  assert.throws(() => d.reminderText({ member_id: 999 }), /غير موجود/)
})

test('الملصقات والبطاقات والكشوف', () => {
  const d = fresh()
  const a = book(d, { title: 'أ', copies: 2 })
  book(d, { title: 'ب', copies: 1 })
  const m1 = member(d, 'عضو 1')
  member(d, 'عضو 2')
  assert.equal(d.labelsPending().length, 3)
  const bc = d.labelsForBook(a)
  assert.deepEqual(bc.map((c) => c.barcode), ['B00001-1', 'B00001-2'])
  assert.equal(bc[0].title, 'أ')
  d.markLabelsPrinted(bc.map((c) => c.id))
  assert.equal(d.labelsPending().length, 1)
  assert.equal(d.labelsForBook(a).length, 2) // إعادة الطباعة ممكنة
  assert.throws(() => d.markLabelsPrinted(['x']), /غير صالحة/)
  // المفقودة والمؤرشفة لا تُطلب
  d.setCopyStatus({ id: d.labelsPending()[0].id, status: 'lost' })
  assert.equal(d.labelsPending().length, 0)
  const nb = book(d, { title: 'ج' })
  d.archiveBook(nb)
  assert.equal(d.labelsPending().length, 0)

  assert.equal(d.cardsFor().length, 2)
  assert.deepEqual(d.cardsFor([m1]).map((c) => c.name), ['عضو 1'])
  d.archiveMember(m1)
  assert.equal(d.cardsFor().length, 1)

  const l = d.borrow({ member_id: 2, book_id: a })
  setDue(d, l.id, "date('now','localtime','-2 days')")
  assert.equal(d.allOverdue().length, 1)
  assert.equal(d.allOverdue()[0].days_late, 2)
})

test('تفاصيل الكتاب والعضو تتضمن الحجوزات والغرامات، والإحصائيات تتضمن الجاهز والغرامات', () => {
  const d = fresh()
  const [a, b] = ['أ', 'ب'].map((n) => member(d, n))
  const bk = book(d)
  const l = d.borrow({ member_id: a, book_id: bk })
  d.reserve({ book_id: bk, member_id: b })
  d.addFine({ member_id: b, amount: 90, reason: 'تلف' })
  assert.equal(d.getBook(bk).reservations.length, 1)
  assert.equal(d.getMember(b).reservations[0].title, 'ك')
  assert.equal(d.getMember(b).fines[0].amount, 90)
  d.returnLoan(l.id)
  const s = d.stats()
  assert.equal(s.unpaidFines, 90)
  assert.equal(s.readyList[0].member_name, 'ب')
})
