const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ExcelJS = require('exceljs')
const { createDb } = require('../electron/db')
const { createHandlers } = require('../electron/handlers')
const backup = require('../electron/backup')
const i18n = require('../electron/i18n')
const fr = require('../shared/locales/fr.json')

afterEach(() => i18n.setLocale('ar')) // اللغة حالة عامة في العملية

function mk(dialogResult, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'))
  const dbPath = path.join(dir, 'library.db')
  const backupDir = path.join(dir, 'backups')
  const dialog = { showSaveDialog: async () => dialogResult ?? { canceled: true }, showOpenDialog: async () => dialogResult ?? { canceled: true } }
  const h = createHandlers({
    dbPath, backupDir, dialog, shell: {}, getWindow: () => extra.win ?? null,
    openDb: () => createDb(dbPath),
  })
  return { h, call: (ch, p) => h.invoke(ch, p), dir, backupDir }
}
const admin = { username: 'admin', display_name: 'Admin', password: 'secret-pass' }

test('اللغة: تُضبط قبل إنشاء أول حساب، ثم للمدير وحده', async () => {
  const { call } = mk()
  assert.equal((await call('app:info')).data.language, 'ar')                  // عامة قبل الدخول
  assert.equal((await call('app:setLanguage', { language: 'fr' })).data.language, 'fr') // لا مستخدمين: مسموح
  assert.equal((await call('app:info')).data.language, 'fr')
  assert.equal((await call('app:setLanguage', { language: 'xx' })).error, 'Langue non prise en charge') // رسالة بلغة الحاضر

  await call('auth:setup', admin)
  await call('users:save', { username: 'amin', display_name: 'Amin', role: 'librarian', password: 'secret-pass' })
  await call('auth:logout')
  // بعد وجود مستخدمين: لا تغيير دون مدير
  assert.equal((await call('app:setLanguage', { language: 'ar' })).code, 'FORBIDDEN')
  await call('auth:login', { username: 'amin', password: 'secret-pass' })
  assert.equal((await call('app:setLanguage', { language: 'ar' })).code, 'FORBIDDEN')
  assert.equal((await call('settings:save', { language: 'ar' })).code, 'FORBIDDEN')
  await call('auth:logout')
  await call('auth:login', { username: 'admin', password: 'secret-pass' })
  assert.equal((await call('app:setLanguage', { language: 'ar' })).ok, true)
  assert.equal((await call('app:info')).data.language, 'ar')
})

test('أخطاء الخادم وسجل العمليات تتبع لغة المكتبة، وتعود عند التبديل', async () => {
  const { call } = mk()
  await call('app:setLanguage', { language: 'fr' })
  await call('auth:setup', admin)
  const bk = (await call('books:save', { title: 'Candide', author: 'Voltaire', copies: 1 })).data
  const m1 = (await call('members:save', { name: 'Ahmed' })).data
  const m2 = (await call('members:save', { name: 'Sara' })).data
  await call('loans:borrow', { member_id: m1, book_id: bk })

  const err = await call('loans:borrow', { member_id: m2, book_id: bk })
  assert.equal(err.error, 'Aucun exemplaire disponible de « Candide »')
  assert.equal((await call('books:save', { title: '', author: 'x', copies: 1 })).error, 'Le titre du livre est obligatoire')
  assert.equal((await call('books:save', { title: 'x', author: 'y', isbn: '123', copies: 1 })).error, 'ISBN invalide. Vérifiez les chiffres (10 ou 13).')

  const rows = (await call('audit:list', {})).data.rows.map((r) => r.summary)
  assert.ok(rows.includes('Création du premier compte administrateur'))
  assert.ok(rows.includes('Ajout du livre « Candide »'))
  assert.ok(rows.some((r) => /^Prêt de « Candide » \(B00001-1\) à Ahmed$/.test(r)))

  await call('settings:save', { language: 'ar' })
  assert.equal((await call('loans:borrow', { member_id: m2, book_id: bk })).error, 'لا توجد نسخة متاحة من «Candide»')
  const after = (await call('audit:list', {})).data.rows.map((r) => r.summary)
  assert.ok(after.includes('تعديل الإعدادات'))                 // الجديد بالعربية
  assert.ok(after.includes('Ajout du livre « Candide »'))      // القديم يبقى كما سُجِّل
})

