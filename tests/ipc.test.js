const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createDb } = require('../electron/db')
const { createHandlers } = require('../electron/handlers')
const backup = require('../electron/backup')

function setup(dialogResult, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-'))
  const dbPath = path.join(dir, 'library.db')
  const backupDir = path.join(dir, 'backups')
  const dialog = {
    showSaveDialog: async () => dialogResult ?? { canceled: true },
    showOpenDialog: async () => dialogResult ?? { canceled: true },
  }
  const h = createHandlers({
    dbPath, backupDir, dialog, shell: extra.shell ?? { openPath: async () => '' }, getWindow: () => extra.win ?? null,
    openDb: () => createDb(dbPath, { onBeforeMigrate: (from, raw) => backup.make(raw, path.join(backupDir, `pre-migration-v${from}.db`)) }),
  })
  const call = async (ch, p) => h.invoke(ch, p)
  return { h, call, dir, dbPath, backupDir }
}

test('بدون جلسة: كل قناة محمية ترفض برمز AUTH، والقنوات العامة تعمل', async () => {
  const { call } = setup()
  const st = await call('auth:status')
  assert.deepEqual(st.data, { hasUsers: false, user: null })
  const r = await call('books:list', {})
  assert.equal(r.ok, false)
  assert.equal(r.code, 'AUTH')
  assert.equal((await call('no:such')).ok, false)
})

test('الإعداد الأول: ينشئ المدير مرة واحدة فقط', async () => {
  const { call } = setup()
  const a = await call('auth:setup', { username: 'admin', display_name: 'المدير', password: 'secret-pass' })
  assert.equal(a.data.role, 'admin')
  const again = await call('auth:setup', { username: 'x1x', display_name: 'س', password: 'secret-pass' })
  assert.equal(again.ok, false)
  assert.equal((await call('books:list', {})).ok, true)
})

test('الصلاحيات: أمين المكتبة لا يؤرشف ولا يدير المستخدمين والنسخ', async () => {
  const { call } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'المدير', password: 'secret-pass' })
  await call('users:save', { username: 'amin', display_name: 'أمين', role: 'librarian', password: 'secret-pass' })
  const bookId = (await call('books:save', { title: 'ك', author: 'م', copies: 1 })).data
  await call('auth:logout')
  await call('auth:login', { username: 'amin', password: 'secret-pass' })
  assert.equal((await call('books:save', { title: 'ك2', author: 'م', copies: 1 })).ok, true)
  for (const [ch, p] of [['books:archive', bookId], ['members:archive', 1], ['users:list'], ['backup:list'], ['backup:create']]) {
    const r = await call(ch, p)
    assert.equal(r.ok, false, ch)
    assert.equal(r.code, 'FORBIDDEN', ch)
  }
})

test('قفل الدخول بعد 5 محاولات فاشلة', async () => {
  const { call } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  await call('auth:logout')
  for (let i = 0; i < 5; i++) assert.equal((await call('auth:login', { username: 'admin', password: 'bad' })).ok, false)
  const locked = await call('auth:login', { username: 'admin', password: 'secret-pass' })
  assert.equal(locked.code, 'LOCKED')
})

test('إيقاف حساب أثناء جلسته يُسقط الجلسة فورًا', async () => {
  const { call, h } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  const id = (await call('users:save', { username: 'amin', display_name: 'أ', role: 'librarian', password: 'secret-pass' })).data
  await call('auth:logout')
  await call('auth:login', { username: 'amin', password: 'secret-pass' })
  h.getDb().updateUser({ id, display_name: 'أ', role: 'librarian', active: 0 })
  const r = await call('books:list', {})
  assert.equal(r.code, 'AUTH')
})

