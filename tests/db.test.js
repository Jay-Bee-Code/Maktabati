const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3')
const { createDb, SCHEMA_VERSION, isbnValid } = require('../electron/db')
const backup = require('../electron/backup')

const fresh = () => createDb(':memory:')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'))
const code = (fn) => { try { fn() } catch (e) { return e.code } }

test('ISBN: المجموع الاختباري', () => {
  assert.ok(isbnValid('9780306406157'))
  assert.ok(isbnValid('0306406152'))
  assert.ok(!isbnValid('9780306406158'))
  assert.ok(!isbnValid('12345'))
})

test('الترحيل من الإصدار 1: يحفظ البيانات ويعالج ISBN المكرر ويستدعي نسخة الأمان', () => {
  const dir = tmp()
  const file = path.join(dir, 'old.db')
  const old = new Database(file)
  old.exec(`
    CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, author TEXT NOT NULL, isbn TEXT,
      category TEXT, year INTEGER, copies INTEGER NOT NULL DEFAULT 1, shelf TEXT, created_at TEXT NOT NULL DEFAULT (date('now')));
    CREATE TABLE members (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, joined_at TEXT NOT NULL DEFAULT (date('now')));
    CREATE TABLE loans (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL, member_id INTEGER NOT NULL, loan_date TEXT NOT NULL, due_date TEXT NOT NULL, return_date TEXT);
    INSERT INTO books (title, author, isbn, copies) VALUES ('أ','x','978-0-306-40615-7',2), ('ب','y','9780306406157',1), ('ج','z',NULL,1);
    INSERT INTO members (name) VALUES ('عضو قديم');
    INSERT INTO loans (book_id, member_id, loan_date, due_date) VALUES (1,1,'2026-01-01','2026-01-15');
  `)
  old.close()
  let hooked = null
  const d = createDb(file, { onBeforeMigrate: (from) => (hooked = from) })
  assert.equal(hooked, 0)
  assert.equal(d.raw.pragma('user_version', { simple: true }), SCHEMA_VERSION)
  const { rows, total } = d.listBooks({})
  assert.equal(total, 3)
  assert.equal(rows.find((r) => r.title === 'أ').isbn, '9780306406157')
  assert.match(rows.find((r) => r.title === 'ب').isbn, /#dup/)
  // v3: نسخ بباركود، والإعارة الجارية ربطت بنسخة، وبطاقة العضو
  const copies = d.raw.prepare('SELECT book_id, barcode FROM copies ORDER BY id').all()
  assert.deepEqual(copies.map((c) => c.barcode), ['B00001-1', 'B00001-2', 'B00002-1', 'B00003-1'])
  assert.equal(d.raw.prepare('SELECT copy_id FROM loans WHERE id = 1').get().copy_id, 1)
  assert.equal(d.raw.prepare('SELECT card_no FROM members WHERE id = 1').get().card_no, 'M00001')
  assert.equal(rows.find((r) => r.title === 'أ').copies, 2)
  assert.equal(rows.find((r) => r.title === 'أ').available, 1)
  // إعادة الفتح لا تعيد الترحيل
  d.raw.close()
  hooked = null
  createDb(file, { onBeforeMigrate: (f) => (hooked = f) }).raw.close()
  assert.equal(hooked, null)
})

test('قاعدة أحدث من التطبيق ترفض الفتح', () => {
  const dir = tmp()
  const file = path.join(dir, 'new.db')
  const x = new Database(file)
  x.pragma(`user_version = ${SCHEMA_VERSION + 5}`)
  x.close()
  assert.throws(() => createDb(file), /أحدث/)
})

test('ISBN: تحقق وتكرار وإضافة نسخة', () => {
  const d = fresh()
  assert.equal(code(() => d.saveBook({ title: 'ت', author: 'م', isbn: '9780306406158', copies: 1 })), 'BAD_ISBN')
  const id = d.saveBook({ title: 'ت', author: 'م', isbn: '978-0-306-40615-7', copies: 1 })
  let info
  try { d.saveBook({ title: 'نسخة', author: 'م', isbn: '9780306406157', copies: 1 }) } catch (e) { assert.equal(e.code, 'DUP_ISBN'); info = e.info }
  assert.equal(info.id, id)
  assert.equal(d.addCopy(id).copies, 2)
  // تعديل الكتاب نفسه بالـ ISBN نفسه مسموح
  d.saveBook({ id, title: 'ت2', author: 'م', isbn: '9780306406157', copies: 2 })
})

test('الأرشفة والاسترجاع، وبعد الأرشفة يُسمح بإعادة استعمال ISBN', () => {
  const d = fresh()
  const id = d.saveBook({ title: 'ك', author: 'م', isbn: '9780306406157', copies: 1 })
  d.archiveBook(id)
  assert.equal(d.listBooks({}).total, 0)
  assert.equal(d.listBooks({ archived: true }).total, 1)
  const id2 = d.saveBook({ title: 'ك2', author: 'م', isbn: '9780306406157', copies: 1 })
  assert.throws(() => d.restoreBook(id), /ISBN/)
  d.archiveBook(id2)
  d.restoreBook(id)
  assert.equal(d.listBooks({}).total, 1)
})

test('قواعد الإعارة والأرشفة', () => {
  const d = fresh()
  const b = d.saveBook({ title: 'ك', author: 'م', copies: 1 })
  const m = d.saveMember({ name: 'ع' })
  const m2 = d.saveMember({ name: 'ع2' })
  const loan = d.borrow({ book_id: b, member_id: m, days: 7 }).id
  assert.throws(() => d.borrow({ book_id: b, member_id: m2 }), /متاحة/)
  assert.throws(() => d.archiveBook(b), /معارة/)
  assert.throws(() => d.archiveMember(m), /لم يُرجعها/)
  assert.equal(d.searchBooks('').length, 0)
  d.returnLoan(loan)
  assert.throws(() => d.returnLoan(loan))
  d.archiveMember(m2)
  assert.throws(() => d.borrow({ book_id: b, member_id: m2 }), /مؤرشف/)
  assert.equal(d.searchMembers('').length, 1)
})

test('حد الإعارات للعضو', () => {
  const d = fresh()
  const m = d.saveMember({ name: 'ع' })
  for (let i = 0; i < 5; i++) d.borrow({ book_id: d.saveBook({ title: 'ك' + i, author: 'م', copies: 1 }), member_id: m })
  assert.throws(() => d.borrow({ book_id: d.saveBook({ title: 'زائد', author: 'م', copies: 1 }), member_id: m }), /الحد الأقصى/)
})

test('ترقيم الصفحات والبحث والتأخير', () => {
  const d = fresh()
  for (let i = 1; i <= 30; i++) d.saveBook({ title: 'كتاب ' + i, author: i % 2 ? 'فرد' : 'زوج', copies: 1 })
  const p1 = d.listBooks({ page: 1, pageSize: 10 })
  const p3 = d.listBooks({ page: 3, pageSize: 10 })
  assert.equal(p1.total, 30)
  assert.equal(p1.rows.length, 10)
  assert.equal(p3.rows.length, 10)
  assert.equal(d.listBooks({ search: 'زوج', pageSize: 100 }).total, 15)
  const m = d.saveMember({ name: 'ع' })
  const l = d.borrow({ book_id: 1, member_id: m }).id
  d.raw.prepare("UPDATE loans SET due_date = date('now','-4 days') WHERE id = ?").run(l)
  const s = d.stats()
  assert.equal(s.overdue, 1)
  assert.equal(s.overdueList[0].days_late, 4)
  assert.equal(d.listLoans({ status: 'overdue' }).total, 1)
})

test('المستخدمون: إنشاء ودخول وحماية آخر مدير', () => {
  const d = fresh()
  assert.ok(!d.hasUsers())
  assert.throws(() => d.createUser({ username: 'ab', display_name: 'س', role: 'admin', password: '12345678' }), /3 إلى 32/)
  assert.throws(() => d.createUser({ username: 'admin', display_name: 'س', role: 'admin', password: '123' }), /8 أحرف/)
  const a = d.createUser({ username: 'Admin', display_name: 'المدير', role: 'admin', password: 'secret-pass' })
  assert.throws(() => d.createUser({ username: 'admin', display_name: 'س', role: 'librarian', password: 'secret-pass' }), /مستعمل/)
  assert.equal(d.authenticate('ADMIN', 'secret-pass').role, 'admin')
  assert.equal(d.authenticate('admin', 'wrong'), null)
  assert.equal(d.authenticate('nobody', 'x'), null)
  assert.throws(() => d.updateUser({ id: a, display_name: 'م', role: 'librarian', active: 1 }), /مدير نشط/)
  assert.throws(() => d.updateUser({ id: a, display_name: 'م', role: 'admin', active: 0 }), /مدير نشط/)
  const l = d.createUser({ username: 'amin', display_name: 'أمين', role: 'librarian', password: 'secret-pass' })
  d.updateUser({ id: l, display_name: 'أمين', role: 'librarian', active: 0 })
  assert.equal(d.authenticate('amin', 'secret-pass'), null)
  d.updateUser({ id: a, display_name: 'م', role: 'admin', active: 1 })
  assert.throws(() => d.changePassword(a, 'bad', 'new-password1'), /غير صحيحة/)
  d.changePassword(a, 'secret-pass', 'new-password1')
  assert.ok(d.authenticate('admin', 'new-password1'))
})

test('النسخ الاحتياطي: إنشاء وتحقق وتنظيف', () => {
  const dir = tmp()
  const live = path.join(dir, 'live.db')
  const d = createDb(live)
  d.saveBook({ title: 'ك', author: 'م', copies: 1 })
  const bdir = path.join(dir, 'backups')
  const f = backup.auto(d.raw, bdir)
  assert.ok(backup.hasToday(bdir))
  const v = backup.validate(f, SCHEMA_VERSION)
  assert.ok(v.ok)
  assert.equal(v.books, 1)
  assert.equal(backup.list(bdir)[0].kind, 'تلقائية')
  // ملف غير صالح
  const junk = path.join(dir, 'junk.db')
  fs.writeFileSync(junk, 'not a database at all')
  assert.ok(!backup.validate(junk, SCHEMA_VERSION).ok)
  // قاعدة بدون جداول التطبيق
  const other = path.join(dir, 'other.db')
  const o = new Database(other); o.exec('CREATE TABLE t(x)'); o.close()
  assert.match(backup.validate(other, SCHEMA_VERSION).error, /ليس نسخة/)
  // التنظيف يحتفظ بالأحدث
  for (let i = 0; i < 5; i++) {
    const p = path.join(bdir, `auto-2020-01-0${i + 1}.db`)
    fs.copyFileSync(f, p)
    fs.utimesSync(p, new Date(2020, 0, i + 1), new Date(2020, 0, i + 1))
  }
  backup.prune(bdir, 'auto-', 3)
  assert.equal(backup.list(bdir).length, 3)
  assert.ok(backup.hasToday(bdir)) // الأحدث بقيت
})