test('اسم المكتبة والعملة الافتراضيان يتبعان اللغة، والمخصَّصان يثبتان ولا يُثبَّت الافتراضي بحفظ إعداد آخر', async () => {
  const { call, h } = mk()
  await call('auth:setup', admin)
  assert.equal((await call('settings:get')).data.library_name, 'تسيير المكتبة')
  await call('settings:save', { language: 'fr' })
  let s = (await call('settings:get')).data
  assert.equal(s.library_name, 'Gestion de bibliothèque')
  assert.equal(s.currency, 'DA')
  await call('settings:save', { fine_per_day: 10 })          // حفظ إعداد آخر لا يثبّت الاسم الافتراضي
  assert.deepEqual(h.getDb().raw.prepare("SELECT key FROM settings WHERE key IN ('library_name','currency')").all(), [])
  await call('settings:save', { language: 'ar' })
  s = (await call('settings:get')).data
  assert.equal(s.library_name, 'تسيير المكتبة')               // عاد للعربية لأنه لم يُخصَّص
  assert.equal(s.currency, 'دج')

  await call('settings:save', { library_name: 'مكتبة الأمل' }) // تخصيص
  await call('settings:save', { language: 'fr' })
  assert.equal((await call('settings:get')).data.library_name, 'مكتبة الأمل') // يثبت عبر اللغات
})