test('المدير لا يوقف نفسه ولا يخفض صلاحيته', async () => {
  const { call } = setup()
  const me = (await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })).data
  assert.equal((await call('users:save', { id: me.id, display_name: 'م', role: 'admin', active: 0 })).ok, false)
  assert.equal((await call('users:save', { id: me.id, display_name: 'م', role: 'librarian', active: 1 })).ok, false)
})

test('النسخ والاسترجاع الحقيقيان: البيانات ترجع، الجلسة تُغلق، نسخة أمان تُحفظ', async () => {
  const { call, backupDir, h } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  await call('books:save', { title: 'قبل', author: 'م', copies: 1 })
  const name = (await call('backup:create')).data.name
  await call('books:save', { title: 'بعد', author: 'م', copies: 1 })
  assert.equal((await call('books:list', {})).data.total, 2)

  assert.equal((await call('backup:restore', { name: '../evil.db' })).ok, false) // منع اجتياز المسار
  const r = await call('backup:restore', { name })
  assert.equal(r.ok, true)
  assert.ok(fs.readdirSync(backupDir).some((f) => f.startsWith('pre-restore-')))
  assert.equal((await call('books:list', {})).code, 'AUTH') // الجلسة أُغلقت
  await call('auth:login', { username: 'admin', password: 'secret-pass' })
  const list = (await call('books:list', {})).data
  assert.equal(list.total, 1)
  assert.equal(list.rows[0].title, 'قبل')
  h.shutdown()
})

test('استرجاع ملف تالف يُرفض دون المساس بالبيانات', async () => {
  const junk = path.join(os.tmpdir(), 'junk-' + Date.now() + '.db')
  fs.writeFileSync(junk, 'garbage')
  const { call } = setup({ canceled: false, filePaths: [junk] })
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  await call('books:save', { title: 'باقٍ', author: 'م', copies: 1 })
  const r = await call('backup:restoreFile')
  assert.equal(r.ok, false)
  assert.equal((await call('books:list', {})).data.total, 1)
})

test('التصدير يكتب نسخة صالحة في المسار المختار', async () => {
  const out = path.join(os.tmpdir(), 'export-' + Date.now() + '.db')
  const { call } = setup({ canceled: false, filePath: out })
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  const r = await call('backup:export')
  assert.equal(r.data.filePath, out)
  assert.ok(backup.validate(out, 99).ok)
})

/* ---------- المرحلة الثانية ---------- */
const ExcelJS = require('exceljs')

test('الإعدادات: القراءة للجميع والحفظ للمدير فقط', async () => {
  const { call } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  await call('users:save', { username: 'amin', display_name: 'أ', role: 'librarian', password: 'secret-pass' })
  const s = { library_name: 'مكتبة الأمل', default_loan_days: 10, max_loans: 3 }
  assert.equal((await call('settings:save', s)).ok, true)
  await call('auth:logout')
  await call('auth:login', { username: 'amin', password: 'secret-pass' })
  assert.equal((await call('settings:get')).data.library_name, 'مكتبة الأمل')
  assert.equal((await call('settings:save', s)).code, 'FORBIDDEN')
  for (const ch of ['excel:export', 'excel:template', 'excel:pickImport', 'excel:commitImport'])
    assert.equal((await call(ch, { kind: 'books' })).code, 'FORBIDDEN', ch)
})

