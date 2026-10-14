const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createDb } = require('../electron/db')

const fresh = () => createDb(':memory:')
const off = (n) => `date('now','localtime','${n} days')`

/** ينشئ إعارة بتواريخ نسبية لليوم (قيم سالبة = في الماضي). ret=null تعني مفتوحة. */
function loan(d, bookId, memberId, loanOff, dueOff, retOff = null) {
  const copy = d.raw.prepare('SELECT id FROM copies WHERE book_id = ? ORDER BY id LIMIT 1').get(bookId).id
  d.raw
    .prepare(
      `INSERT INTO loans (book_id, member_id, copy_id, loan_date, due_date, return_date)
       VALUES (?, ?, ?, ${off(loanOff)}, ${off(dueOff)}, ${retOff === null ? 'NULL' : off(retOff)})`
    )
    .run(bookId, memberId, copy)
}

function scenario() {
  const d = fresh()
  const b1 = d.saveBook({ title: 'الأكثر استعارة', author: 'أ', category: 'رواية', copies: 1 })
  const b2 = d.saveBook({ title: 'ثاني', author: 'ب', category: 'علوم', copies: 1 })
  const b3 = d.saveBook({ title: 'قديم جامد', author: 'ج', copies: 1 })           // بلا تصنيف
  const b4 = d.saveBook({ title: 'لم يُستعر أبدًا', author: 'د', copies: 1 })
  const m1 = d.saveMember({ name: 'نشيط' })
  const m2 = d.saveMember({ name: 'عادي' })
  loan(d, b1, m1, -40, -26, -30) // في الموعد، 10 أيام
  loan(d, b1, m2, -20, -6, -2)   // متأخرة 4 أيام، 18 يومًا
  loan(d, b2, m1, -10, 4, -1)    // في الموعد، 9 أيام
  loan(d, b1, m1, -5, -1)        // مفتوحة ومتأخرة
  loan(d, b3, m2, -400, -386, -390) // خارج الفترة وخارج الاثني عشر شهرًا
  const old = d.raw.prepare("UPDATE books SET created_at = date('now','localtime','-500 days') WHERE id = ?")
  old.run(b3); old.run(b4)
  return { d, b1, b2, b3, b4, m1, m2 }
}

test('التقارير: الملخص لفترة 90 يومًا', () => {
  const { d } = scenario()
  const r = d.reports({ days: 90 })
  assert.equal(r.days, 90)
  assert.equal(r.summary.loans, 4)        // الخامسة خارج الفترة
  assert.equal(r.summary.returns, 3)
  assert.equal(r.summary.avgLoanDays, 12.3) // (10+18+9)/3
  assert.equal(r.summary.lateRate, 33)      // 1 من 3
  assert.equal(r.summary.overdueNow, 1)
})

test('التقارير: الفترة «الكل» تشمل كل التاريخ', () => {
  const { d } = scenario()
  const r = d.reports({ days: 'all' })
  assert.equal(r.days, null)
  assert.equal(r.summary.loans, 5)
  assert.equal(r.summary.returns, 4)
  assert.equal(d.reports({ days: null }).summary.loans, 5)
})

test('التقارير: الأكثر استعارة (كتب وأعضاء) والتصنيفات بالترتيب', () => {
  const { d } = scenario()
  const r = d.reports({ days: 90 })
  assert.deepEqual(r.topBooks.map((b) => [b.title, b.n]), [['الأكثر استعارة', 3], ['ثاني', 1]])
  assert.deepEqual(r.topMembers.map((m) => [m.name, m.n]), [['نشيط', 3], ['عادي', 1]])
  assert.deepEqual(r.byCategory.map((c) => [c.name, c.n]), [['رواية', 3], ['علوم', 1]])
})