test('رسائل التذكير بالفرنسية: مفرد وجمع بجمل كاملة وعنوان البريد', async () => {
  const { call, h } = mk()
  await call('app:setLanguage', { language: 'fr' })
  await call('auth:setup', admin)
  await call('settings:save', { library_name: 'Bibliothèque Centrale', fine_per_day: 5 })
  const m = (await call('members:save', { name: 'Sara' })).data
  const b1 = (await call('books:save', { title: 'Candide', author: 'V', copies: 1 })).data
  const b2 = (await call('books:save', { title: 'Zadig', author: 'V', copies: 1 })).data
  const l1 = (await call('loans:borrow', { member_id: m, book_id: b1 })).data
  const l2 = (await call('loans:borrow', { member_id: m, book_id: b2 })).data
  const db = h.getDb().raw
  db.prepare("UPDATE loans SET due_date = date('now','localtime','-3 days') WHERE id = ?").run(l1.id)

  let r = (await call('reminders:text', { member_id: m })).data
  assert.equal(r.subject, 'Rappel de retour de livres — Bibliothèque Centrale')
  assert.match(r.text, /^Bonjour Sara,/)
  assert.match(r.text, /le livre suivant a dépassé sa date de retour/)   // مفرد
  assert.match(r.text, /Merci de le rendre dès que possible/)
  assert.match(r.text, /« Candide » \(à rendre le \d{4}-\d\d-\d\d, en retard de 3 jour\(s\)\)/)

  db.prepare("UPDATE loans SET due_date = date('now','localtime','-8 days') WHERE id = ?").run(l2.id)
  await call('fines:add', { member_id: m, amount: 70, reason: 'Livre abîmé' })
  r = (await call('reminders:text', { member_id: m })).data
  assert.match(r.text, /les livres suivants ont dépassé leur date de retour/) // جمع
  assert.match(r.text, /Merci de les rendre dès que possible/)
  assert.match(r.text, /Amende actuellement due : 70 DA\./)
  assert.ok(!/[\u0600-\u06FF]/.test(r.text), 'حرف عربي في الرسالة الفرنسية')

  // حجز جاهز
  const x = (await call('members:save', { name: 'Karim' })).data
  const b3 = (await call('books:save', { title: 'Micromégas', author: 'V', copies: 1 })).data
  const l3 = (await call('loans:borrow', { member_id: x, book_id: b3 })).data
  await call('reservations:create', { book_id: b3, member_id: m })
  await call('loans:return', l3.id)
  const rr = (await call('reminders:text', { member_id: m, kind: 'ready' })).data
  assert.match(rr.text, /le livre que vous avez réservé est maintenant disponible à Bibliothèque Centrale/)
  assert.match(rr.text, /« Micromégas » \(nous le gardons pour vous jusqu'au/)
  assert.ok(!/[\u0600-\u06FF]/.test(rr.text))
})

test('النسخ الاحتياطي: التسمية مترجمة ورمز النوع ثابت لا يتغير باللغة', async () => {
  const { call } = mk()
  await call('app:setLanguage', { language: 'fr' })
  await call('auth:setup', admin)
  await call('backup:create')
  let items = (await call('backup:list')).data.items
  assert.equal(items[0].kind, 'Manuelle')
  assert.equal(items[0].code, 'manual')
  await call('settings:save', { language: 'ar' })
  items = (await call('backup:list')).data.items
  assert.equal(items[0].kind, 'يدوية')
  assert.equal(items[0].code, 'manual')
})

test('Excel: التصدير والقالب بلغة المكتبة، والاستيراد يقبل العناوين بالعربية والفرنسية معًا', async () => {
  const out = path.join(os.tmpdir(), `fr-books-${Date.now()}.xlsx`)
  const { call } = mk({ canceled: false, filePath: out, filePaths: [out] })
  await call('app:setLanguage', { language: 'fr' })
  await call('auth:setup', admin)
  await call('books:save', { title: 'Candide', author: 'Voltaire', isbn: '9780306406157', category: 'Roman', copies: 2 })

  await call('excel:export', { kind: 'books' })
  let wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(out)
  const ws = wb.worksheets[0]
  assert.equal(ws.name, fr['الكتب'])                                  // اسم الورقة
  assert.equal(ws.getRow(1).getCell(1).value, fr['العنوان'])          // عنوان العمود بالفرنسية
  assert.equal(ws.getRow(1).getCell(2).value, fr['المؤلف'])
  assert.equal(ws.getRow(2).getCell(1).value, 'Candide')

  // القالب: بيانات المثال بالفرنسية
  await call('excel:template', { kind: 'members' })
  wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(out)
  assert.equal(wb.worksheets[0].getRow(2).getCell(1).value, 'Ahmed Benali')

  // استيراد بعناوين فرنسية ثم بعناوين عربية، في مكتبة فرنسية
  for (const head of [
    [fr['العنوان'], fr['المؤلف'], 'ISBN', fr['عدد النسخ']],
    ['العنوان', 'المؤلف', 'ISBN', 'عدد النسخ'],
  ]) {
    const w = new ExcelJS.Workbook()
    const s = w.addWorksheet('x')
    s.addRow(head)
    s.addRow([`Livre ${head[0]}`, 'Auteur', '', 1])
    await w.xlsx.writeFile(out)
    const pv = (await call('excel:pickImport', { kind: 'books' })).data
    assert.deepEqual(pv.counts, { new: 1, duplicate: 0, invalid: 0 }, `رؤوس: ${head[0]}`)
    assert.equal((await call('excel:commitImport', {})).data.created, 1)
  }

  // عمود ناقص: الرسالة بالفرنسية وتسمّي العمود بالفرنسية
  const bad = new ExcelJS.Workbook()
  bad.addWorksheet('x').addRow(['A', 'B'])
  await bad.xlsx.writeFile(out)
  assert.equal((await call('excel:pickImport', { kind: 'books' })).error, `Colonne « ${fr['العنوان']} » introuvable sur la première ligne du fichier`)
})

test('الاسترجاع يعيد لغة النسخة المستردّة', async () => {
  const { call } = mk()
  await call('app:setLanguage', { language: 'fr' })
  await call('auth:setup', admin)
  const name = (await call('backup:create')).data.name
  await call('settings:save', { language: 'ar' })
  assert.equal(i18n.getLocale(), 'ar')
  assert.equal((await call('backup:restore', { name })).ok, true)
  assert.equal(i18n.getLocale(), 'fr')                                 // لغة النسخة لا اللغة قبل الاسترجاع
  assert.equal((await call('app:info')).data.language, 'fr')
  assert.equal((await call('auth:login', { username: 'admin', password: 'bad' })).error, 'Identifiant ou mot de passe incorrect')
})

test('الاسترداد وقفل المحاولات: الرسائل بالفرنسية', async () => {
  const { call } = mk()
  await call('app:setLanguage', { language: 'fr' })
  const { recoveryCode } = (await call('auth:setup', admin)).data
  await call('auth:logout')
  assert.equal((await call('auth:recover', { username: 'admin', code: 'AAAAA-AAAAA-AAAAA-AAAAA', newPassword: 'x'.repeat(10) })).error, 'Code de récupération incorrect')
  assert.equal((await call('auth:recover', { username: 'ghost', code: recoveryCode, newPassword: 'x'.repeat(10) })).error, 'Aucun compte administrateur portant ce nom')
  for (let i = 0; i < 5; i++) await call('auth:login', { username: 'admin', password: 'bad' })
  assert.match((await call('auth:login', { username: 'admin', password: 'secret-pass' })).error, /^Trop de tentatives\. Réessayez dans \d+ seconde\(s\)$/)
})