test('Excel: تصدير الكتب ثم استيراد الملف نفسه (دورة كاملة) + القالب', async () => {
  const out = path.join(os.tmpdir(), `books-${Date.now()}.xlsx`)
  const { call, h } = setup({ canceled: false, filePath: out, filePaths: [out] })
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  await call('books:save', { title: 'ثلاثية غرناطة', author: 'رضوى عاشور', isbn: '9780306406157', category: 'رواية', copies: 2 })
  await call('books:save', { title: 'بلا isbn', author: 'م', copies: 1 })

  const ex = await call('excel:export', { kind: 'books' })
  assert.equal(ex.data.count, 2)
  // الملف مقروء بعناوين عربية ومن اليمين لليسار
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(out)
  assert.equal(wb.worksheets[0].getRow(1).getCell(1).value, 'العنوان')
  assert.equal(wb.worksheets[0].views[0].rightToLeft, true)

  // استيراده يعطي: الأول مكرر (ISBN)، والثاني جديد (بلا ISBN)
  const pv = await call('excel:pickImport', { kind: 'books' })
  assert.deepEqual(pv.data.counts, { new: 1, duplicate: 1, invalid: 0 })
  assert.equal(pv.data.items[0].status, 'duplicate') // المشاكل أولًا
  const done = await call('excel:commitImport', { mode: 'copies' })
  assert.deepEqual(done.data, { created: 1, copiesAdded: 2, skipped: 0, invalid: 0 })
  assert.equal(h.getDb().listBooks({}).total, 3)
  // لا استيراد ثانٍ بلا معاينة جديدة
  assert.equal((await call('excel:commitImport', { mode: 'skip' })).ok, false)

  const tpl = path.join(os.tmpdir(), `tpl-${Date.now()}.xlsx`)
  const { call: call2 } = setup({ canceled: false, filePath: tpl })
  await call2('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  assert.equal((await call2('excel:template', { kind: 'members' })).ok, true)
  assert.ok(fs.existsSync(tpl))
})

test('Excel: ملف بأخطاء — عمود ناقص، أرقام ISBN، عناوين مختلفة', async () => {
  const file = path.join(os.tmpdir(), `bad-${Date.now()}.xlsx`)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('x')
  ws.addRow(['عنوان الكتاب', 'اسم المؤلف', 'isbn', 'النسخ'])
  ws.addRow(['ك1', 'م', 306406152, 2])        // ISBN-10 فقد الصفر الأول
  ws.addRow(['', 'م', '', 1])                   // عنوان فارغ
  ws.addRow([null, null, null, null])           // صف فارغ يُتجاهل
  ws.addRow(['ك3', 'م', '9780306406158', 1])    // مجموع اختباري خاطئ
  await wb.xlsx.writeFile(file)

  const { call } = setup({ canceled: false, filePaths: [file] })
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  const pv = (await call('excel:pickImport', { kind: 'books' })).data
  assert.deepEqual(pv.counts, { new: 1, duplicate: 0, invalid: 2 })
  assert.deepEqual(pv.items.filter((i) => i.status === 'invalid').map((i) => i.row), [3, 5]) // أرقام الصفوف في الملف

  const noCol = path.join(os.tmpdir(), `nocol-${Date.now()}.xlsx`)
  const wb2 = new ExcelJS.Workbook()
  wb2.addWorksheet('x').addRow(['شيء آخر', 'عمود'])
  await wb2.xlsx.writeFile(noCol)
  const { call: call3 } = setup({ canceled: false, filePaths: [noCol] })
  await call3('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  const r = await call3('excel:pickImport', { kind: 'books' })
  assert.equal(r.ok, false)
  assert.match(r.error, /العمود «العنوان»/)
})

test('Excel: استيراد الأعضاء من CSV', async () => {
  const file = path.join(os.tmpdir(), `m-${Date.now()}.csv`)
  fs.writeFileSync(file, 'الاسم,الهاتف,البريد\nسارة,0666,sara@example.com\nأحمد,0555,\n')
  const { call, h } = setup({ canceled: false, filePaths: [file] })
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  const pv = (await call('excel:pickImport', { kind: 'members' })).data
  assert.deepEqual(pv.counts, { new: 2, duplicate: 0, invalid: 0 })
  assert.deepEqual((await call('excel:commitImport', {})).data, { created: 2, skipped: 0, invalid: 0 })
  assert.equal(h.getDb().listMembers({}).rows[0].card_no.startsWith('M'), true)
})

/* ---------- المرحلة الثالثة ---------- */
test('الغرامات والتمديد والحجز: الصلاحيات (الإعفاء والإضافة للمدير فقط)', async () => {
  const { call } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  await call('users:save', { username: 'amin', display_name: 'أ', role: 'librarian', password: 'secret-pass' })
  await call('settings:save', { fine_per_day: 10 })
  const bk = (await call('books:save', { title: 'ك', author: 'م', copies: 1 })).data
  const m = (await call('members:save', { name: 'ع' })).data
  const fid = (await call('fines:add', { member_id: m, amount: 50, reason: 'تلف' })).data
  await call('auth:logout')
  await call('auth:login', { username: 'amin', password: 'secret-pass' })

  assert.equal((await call('fines:waive', fid)).code, 'FORBIDDEN')
  assert.equal((await call('fines:add', { member_id: m, amount: 5, reason: 'x' })).code, 'FORBIDDEN')
  assert.equal((await call('fines:list', { member_id: m })).data.sum, 50)
  assert.equal((await call('fines:pay', fid)).ok, true)

  const loan = (await call('loans:borrow', { member_id: m, book_id: bk })).data
  assert.equal((await call('loans:renew', loan.id)).data.renewals, 1)
  const m2 = (await call('members:save', { name: 'ب' })).data
  assert.equal((await call('reservations:create', { book_id: bk, member_id: m2 })).data.position, 1)
  const ret = (await call('loans:return', loan.id)).data
  assert.equal(ret.holdFor, 'ب')
  assert.equal((await call('reservations:ready')).data.length, 1)
})

test('الملصقات: قائمة غير المطبوعة ثم التعليم', async () => {
  const { call } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  await call('books:save', { title: 'ك', author: 'م', copies: 3 })
  const pending = (await call('labels:pending')).data
  assert.equal(pending.length, 3)
  assert.equal((await call('labels:mark', { ids: pending.slice(0, 2).map((x) => x.id) })).data, 2)
  assert.equal((await call('labels:pending')).data.length, 1)
  assert.equal((await call('labels:book', 1)).data.length, 3)
  assert.equal((await call('labels:mark', { ids: ['x'] })).ok, false)
  assert.equal((await call('cards:list', {})).data.length, 0)
})

test('print:pdf يكتب ملف PDF من نافذة التطبيق، ويحترم إلغاء الحوار', async () => {
  const out = path.join(os.tmpdir(), `p-${Date.now()}.pdf`)
  let opts
  const win = { webContents: { printToPDF: async (o) => { opts = o; return Buffer.from('%PDF-1.4 test') } } }
  const { call } = setup({ canceled: false, filePath: out }, { win })
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  const r = await call('print:pdf', { name: '../bad name!', landscape: true })
  assert.equal(r.data.filePath, out)
  assert.equal(fs.readFileSync(out, 'utf8'), '%PDF-1.4 test')
  assert.deepEqual(opts, { preferCSSPageSize: true, printBackground: true, landscape: true })

  const { call: c2 } = setup({ canceled: true }, { win })
  await c2('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  assert.equal((await c2('print:pdf', {})).data.canceled, true)
})

test('app:openMail: يقبل بريدًا صالحًا فقط ويبني رابط mailto مرمّزًا', async () => {
  const opened = []
  const { call } = setup(null, { shell: { openPath: async () => '', openExternal: async (u) => opened.push(u) } })
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  assert.equal((await call('app:openMail', { to: 'javascript:alert(1)' })).ok, false)
  assert.equal((await call('app:openMail', { to: 'a b@x.com' })).ok, false)
  assert.equal(opened.length, 0)
  const r = await call('app:openMail', { to: 'sara@example.com', subject: 'تذكير', body: 'سطر 1\nسطر 2 & ?' })
  assert.equal(r.ok, true)
  assert.match(opened[0], /^mailto:sara%40example\.com\?subject=/)
  assert.ok(!opened[0].includes('\n') && !opened[0].includes(' '))
  assert.equal(decodeURIComponent(opened[0].split('body=')[1]), 'سطر 1\nسطر 2 & ?')
})

test('التذكير: نص المتأخرات عبر IPC', async () => {
  const { call, h } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  const bk = (await call('books:save', { title: 'كتاب', author: 'م', copies: 1 })).data
  const m = (await call('members:save', { name: 'سارة' })).data
  const l = (await call('loans:borrow', { member_id: m, book_id: bk })).data
  assert.equal((await call('reminders:text', { member_id: m })).ok, false)
  h.getDb().raw.prepare("UPDATE loans SET due_date = date('now','localtime','-2 days') WHERE id = ?").run(l.id)
  const r = (await call('reminders:text', { member_id: m })).data
  assert.match(r.text, /«كتاب»/)
  assert.equal((await call('overdue:all')).data.length, 1)
})

/* ---------- المرحلة الرابعة: التقارير ووضع القارئ ---------- */
test('التقارير للمدير فقط؛ وبحث القارئ لأي مستخدم دون بيانات شخصية', async () => {
  const { call } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  await call('users:save', { username: 'amin', display_name: 'أ', role: 'librarian', password: 'secret-pass' })
  await call('books:save', { title: 'الإسلام والحضارة', author: 'محمد', copies: 1 })
  assert.equal((await call('reports:get', { days: 30 })).data.monthly.length, 12)
  await call('auth:logout')
  await call('auth:login', { username: 'amin', password: 'secret-pass' })
  assert.equal((await call('reports:get', { days: 30 })).code, 'FORBIDDEN')
  const k = await call('kiosk:search', 'الاسلام')
  assert.equal(k.data.length, 1)
  assert.equal(k.data[0].title, 'الإسلام والحضارة')
})

test('auth:verify: يقبل كلمة المرور الصحيحة، ويرفض الخاطئة ويقفل بعد 5 محاولات', async () => {
  const { call } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  assert.equal((await call('auth:verify', { password: 'secret-pass' })).data, true)
  for (let i = 0; i < 5; i++) assert.equal((await call('auth:verify', { password: 'bad' })).ok, false)
  const locked = await call('auth:verify', { password: 'secret-pass' })
  assert.equal(locked.code, 'LOCKED')
  // القفل خاص بالتحقق ولا يمنع العمل الطبيعي
  assert.equal((await call('books:list', {})).ok, true)
})

test('auth:verify بلا جلسة مرفوض، وملء الشاشة يمرَّر لنافذة التطبيق', async () => {
  const calls = []
  const win = { setFullScreen: (v) => calls.push(v) }
  const { call } = setup(null, { win })
  assert.equal((await call('auth:verify', { password: 'x' })).code, 'AUTH')
  await call('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  assert.equal((await call('app:fullscreen', { on: true })).ok, true)
  await call('app:fullscreen', { on: false })
  assert.deepEqual(calls, [true, false])
  // نافذة بلا الدالة أو بلا نافذة: لا ينهار
  const { call: c2 } = setup()
  await c2('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' })
  assert.equal((await c2('app:fullscreen', { on: true })).ok, true)
})

/* ---------- المرحلة الخامسة: سجل العمليات والاسترداد وحارس السلامة ---------- */
const SECRET_PW = 'admin-secret-pass'

test('سجل العمليات: يسجّل الناجح بفاعله، ولا يسجّل الفاشل، ولا يحوي أي سرّ', async () => {
  const { call } = setup()
  const setupRes = await call('auth:setup', { username: 'admin', display_name: 'المدير', password: SECRET_PW })
  const recoveryCode = setupRes.data.recoveryCode
  const bk = (await call('books:save', { title: 'كتاب التدقيق', author: 'م', copies: 1 })).data
  const m = (await call('members:save', { name: 'سارة' })).data
  const loan = (await call('loans:borrow', { member_id: m, book_id: bk })).data
  // عملية فاشلة: لا نسخة متاحة
  const m2 = (await call('members:save', { name: 'بشير' })).data
  assert.equal((await call('loans:borrow', { member_id: m2, book_id: bk })).ok, false)
  await call('loans:return', loan.id)
  await call('users:save', { username: 'amin', display_name: 'أمين', role: 'librarian', password: 'user-secret-456' })
  await call('auth:changePassword', { oldPassword: SECRET_PW, newPassword: 'new-secret-789' })
  await call('users:resetPassword', { id: 2, password: 'reset-secret-000' })

  const rows = (await call('audit:list', { pageSize: 100 })).data.rows
  const text = rows.map((r) => r.summary)
  assert.ok(text.includes('إضافة الكتاب «كتاب التدقيق»'))
  assert.ok(text.includes('إضافة العضو «سارة»'))
  assert.ok(text.some((t) => t.includes('إعارة «كتاب التدقيق»') && t.includes('إلى سارة')))
  assert.ok(text.some((t) => t.startsWith('إرجاع «كتاب التدقيق» من سارة')))
  assert.ok(text.includes('إضافة المستخدم «amin»'))
  assert.ok(text.includes('تغيير كلمة المرور'))
  assert.ok(text.includes('تعيين كلمة مرور جديدة للمستخدم «amin»'))
  assert.equal(text.filter((t) => t.includes('بشير') && t.includes('إعارة')).length, 0) // الفاشلة غير مسجَّلة
  assert.ok(rows.every((r) => r.username === 'admin')) // الفاعل مسجَّل
  assert.equal(rows[rows.length - 1].action, 'auth:setup')

  // لا كلمات مرور ولا رمز استرداد في أي مكان من السجل
  const dump = JSON.stringify(rows)
  for (const secret of [SECRET_PW, 'user-secret-456', 'new-secret-789', 'reset-secret-000', recoveryCode, recoveryCode.replace(/-/g, '')])
    assert.ok(!dump.includes(secret), `تسرّب: ${secret}`)
})

test('سجل العمليات: الدخول الفاشل يُسجَّل بالاسم المحاوَل، والخروج والدخول بفاعلهما', async () => {
  const { call } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: SECRET_PW })
  await call('auth:logout')
  await call('auth:login', { username: 'ghost', password: 'x' })
  await call('auth:login', { username: 'admin', password: SECRET_PW })
  const rows = (await call('audit:list', {})).data.rows
  assert.equal(rows[0].summary, 'تسجيل دخول')
  assert.equal(rows[0].username, 'admin')
  const failed = rows.find((r) => r.action === 'auth:login:failed')
  assert.equal(failed.summary, 'محاولة دخول فاشلة للمستخدم «ghost»')
  assert.equal(failed.username, null)
  const out = rows.find((r) => r.summary === 'تسجيل خروج')
  assert.equal(out.username, 'admin') // الفاعل قبل الخروج
})

test('سجل العمليات: للمدير فقط', async () => {
  const { call } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: SECRET_PW })
  await call('users:save', { username: 'amin', display_name: 'أ', role: 'librarian', password: 'secret-pass' })
  await call('auth:logout')
  await call('auth:login', { username: 'amin', password: 'secret-pass' })
  assert.equal((await call('audit:list', {})).code, 'FORBIDDEN')
  assert.equal((await call('audit:users')).code, 'FORBIDDEN')
})