test('التقارير: السلسلة الشهرية 12 شهرًا مرتبة بالأصفار وتنتهي بالشهر الحالي', () => {
  const { d } = scenario()
  const r = d.reports({ days: 90 })
  assert.equal(r.monthly.length, 12)
  const now = d.raw.prepare("SELECT strftime('%Y-%m','now','localtime') m").get().m
  assert.equal(r.monthly[11].month, now)
  assert.deepEqual(r.monthly.map((m) => m.month), [...r.monthly.map((m) => m.month)].sort())
  assert.equal(new Set(r.monthly.map((m) => m.month)).size, 12)
  assert.equal(r.monthly.reduce((a, m) => a + m.n, 0), 4) // إعارة قبل 400 يوم خارج النافذة
  // الفترة المختارة لا تغيّر السلسلة الشهرية
  assert.deepEqual(d.reports({ days: 30 }).monthly, r.monthly)
})

test('التقارير: الكتب الراكدة (لم تُستعر في الفترة، وأقدم من الفترة)', () => {
  const { d, b3, b4 } = scenario()
  const r = d.reports({ days: 90 })
  assert.equal(r.idle.count, 2)
  assert.deepEqual(r.idle.sample.map((b) => b.id).sort(), [b3, b4].sort())
  const all = d.reports({ days: 'all' }) // «لم يُستعر أبدًا» فقط
  assert.deepEqual(all.idle.sample.map((b) => b.id), [b4])
  // كتاب أُضيف اليوم لا يُعدّ راكدًا
  d.saveBook({ title: 'جديد اليوم', author: 'هـ', copies: 1 })
  assert.equal(d.reports({ days: 90 }).idle.count, 2)
})

test('التقارير: الغرامات المفروضة والمحصَّلة والمعفاة', () => {
  const { d, m1 } = scenario()
  const f1 = d.addFine({ member_id: m1, amount: 100, reason: 'أ' })
  const f2 = d.addFine({ member_id: m1, amount: 50, reason: 'ب' })
  const f3 = d.addFine({ member_id: m1, amount: 30, reason: 'ج' })
  d.payFine(f2)
  d.waiveFine(f3)
  const s = d.reports({ days: 30 }).summary
  assert.equal(s.finesCharged, 180)
  assert.equal(s.finesCollected, 50)
  assert.equal(s.finesWaived, 30)
  assert.ok(f1)
})

test('التقارير: قاعدة فارغة تعطي أصفارًا دون أخطاء', () => {
  const r = fresh().reports({ days: 90 })
  assert.deepEqual(r.summary, { loans: 0, returns: 0, avgLoanDays: 0, lateRate: 0, overdueNow: 0, finesCharged: 0, finesCollected: 0, finesWaived: 0 })
  assert.equal(r.monthly.length, 12)
  assert.deepEqual(r.topBooks, [])
  assert.equal(r.idle.count, 0)
})

test('التقارير: مدخلات غير صالحة تُقيَّد بدل أن تفشل', () => {
  const { d } = scenario()
  assert.equal(d.reports({ days: 'abc' }).days, 90)
  assert.equal(d.reports({ days: -5 }).days, 1) // أدنى حد يوم واحد
  assert.equal(d.reports({ days: 99999 }).days, 3650)
  assert.equal(d.reports({ days: 0 }).days, 90) // parseInt(0)||90
})

test('وضع القارئ: بحث عربي مطبَّع بلا أي بيانات شخصية', () => {
  const d = fresh()
  const b = d.saveBook({ title: 'الإسلام والحضارة', author: 'محمد', category: 'فكر', shelf: 'A-3', copies: 2 })
  const m = d.saveMember({ name: 'سر العضو', phone: '0555000111', email: 'secret@example.com' })
  d.borrow({ member_id: m, book_id: b })
  assert.deepEqual(d.kioskSearch('ا'), [])        // أقل من حرفين
  assert.deepEqual(d.kioskSearch(''), [])
  const r = d.kioskSearch('الاسلام')
  assert.equal(r.length, 1)
  assert.deepEqual(Object.keys(r[0]).sort(), ['author', 'available', 'category', 'copies', 'id', 'shelf', 'title', 'year'])
  assert.equal(r[0].available, 1)
  assert.equal(r[0].shelf, 'A-3')
  const dump = JSON.stringify(d.kioskSearch('الاسلام'))
  assert.ok(!dump.includes('سر العضو') && !dump.includes('0555') && !dump.includes('secret'))
  // المؤرشف لا يظهر
  d.returnLoan(1)
  d.archiveBook(b)
  assert.equal(d.kioskSearch('الاسلام').length, 0)
})
