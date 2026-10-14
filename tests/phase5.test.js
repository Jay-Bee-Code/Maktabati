const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3')
const { createDb, SCHEMA_VERSION } = require('../electron/db')
const backup = require('../electron/backup')
const { openWithRecovery, isCorruption } = require('../electron/recovery')

const fresh = () => createDb(':memory:')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'))

/* ---------------- سجل العمليات ---------------- */
test('سجل العمليات: إلحاق وقراءة بالأحدث أولًا مع التصفية والبحث العربي', () => {
  const d = fresh()
  const a = { id: 1, username: 'admin' }
  const b = { id: 2, username: 'amin' }
  d.audit({ user: a, action: 'books:save', summary: 'إضافة الكتاب «الإسلام والحضارة»' })
  d.audit({ user: b, action: 'loans:borrow', summary: 'إعارة «كتاب» إلى سارة' })
  d.audit({ user: null, action: 'auth:login:failed', summary: 'محاولة دخول فاشلة للمستخدم «x»' })
  const all = d.listAudit({})
  assert.equal(all.total, 3)
  assert.equal(all.rows[0].action, 'auth:login:failed') // الأحدث أولًا
  assert.equal(all.rows[0].username, null)
  assert.equal(d.listAudit({ search: 'الاسلام' }).total, 1)   // تطبيع عربي
  assert.equal(d.listAudit({ username: 'amin' }).total, 1)
  assert.equal(d.listAudit({ search: 'amin' }).total, 1)      // البحث في اسم المستخدم
  assert.equal(d.listAudit({ search: '%' }).total, 0)         // % حرف عادي
  assert.deepEqual(d.auditUsers(), ['admin', 'amin'])
  for (let i = 0; i < 60; i++) d.audit({ user: a, action: 'x', summary: `س${i}` })
  const p1 = d.listAudit({ pageSize: 50 })
  assert.equal(p1.rows.length, 50)
  assert.equal(d.listAudit({ pageSize: 50, page: 2 }).rows.length, 13)
  d.audit({ user: a, action: 'x', summary: 'ط'.repeat(1000) })
  assert.equal(d.listAudit({}).rows[0].summary.length, 400) // اقتطاع
})

test('سجل العمليات للإلحاق فقط: التعديل والحذف مرفوضان من القاعدة نفسها', () => {
  const d = fresh()
  d.audit({ user: { id: 1, username: 'a' }, action: 'x', summary: 'سطر' })
  assert.throws(() => d.raw.prepare("UPDATE audit_log SET summary = 'مزوَّر'").run(), /للقراءة فقط/)
  assert.throws(() => d.raw.prepare('DELETE FROM audit_log').run(), /للقراءة فقط/)
  assert.equal(d.listAudit({}).rows[0].summary, 'سطر')
})

/* ---------------- رمز الاسترداد ---------------- */
test('رمز الاسترداد: الصيغة والتحقق وعدم التخزين الصريح والتدوير', () => {
  const d = fresh()
  assert.deepEqual(d.recoveryInfo(), { exists: false, created_at: null })
  assert.equal(d.verifyRecoveryCode('AAAAA-AAAAA-AAAAA-AAAAA'), false) // بلا رمز مخزَّن
  const c1 = d.createRecoveryCode()
  assert.match(c1, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/)
  assert.ok(d.verifyRecoveryCode(c1))
  assert.ok(d.verifyRecoveryCode(c1.toLowerCase().replace(/-/g, ' '))) // لا يهم الشكل
  assert.ok(!d.verifyRecoveryCode(c1.slice(0, -1) + (c1.endsWith('A') ? 'B' : 'A')))
  assert.equal(d.recoveryInfo().exists, true)
  // الرمز لا يُخزَّن صريحًا في أي مكان
  const dump = JSON.stringify(d.raw.prepare('SELECT * FROM settings').all())
  assert.ok(!dump.includes(c1.replace(/-/g, '')))
  // رمز جديد يبطل القديم
  const c2 = d.createRecoveryCode()
  assert.notEqual(c1, c2)
  assert.ok(!d.verifyRecoveryCode(c1))
  assert.ok(d.verifyRecoveryCode(c2))
  // لا يظهر في الإعدادات العامة
  assert.deepEqual(Object.keys(d.getSettings()).filter((k) => k.startsWith('recovery')), [])
})

