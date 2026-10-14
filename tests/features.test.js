const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createDb, arnorm } = require('../electron/db')

const fresh = () => createDb(':memory:')
const book = (d, o = {}) => d.saveBook({ title: 'ك', author: 'م', copies: 1, ...o })

test('تطبيع النص العربي', () => {
  assert.equal(arnorm('الإِسْلام'), arnorm('الاسلام'))
  assert.equal(arnorm('أحمد'), arnorm('احمد'))
  assert.equal(arnorm('مدرسة'), arnorm('مدرسه'))
  assert.equal(arnorm('مُحَمَّد'), 'محمد')
  assert.equal(arnorm('كتــاب'), 'كتاب')
  assert.equal(arnorm('على'), arnorm('علي'))
  assert.equal(arnorm('رقم ١٢٣ و ۴۵۶'), 'رقم 123 و 456')
  assert.equal(arnorm('  Café   Noir '), 'cafe noir')
  assert.equal(arnorm(null), '')
})

test('البحث العربي: بدون همزات وتشكيل، وبدون أن يطابق % كل شيء', () => {
  const d = fresh()
  book(d, { title: 'الإسلام والحضارة', author: 'مُحَمَّد عبده', category: 'فكر', shelf: 'A-1' })
  book(d, { title: 'مدرسة الأمل', author: 'سارة' })
  book(d, { title: 'نسبة 50% من الأرباح', author: 'ع' })
  const n = (q) => d.listBooks({ search: q }).total
  assert.equal(n('الاسلام'), 1)
  assert.equal(n('اسلام'), 1)
  assert.equal(n('محمد'), 1)
  assert.equal(n('مدرسه'), 1)
  assert.equal(n('%'), 1)       // تُعامل كحرف عادي لا كحرف بدل
  assert.equal(n('_'), 0)
  assert.equal(n('فكر'), 1)
  assert.equal(n('a-1'), 1)
  const id = book(d, { title: 'x', author: 'y', isbn: '978-0-306-40615-7' })
  assert.equal(n('9780306406157'), 1)
  assert.equal(n('978-0-306'), 1)
  assert.ok(id)
})

test('نسخ بباركود: الإعارة بالباركود وبالكتاب', () => {
  const d = fresh()
  const b = book(d, { copies: 2 })
  const m = d.saveMember({ name: 'ع' })
  const m2 = d.saveMember({ name: 'ع2' })
  const l1 = d.borrow({ member_id: m, barcode: 'b00001-2' })
  assert.equal(l1.barcode, 'B00001-2')
  assert.throws(() => d.borrow({ member_id: m2, barcode: 'B00001-2' }), /معارة حاليًا/)
  assert.throws(() => d.borrow({ member_id: m2, barcode: 'B99999-1' }), /غير معروف/)
  const l2 = d.borrow({ member_id: m2, book_id: b })
  assert.equal(l2.barcode, 'B00001-1') // النسخة الحرة المتبقية
  assert.throws(() => d.borrow({ member_id: d.saveMember({ name: 'ثالث' }), book_id: b }), /متاحة/)
  assert.equal(d.getBook(b).book.available, 0)
})

test('حالة النسخة: التالفة والمفقودة لا تُعار ولا تُحسب متاحة', () => {
  const d = fresh()
  const b = book(d, { copies: 3 })
  const m = d.saveMember({ name: 'ع' })
  const { copies } = d.getBook(b)
  d.setCopyStatus({ id: copies[0].id, status: 'damaged' })
  d.setCopyStatus({ id: copies[1].id, status: 'lost' })
  let v = d.getBook(b).book
  assert.equal(v.copies, 2)     // المفقودة لا تُحسب
  assert.equal(v.available, 1)  // السليمة الحرة فقط
  assert.throws(() => d.borrow({ member_id: m, barcode: copies[0].barcode }), /تالفة/)
  assert.throws(() => d.borrow({ member_id: m, barcode: copies[1].barcode }), /مفقودة/)
  const loan = d.borrow({ member_id: m, book_id: b })
  assert.equal(loan.barcode, copies[2].barcode)
  assert.throws(() => d.setCopyStatus({ id: copies[2].id, status: 'lost' }), /معارة/)
  assert.throws(() => d.setCopyStatus({ id: copies[2].id, status: 'weird' }), /غير صالحة/)
  d.returnLoan(loan.id)
  d.setCopyStatus({ id: copies[0].id, status: 'ok' })
  assert.equal(d.getBook(b).book.available, 2)
  assert.equal(d.addCopy(b).barcode, 'B00001-4')
})