test('سجل العمليات: تسع محاولات دخول فاشلة تترك خمسة صفوف فقط (الباقي مقفول ولا يُسجَّل)', async () => {
  const { call, h } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: SECRET_PW })
  await call('auth:logout')
  const codes = []
  for (let i = 0; i < 9; i++) codes.push((await call('auth:login', { username: 'admin', password: 'bad' })).code)
  assert.deepEqual(codes.slice(0, 5), Array(5).fill(undefined))
  assert.deepEqual(codes.slice(5), Array(4).fill('LOCKED'))
  // الحساب مقفول للدخول، فنقرأ السجل من القاعدة مباشرة
  const failed = h.getDb().listAudit({ pageSize: 100 }).rows.filter((r) => r.action === 'auth:login:failed')
  assert.equal(failed.length, 5)
})

test('الاسترجاع يحتفظ بفاعل العملية في القاعدة المستردّة', async () => {
  const { call } = setup()
  await call('auth:setup', { username: 'admin', display_name: 'م', password: SECRET_PW })
  const name = (await call('backup:create')).data.name
  await call('books:save', { title: 'سيضيع', author: 'م', copies: 1 })
  assert.equal((await call('backup:restore', { name })).ok, true)
  await call('auth:login', { username: 'admin', password: SECRET_PW })
  const rows = (await call('audit:list', {})).data.rows
  const entry = rows.find((r) => r.summary.startsWith('استرجاع نسخة احتياطية'))
  assert.ok(entry)
  assert.equal(entry.username, 'admin')
  assert.ok(!rows.some((r) => r.summary.includes('سيضيع'))) // ما بعد النسخة ذهب
})