test('رموز الاسترداد المولَّدة متنوعة وكاملة الطول (لا تكرار في 200 رمز)', () => {
  const d = fresh()
  const seen = new Set()
  for (let i = 0; i < 200; i++) seen.add(d.createRecoveryCode())
  assert.equal(seen.size, 200)
})

test('الترحيل 5 يُنشئ سجل العمليات في قاعدة قديمة دون المساس ببياناتها', () => {
  const dir = tmp()
  const file = path.join(dir, 'old.db')
  const d1 = createDb(file)
  d1.saveBook({ title: 'قبل', author: 'م', copies: 1 })
  d1.raw.exec('DROP TRIGGER audit_no_update; DROP TRIGGER audit_no_delete; DROP TABLE audit_log; PRAGMA user_version = 4')
  d1.raw.close()
  const hooks = []
  const d2 = createDb(file, { onBeforeMigrate: (v) => hooks.push(v) })
  assert.deepEqual(hooks, [4])
  assert.equal(d2.raw.pragma('user_version', { simple: true }), SCHEMA_VERSION)
  assert.equal(d2.listBooks({}).total, 1)
  d2.audit({ user: null, action: 'x', summary: 'يعمل' })
  assert.equal(d2.listAudit({}).total, 1)
})

/* ---------------- الاسترجاع عند التلف ---------------- */
function makeLive(dir) {
  const dbPath = path.join(dir, 'library.db')
  const backupDir = path.join(dir, 'backups')
  const open = () => createDb(dbPath)
  return { dbPath, backupDir, open }
}

/** يفسد صفحات البيانات في ملف قاعدة مغلق ويتأكد أن quick_check يكتشف ذلك */
function corrupt(dbPath) {
  const buf = fs.readFileSync(dbPath)
  assert.ok(buf.length > 8192, 'الملف أصغر من أن يُفسد')
  for (let i = 4096; i < Math.min(buf.length, 16384); i++) buf[i] = 0xff
  fs.writeFileSync(dbPath, buf)
  fs.rmSync(dbPath + '-wal', { force: true })
  fs.rmSync(dbPath + '-shm', { force: true })
  let detected = false
  try {
    const t = new Database(dbPath, { readonly: true })
    detected = t.pragma('quick_check', { simple: true }) !== 'ok'
    t.close()
  } catch { detected = true }
  assert.ok(detected, 'لم يُكتشف التلف المصطنع: الاختبار غير صالح')
}

function populated(dir) {
  const L = makeLive(dir)
  const d = L.open()
  for (let i = 1; i <= 40; i++) d.saveBook({ title: `كتاب رقم ${i}`, author: 'مؤلف', category: 'تصنيف', copies: 2 })
  return { L, d }
}

test('قاعدة سليمة: تُفتح كما هي بلا استرجاع ولا نسخ تالفة', () => {
  const dir = tmp()
  const L = makeLive(dir)
  const r = openWithRecovery({ ...L })
  assert.equal(r.recovered, null)
  r.db.raw.close()
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('corrupt')), [])
})