test('الإعدادات: القيم الافتراضية والتحقق وتأثيرها على الإعارة', () => {
  const d = fresh()
  assert.deepEqual(d.getSettings(), {
    library_name: 'تسيير المكتبة', default_loan_days: 14, max_loans: 5, max_renewals: 2,
    fine_per_day: 0, fine_cap: 0, fine_block_limit: 0, currency: 'دج', hold_days: 3, language: 'ar',
  })
  assert.throws(() => d.saveSettings({ library_name: '', default_loan_days: 14, max_loans: 5 }), /اسم المكتبة/)
  assert.throws(() => d.saveSettings({ library_name: 'م', default_loan_days: 0, max_loans: 5 }), /المدة/)
  assert.throws(() => d.saveSettings({ library_name: 'م', default_loan_days: 14, max_loans: 99 }), /الحد/)
  d.saveSettings({ library_name: 'مكتبة الأمل', default_loan_days: 21, max_loans: 2 })
  assert.equal(d.getSettings().library_name, 'مكتبة الأمل')
  const m = d.saveMember({ name: 'ع' })
  const l = d.borrow({ member_id: m, book_id: book(d, { title: 'أ' }) }) // بدون days: الافتراضي 21
  const days = d.raw.prepare("SELECT CAST(julianday(due_date) - julianday(loan_date) AS INTEGER) n FROM loans WHERE id = ?").get(l.id).n
  assert.equal(days, 21)
  d.borrow({ member_id: m, book_id: book(d, { title: 'ب' }) })
  assert.throws(() => d.borrow({ member_id: m, book_id: book(d, { title: 'ج' }) }), /الحد الأقصى \(2/)
})

test('بطاقة العضو: تلقائية وفريدة وتبقى عند التعديل', () => {
  const d = fresh()
  const a = d.saveMember({ name: 'أ' })
  assert.equal(d.getMember(a).member.card_no, 'M00001')
  const b = d.saveMember({ name: 'ب', card_no: 'lib-77' })
  assert.equal(d.getMember(b).member.card_no, 'LIB-77')
  assert.throws(() => d.saveMember({ name: 'ج', card_no: 'LIB-77' }), /مستعمل/)
  d.saveMember({ id: a, name: 'أ معدل', card_no: '' })
  assert.equal(d.getMember(a).member.card_no, 'M00001')
  assert.throws(() => d.saveMember({ name: 'د', email: 'bad' }), /البريد/)
  assert.equal(d.searchMembers('m00001')[0].id, a)
})

test('تفاصيل الكتاب والعضو والبحث الشامل والإعارات المفتوحة', () => {
  const d = fresh()
  const b = book(d, { title: 'كتاب التفاصيل', copies: 2 })
  const m = d.saveMember({ name: 'قارئ نهم' })
  const l = d.borrow({ member_id: m, book_id: b })
  d.raw.prepare("UPDATE loans SET due_date = date('now','-3 days') WHERE id = ?").run(l.id)

  const bk = d.getBook(b)
  assert.equal(bk.copies.filter((c) => c.loan_id).length, 1)
  assert.equal(bk.copies.find((c) => c.loan_id).member_name, 'قارئ نهم')
  assert.equal(bk.history.length, 1)

  const mm = d.getMember(m)
  assert.equal(mm.open.length, 1)
  assert.equal(mm.open[0].status, 'overdue')
  assert.equal(mm.total, 1)

  const all = d.searchAll('التفاصيل')
  assert.equal(all.books.length, 1)
  assert.equal(d.searchAll('قارئ').members.length, 1)

  assert.equal(d.searchOpenLoans('B00001-1').length + d.searchOpenLoans('B00001-2').length, 1) // بالباركود
  assert.equal(d.searchOpenLoans('M00001').length, 1)                                       // ببطاقة العضو
  assert.equal(d.searchOpenLoans('التفاصيل').length, 1)

  const r = d.returnLoan(l.id)
  assert.equal(r.days_late, 3)
  assert.equal(d.searchOpenLoans('التفاصيل').length, 0)
  assert.throws(() => d.getBook(999), /غير موجود/)
})

test('الاستيراد: معاينة الكتب (جديد/مكرر/خطأ) ثم الإدخال بوضعين', () => {
  const d = fresh()
  book(d, { title: 'موجود', isbn: '9780306406157' })
  const rows = [
    { _row: 2, title: 'جديد', author: 'أ', isbn: '0306406152', copies: 2 },
    { _row: 3, title: 'مكرر بالقاعدة', author: 'ب', isbn: '978-0-306-40615-7', copies: 3 },
    { _row: 4, title: '', author: 'ج' },
    { _row: 5, title: 'ISBN سيئ', author: 'د', isbn: '123' },
    { _row: 6, title: 'مكرر داخل الملف', author: 'هـ', isbn: '0306406152' },
    { _row: 7, title: 'بلا isbn', author: 'و' },
  ]
  const pv = d.previewBooks(rows)
  assert.deepEqual(pv.map((p) => p.status), ['new', 'duplicate', 'invalid', 'invalid', 'duplicate', 'new'])
  assert.equal(pv[2].row, 4)
  assert.match(pv[3].error, /ISBN/)

  const r1 = d.importBooks(rows, 'skip')
  assert.deepEqual(r1, { created: 2, copiesAdded: 0, skipped: 2, invalid: 2 })
  assert.equal(d.listBooks({}).total, 3)

  const d2 = fresh()
  book(d2, { title: 'موجود', isbn: '9780306406157' })
  const r2 = d2.importBooks(rows, 'copies')
  assert.deepEqual(r2, { created: 2, copiesAdded: 3 + 1, skipped: 0, invalid: 2 })
  assert.equal(d2.getBook(1).book.copies, 1 + 3)
})

test('الاستيراد: الأعضاء (تكرار بالاسم والهاتف وبالبطاقة)', () => {
  const d = fresh()
  d.saveMember({ name: 'أحمد', phone: '0555' })
  const rows = [
    { name: 'احمد', phone: '0555' },       // نفس الاسم بعد التطبيع
    { name: 'سارة', phone: '0666' },
    { name: 'سارة', phone: '0666' },       // تكرار داخل الملف
    { name: '' },
    { name: 'ليلى', email: 'bad' },
  ]
  assert.deepEqual(d.previewMembers(rows).map((p) => p.status), ['duplicate', 'new', 'duplicate', 'invalid', 'invalid'])
  assert.deepEqual(d.importMembers(rows), { created: 1, skipped: 2, invalid: 2 })
  assert.equal(d.listMembers({}).total, 2)
})

test('الإحصائيات تحترم حالة النسخ', () => {
  const d = fresh()
  const b = book(d, { copies: 3 })
  d.setCopyStatus({ id: d.getBook(b).copies[0].id, status: 'lost' })
  d.borrow({ member_id: d.saveMember({ name: 'ع' }), book_id: b })
  const s = d.stats()
  assert.equal(s.copies, 2)
  assert.equal(s.available, 1)
  assert.equal(s.active, 1)
})

test('نسخة الواجهة من تطبيع النص مطابقة لنسخة الخادم', async () => {
  const { norm } = await import('../src/text.js')
  for (const s of ['الإِسْلام', 'أحمد', 'مدرسة', 'مُحَمَّد', 'كتــاب', 'على', 'رقم ١٢٣ و ۴۵۶', '  Café   Noir ', 'ٱلله', 'کتاب', 'ی', '', null])
    assert.equal(norm(s), arnorm(s), String(s))
})