test('رمز الاسترداد: الإعداد يعيده مرة واحدة والاسترداد يغيّر كلمة المرور ويدوّر الرمز', async () => {
  const { call } = setup()
  const first = (await call('auth:setup', { username: 'admin', display_name: 'المدير', password: SECRET_PW })).data
  assert.match(first.recoveryCode, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/)
  assert.equal((await call('auth:status')).data.user.recoveryCode, undefined) // لا يتسرب لحالة الجلسة
  await call('auth:logout')

  const r = await call('auth:recover', { username: 'ADMIN', code: first.recoveryCode.toLowerCase(), newPassword: 'brand-new-pass' })
  assert.equal(r.ok, true)
  assert.notEqual(r.data.recoveryCode, first.recoveryCode)
  assert.equal((await call('auth:login', { username: 'admin', password: SECRET_PW })).ok, false)
  assert.equal((await call('auth:login', { username: 'admin', password: 'brand-new-pass' })).ok, true)
  // الرمز القديم لم يعد صالحًا
  await call('auth:logout')
  const old = await call('auth:recover', { username: 'admin', code: first.recoveryCode, newPassword: 'another-pass-1' })
  assert.equal(old.error, 'رمز الاسترداد غير صحيح')
  // والجديد صالح
  assert.equal((await call('auth:recover', { username: 'admin', code: r.data.recoveryCode, newPassword: 'another-pass-1' })).ok, true)
  await call('auth:login', { username: 'admin', password: 'another-pass-1' })
  const rows = (await call('audit:list', {})).data.rows
  assert.ok(rows.some((x) => x.action === 'auth:recover' && x.summary.includes('«admin»')))
  assert.ok(rows.some((x) => x.action === 'auth:recover:failed'))
})