test('ملف تالف مع نسخة سليمة: يُسترجع أحدثها ويُحفظ التالف ولا يُحذف', () => {
  const dir = tmp()
  const { L, d } = populated(dir)
  backup.auto(d.raw, L.backupDir)                        // نسخة سليمة فيها 40 كتابًا
  d.saveBook({ title: 'بعد النسخة', author: 'م', copies: 1 }) // يضيع بالاسترجاع
  d.raw.close()
  corrupt(L.dbPath)

  const r = openWithRecovery({ ...L })
  assert.ok(r.recovered)
  assert.match(r.recovered.backupName, /^auto-/)
  assert.ok(fs.existsSync(r.recovered.corruptCopy))      // التالف محفوظ للفحص
  assert.equal(r.db.listBooks({ pageSize: 200 }).total, 40)
  assert.equal(r.db.listBooks({ search: 'بعد النسخة' }).total, 0)
  assert.equal(r.db.raw.pragma('quick_check', { simple: true }), 'ok')
  r.db.raw.close()
})

test('يتجاوز النسخ التالفة ويختار أحدث نسخة سليمة', () => {
  const dir = tmp()
  const { L, d } = populated(dir)
  backup.auto(d.raw, L.backupDir)                        // سليمة (أقدم)
  const good = path.join(L.backupDir, backup.list(L.backupDir)[0].name)
  const bad = path.join(L.backupDir, 'manual-2099-01-01_000000.db') // تالفة وأحدث تاريخيًا
  fs.writeFileSync(bad, 'ليست قاعدة بيانات')
  fs.utimesSync(bad, new Date(), new Date(Date.now() + 60_000))
  d.raw.close()
  corrupt(L.dbPath)
  const r = openWithRecovery({ ...L })
  assert.equal(path.join(L.backupDir, r.recovered.backupName), good)
  assert.equal(r.db.listBooks({}).total > 0, true)
  r.db.raw.close()
})

test('تلف بلا أي نسخة سليمة: يرمي خطأ واضحًا ولا يمسّ الملف', () => {
  const dir = tmp()
  const { L, d } = populated(dir)
  d.raw.close()
  corrupt(L.dbPath)
  const before = fs.readFileSync(L.dbPath)
  assert.throws(() => openWithRecovery({ ...L }), (e) => e.code === 'CORRUPT_NO_BACKUP' && /لم يُحذف شيء/.test(e.message) && e.message.includes(L.dbPath))
  assert.ok(fs.readFileSync(L.dbPath).equals(before)) // الملف كما هو
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('corrupt')), [])

  // نسخة تالفة وحيدة لا تُعدّ سليمة
  fs.mkdirSync(L.backupDir, { recursive: true })
  fs.writeFileSync(path.join(L.backupDir, 'auto-2026-01-01.db'), 'garbage')
  assert.throws(() => openWithRecovery({ ...L }), (e) => e.code === 'CORRUPT_NO_BACKUP')
})

test('ملف ليس قاعدة بيانات أصلًا يُعالَج كتالف', () => {
  const dir = tmp()
  const { L, d } = populated(dir)
  backup.auto(d.raw, L.backupDir)
  d.raw.close()
  fs.writeFileSync(L.dbPath, 'هذا نص عادي وليس SQLite '.repeat(500))
  fs.rmSync(L.dbPath + '-wal', { force: true })
  const r = openWithRecovery({ ...L })
  assert.ok(r.recovered)
  assert.equal(r.db.listBooks({}).total > 0, true)
  r.db.raw.close()
})

test('قاعدة أحدث من التطبيق ليست «تالفة»: يُرمى الخطأ الأصلي ولا يُستبدل الملف', () => {
  const dir = tmp()
  const L = makeLive(dir)
  const x = new Database(L.dbPath)
  x.exec('CREATE TABLE t(x)')
  x.pragma(`user_version = ${SCHEMA_VERSION + 3}`)
  x.close()
  const before = fs.readFileSync(L.dbPath)
  assert.throws(() => openWithRecovery({ ...L }), /أحدث من هذه النسخة/)
  assert.ok(fs.readFileSync(L.dbPath).equals(before))
  assert.ok(!isCorruption(new Error('قاعدة البيانات أحدث من هذه النسخة')))
  assert.ok(isCorruption(Object.assign(new Error('x'), { code: 'SQLITE_CORRUPT' })))
  assert.ok(isCorruption(new Error('database disk image is malformed')))
})