test('الاسترداد: حساب غير مدير أو كلمة قصيرة تُرفض دون استهلاك الرمز', async () => {
  const { call } = setup()
  const { recoveryCode } = (await call('auth:setup', { username: 'admin', display_name: 'م', password: SECRET_PW })).data
  await call('users:save', { username: 'amin', display_name: 'أ', role: 'librarian', password: 'secret-pass' })
  await call('auth:logout')
  assert.match((await call('auth:recover', { username: 'amin', code: recoveryCode, newPassword: 'long-enough-1' })).error, /لا يوجد حساب مدير/)
  assert.match((await call('auth:recover', { username: 'ghost', code: recoveryCode, newPassword: 'long-enough-1' })).error, /لا يوجد حساب مدير/)
  assert.match((await call('auth:recover', { username: 'admin', code: recoveryCode, newPassword: 'short' })).error, /8 أحرف/)
  // الرمز لا يزال صالحًا وكلمة المرور القديمة لم تتغيّر
  assert.equal((await call('auth:login', { username: 'admin', password: SECRET_PW })).ok, true)
  await call('auth:logout')
  assert.equal((await call('auth:recover', { username: 'admin', code: recoveryCode, newPassword: 'long-enough-1' })).ok, true)
})

test('الاسترداد: قفل بعد 5 محاولات خاطئة حتى مع الرمز الصحيح، ورفع قفل الدخول عن المدير', async () => {
  const { call } = setup()
  const { recoveryCode } = (await call('auth:setup', { username: 'admin', display_name: 'م', password: SECRET_PW })).data
  await call('auth:logout')
  // قفل الدخول العادي
  for (let i = 0; i < 5; i++) await call('auth:login', { username: 'admin', password: 'bad' })
  assert.equal((await call('auth:login', { username: 'admin', password: SECRET_PW })).code, 'LOCKED')
  // الاسترداد الصحيح يرفع القفل عن الحساب
  const ok = await call('auth:recover', { username: 'admin', code: recoveryCode, newPassword: 'unlocked-pass-1' })
  assert.equal(ok.ok, true)
  assert.equal((await call('auth:login', { username: 'admin', password: 'unlocked-pass-1' })).ok, true)
  await call('auth:logout')
  // 5 رموز خاطئة تقفل الاسترداد نفسه، حتى الرمز الصحيح الجديد
  for (let i = 0; i < 5; i++) assert.equal((await call('auth:recover', { username: 'admin', code: 'AAAAA-AAAAA-AAAAA-AAAAA', newPassword: 'x'.repeat(10) })).ok, false)
  assert.equal((await call('auth:recover', { username: 'admin', code: ok.data.recoveryCode, newPassword: 'x'.repeat(10) })).code, 'LOCKED')
})

test('رمز استرداد جديد: يتطلب كلمة المرور والمدير فقط ويبطل القديم', async () => {
  const { call } = setup()
  const { recoveryCode } = (await call('auth:setup', { username: 'admin', display_name: 'م', password: SECRET_PW })).data
  assert.equal((await call('auth:recoveryInfo')).data.exists, true)
  assert.match((await call('auth:newRecoveryCode', { password: 'wrong' })).error, /غير صحيحة/)
  const n = await call('auth:newRecoveryCode', { password: SECRET_PW })
  assert.equal(n.ok, true)
  assert.notEqual(n.data.recoveryCode, recoveryCode)
  await call('users:save', { username: 'amin', display_name: 'أ', role: 'librarian', password: 'secret-pass' })
  await call('auth:logout')
  assert.equal((await call('auth:recover', { username: 'admin', code: recoveryCode, newPassword: 'x'.repeat(10) })).ok, false) // القديم أُبطل
  await call('auth:login', { username: 'amin', password: 'secret-pass' })
  assert.equal((await call('auth:recoveryInfo')).code, 'FORBIDDEN')
  assert.equal((await call('auth:newRecoveryCode', { password: 'secret-pass' })).code, 'FORBIDDEN')
})

test('حارس السلامة: لا نسخة احتياطية تلقائية من قاعدة فاشلة في الفحص', async () => {
  const bad = setup()
  await bad.call('auth:setup', { username: 'admin', display_name: 'م', password: SECRET_PW })
  const raw = bad.h.getDb().raw
  const real = raw.pragma.bind(raw)
  raw.pragma = (name, o) => (String(name).startsWith('quick_check') ? '*** in database main ***' : real(name, o))
  bad.h.ensureDaily()
  assert.equal(backup.hasToday(bad.backupDir), false)
  bad.h.shutdown()
  assert.equal(backup.hasToday(bad.backupDir), false)

  const good = setup()
  await good.call('auth:setup', { username: 'admin', display_name: 'م', password: SECRET_PW })
  good.h.ensureDaily()
  assert.equal(backup.hasToday(good.backupDir), true)
})
