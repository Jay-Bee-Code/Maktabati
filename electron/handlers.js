/**
 * منطق IPC كاملًا (الجلسة، الصلاحيات، قفل الدخول، النسخ الاحتياطي والاسترجاع)
 * منفصل عن Electron ليمكن اختباره. main.js يربطه بـ ipcMain فقط.
 *
 * ctx: { openDb, dbPath, backupDir, dialog, shell, getWindow }
 */
const path = require('path')
const fs = require('fs')
const backup = require('./backup')
const excel = require('./excel')
const { SCHEMA_VERSION } = require('./db')
const { tr, tk, setLocale } = require('./i18n')

const fail = (message, code) => Object.assign(new Error(message), { code })
const pub = (u) => u && { id: u.id, username: u.username, display_name: u.display_name, role: u.role }

function createHandlers(ctx) {
  let db = ctx.openDb()
  // لغة المكتبة تحكم رسائل الخادم كلها (أخطاء وسجل وتذكيرات وتصدير)
  const applyLocale = () => setLocale(db.getSettings().language)
  applyLocale()
  let currentUser = null
  let pendingImport = null // { kind, rows } بعد المعاينة وقبل التأكيد
  const fails = new Map()

  /* ---------- قفل محاولات الدخول ---------- */
  function checkLock(u) {
    const f = fails.get(u)
    if (f && f.until > Date.now())
      throw fail(tr("محاولات كثيرة. أعد المحاولة بعد {0} ثانية", [Math.ceil((f.until - Date.now()) / 1000)]), 'LOCKED')
  }
  function noteFail(u) {
    const f = fails.get(u) || { n: 0, until: 0 }
    f.n += 1
    if (f.n >= 5) { f.until = Date.now() + 30_000; f.n = 0 }
    fails.set(u, f)
  }

  /* ---------- الاسترجاع ---------- */
  function restoreFrom(src) {
    const v = backup.validate(src, SCHEMA_VERSION)
    if (!v.ok) throw new Error(v.error)

    const safety = backup.make(db.raw, path.join(ctx.backupDir, `pre-restore-${backup.stamp()}.db`))
    backup.prune(ctx.backupDir, 'pre-restore-', 5)

    db.raw.close()
    const wipe = () => { for (const ext of ['', '-wal', '-shm']) fs.rmSync(ctx.dbPath + ext, { force: true }) }
    try {
      wipe()
      fs.copyFileSync(src, ctx.dbPath)
      db = ctx.openDb()
    } catch (e) {
      // فشل الاسترجاع: نعيد الحالة السابقة من نسخة الأمان
      wipe()
      fs.copyFileSync(safety, ctx.dbPath)
      db = ctx.openDb()
      throw new Error(tr("تعذّر الاسترجاع وأُعيدت البيانات السابقة: ") + e.message)
    }
    applyLocale()
    currentUser = null
  }

  /* ---------- سجل العمليات: ما يُسجَّل بعد كل نجاح (لا كلمات مرور ولا رموز أبدًا) ---------- */
  const STATUS_AR = { ok: tk("سليمة"), damaged: tk("تالفة"), lost: tk("مفقودة") }
  const safe = (f, fallback = tr("؟")) => { try { return f() ?? fallback } catch { return fallback } }
  const bookTitle = (id) => safe(() => db.getBook(id).book.title)
  const memberName = (id) => safe(() => db.getMember(id).member.name)
  const AUDIT = {
    'auth:login': () => tr("تسجيل دخول"),
    'auth:logout': () => tr("تسجيل خروج"),
    'auth:setup': () => tr("إنشاء حساب المدير الأول"),
    'auth:changePassword': () => tr("تغيير كلمة المرور"),
    'auth:newRecoveryCode': () => tr("إنشاء رمز استرداد جديد"),
    'auth:recover': (p) => tr("استرداد حساب المدير «{0}» برمز الاسترداد", [String(p.username).slice(0, 60)]),
    'books:save': (p) => (p.id ? tr("تعديل الكتاب «{0}»", [p.title]) : tr("إضافة الكتاب «{0}»", [p.title])),
    'books:addCopy': (id, r) => tr("إضافة نسخة {0} إلى «{1}»", [r.barcode, r.title]),
    'books:archive': (id) => tr("أرشفة الكتاب «{0}»", [bookTitle(id)]),
    'books:restore': (id) => tr("استرجاع الكتاب «{0}» من الأرشيف", [bookTitle(id)]),
    'copies:setStatus': (p) => tr("تغيير حالة النسخة {0} إلى {1}", [safe(() => db.raw.prepare('SELECT barcode FROM copies WHERE id = ?').get(p.id).barcode), tr(STATUS_AR[p.status] || p.status) || p.status]),
    'members:save': (p) => (p.id ? tr("تعديل العضو «{0}»", [p.name]) : tr("إضافة العضو «{0}»", [p.name])),
    'members:archive': (id) => tr("أرشفة العضو «{0}»", [memberName(id)]),
    'members:restore': (id) => tr("استرجاع العضو «{0}» من الأرشيف", [memberName(id)]),
    'loans:borrow': (p, r) => tr("إعارة «{0}» ({1}) إلى {2}", [r.title, r.barcode, r.member_name]),
    'loans:return': (id, r) => tr("إرجاع «{0}» من {1}{2}{3}", [r.title, r.member_name, r.days_late ? tr(" (متأخر {0} يومًا)", [r.days_late]) : '', r.fine ? tr(" — غرامة {0}", [r.fine]) : '']),
    'loans:renew': (id, r) => tr("تمديد «{0}» حتى {1}", [r.title, r.due_date]),
    'fines:pay': (id) => tr("تسديد الغرامة رقم {0}", [id]),
    'fines:payMember': (p, r) => tr("تسديد غرامات العضو «{0}» ({1})", [memberName(p.member_id), r.paid]),
    'fines:waive': (id) => tr("إعفاء من الغرامة رقم {0}", [id]),
    'fines:add': (p) => tr("إضافة غرامة {0} على «{1}»: {2}", [p.amount, memberName(p.member_id), String(p.reason).slice(0, 80)]),
    'reservations:create': (p) => tr("حجز «{0}» للعضو «{1}»", [bookTitle(p.book_id), memberName(p.member_id)]),
    'reservations:cancel': (id) => tr("إلغاء الحجز رقم {0}", [id]),
    'users:save': (p) => (p.id ? tr("تعديل المستخدم «{0}»", [safe(() => db.getUser(p.id).username)]) : tr("إضافة المستخدم «{0}»", [p.username])),
    'users:resetPassword': (p) => tr("تعيين كلمة مرور جديدة للمستخدم «{0}»", [safe(() => db.getUser(p.id).username)]),
    'settings:save': () => tr("تعديل الإعدادات"),
    'backup:create': () => tr("إنشاء نسخة احتياطية يدوية"),
    'backup:export': (p, r) => (r.canceled ? null : tr("تصدير نسخة احتياطية")),
    'backup:restore': (p) => tr("استرجاع نسخة احتياطية ({0})", [p.name]),
    'backup:restoreFile': (p, r) => (r.canceled ? null : tr("استرجاع نسخة احتياطية من ملف")),
    'excel:export': (p, r) => (r.canceled ? null : tr("تصدير {0} إلى Excel", [p.kind])),
    'excel:commitImport': (p, r) => tr("استيراد من Excel: أُضيف {0}{1}{2}", [r.created, r.copiesAdded ? tr("، ونسخ {0}", [r.copiesAdded]) : '', r.skipped ? tr("، تُجوهل {0}", [r.skipped]) : '']),
  }

  function record(channel, payload, result, actor) {
    const f = AUDIT[channel]
    if (!f) return
    try {
      const summary = f(payload ?? {}, result ?? {})
      if (summary) db.audit({ user: actor, action: channel, summary })
    } catch (e) { console.error('audit', e) }
  }

  function recordFailure(channel, payload, e) {
    if (e.code === 'LOCKED') return
    try {
      if (channel === 'auth:login')
        db.audit({ user: null, action: 'auth:login:failed', summary: tr("محاولة دخول فاشلة للمستخدم «{0}»", [String(payload?.username ?? '').slice(0, 60)]) })
      else if (channel === 'auth:recover') db.audit({ user: null, action: 'auth:recover:failed', summary: tr("محاولة استرداد فاشلة") })
    } catch { /* السجل لا يعطّل الاستجابة */ }
  }

  /* ---------- الجدول: قناة ← [الصلاحية, الدالة] ---------- */
  const table = {
    'auth:status': ['public', () => ({ hasUsers: db.hasUsers(), user: currentUser })],
    'auth:setup': ['public', (p) => {
      if (db.hasUsers()) throw new Error(tr("تم إنشاء حساب المدير مسبقًا"))
      const id = db.createUser({ ...p, role: 'admin' })
      currentUser = pub(db.getUser(id))
      return { ...currentUser, recoveryCode: db.createRecoveryCode() } // يُعرض مرة واحدة فقط
    }],
    'auth:login': ['public', ({ username, password }) => {
      const key = String(username || '').trim().toLowerCase()
      checkLock(key)
      const u = db.authenticate(username, password)
      if (!u) { noteFail(key); throw new Error(tr("اسم المستخدم أو كلمة المرور غير صحيحة")) }
      fails.delete(key)
      currentUser = pub(u)
      return currentUser
    }],
    'auth:logout': ['public', () => { currentUser = null; return true }],
    /* استعادة الوصول عند نسيان كلمة مرور المدير. يُدوَّر الرمز بعد كل استعمال ناجح. */
    'auth:recover': ['public', ({ username, code, newPassword }) => {
      checkLock('recover')
      if (!db.verifyRecoveryCode(code)) { noteFail('recover'); throw new Error(tr("رمز الاسترداد غير صحيح")) }
      const name = String(username || '').trim().toLowerCase()
      const u = db.listUsers().find((x) => x.username.toLowerCase() === name)
      if (!u || u.role !== 'admin') throw new Error(tr("لا يوجد حساب مدير بهذا الاسم"))
      if (!u.active) throw new Error(tr("حساب المدير موقوف"))
      db.resetPassword(u.id, newPassword) // يتحقق من الطول قبل أن يُستهلك الرمز
      fails.delete('recover')
      fails.delete(name)
      return { recoveryCode: db.createRecoveryCode() }
    }],
    'auth:recoveryInfo': ['admin', () => db.recoveryInfo()],
    'auth:newRecoveryCode': ['admin', ({ password }) => {
      const key = `verify:${currentUser.id}`
      checkLock(key)
      if (!db.authenticate(currentUser.username, password)) { noteFail(key); throw new Error(tr("كلمة المرور غير صحيحة")) }
      fails.delete(key)
      return { recoveryCode: db.createRecoveryCode() }
    }],
    'audit:list': ['admin', (p) => db.listAudit(p)],
    'audit:users': ['admin', () => db.auditUsers()],
    'auth:changePassword': ['user', ({ oldPassword, newPassword }) =>
      db.changePassword(currentUser.id, oldPassword, newPassword)],

    'stats:get': ['user', () => db.stats()],
    'reports:get': ['admin', (p) => db.reports(p)],
    'kiosk:search': ['user', (q) => db.kioskSearch(q)],
    /* تحقق من كلمة مرور المستخدم الحالي (للخروج من وضع القارئ) بنفس قفل المحاولات */
    'auth:verify': ['user', ({ password }) => {
      const key = `verify:${currentUser.id}`
      checkLock(key)
      if (!db.authenticate(currentUser.username, password)) { noteFail(key); throw new Error(tr("كلمة المرور غير صحيحة")) }
      fails.delete(key)
      return true
    }],
    'app:fullscreen': ['user', ({ on }) => { ctx.getWindow()?.setFullScreen?.(!!on); return true }],
    'settings:get': ['user', () => db.getSettings()],
    'settings:save': ['admin', (p) => { const s = db.saveSettings(p); applyLocale(); return s }],
    /* قبل تسجيل الدخول: لغة المكتبة لتُعرض شاشة الدخول بها */
    'app:info': ['public', () => ({ language: db.getSettings().language })],
    /* اختيار اللغة عند الإعداد الأول (لا مستخدمين بعد)، أو للمدير فقط بعد ذلك */
    'app:setLanguage': ['public', ({ language }) => {
      if (db.hasUsers() && currentUser?.role !== 'admin') throw fail(tr("ليست لديك صلاحية لهذا الإجراء."), 'FORBIDDEN')
      const s = db.saveSettings({ language })
      applyLocale()
      return { language: s.language }
    }],
    'search:all': ['user', (q) => db.searchAll(q)],

    'books:list': ['user', (p) => db.listBooks(p)],
    'books:search': ['user', (q) => db.searchBooks(q)],
    'books:get': ['user', (id) => db.getBook(id)],
    'copies:setStatus': ['user', (p) => db.setCopyStatus(p)],
    'books:save': ['user', (b) => db.saveBook(b)],
    'books:addCopy': ['user', (id) => db.addCopy(id)],
    'books:archive': ['admin', (id) => db.archiveBook(id)],
    'books:restore': ['admin', (id) => db.restoreBook(id)],

    'members:list': ['user', (p) => db.listMembers(p)],
    'members:search': ['user', (q) => db.searchMembers(q)],
    'members:get': ['user', (id) => db.getMember(id)],
    'members:save': ['user', (m) => db.saveMember(m)],
    'members:archive': ['admin', (id) => db.archiveMember(id)],
    'members:restore': ['admin', (id) => db.restoreMember(id)],

    'loans:list': ['user', (p) => db.listLoans(p)],
    'loans:borrow': ['user', (p) => db.borrow(p)],
    'loans:return': ['user', (id) => db.returnLoan(id)],
    'loans:searchOpen': ['user', (q) => db.searchOpenLoans(q)],
    'loans:renew': ['user', (id) => db.renewLoan(id)],

    'fines:list': ['user', (p) => db.listFines(p)],
    'fines:pay': ['user', (id) => db.payFine(id)],
    'fines:payMember': ['user', ({ member_id }) => db.payMemberFines(member_id)],
    'fines:waive': ['admin', (id) => db.waiveFine(id)],
    'fines:add': ['admin', (p) => db.addFine(p)],

    'reservations:create': ['user', (p) => db.reserve(p)],
    'reservations:cancel': ['user', (id) => db.cancelReservation(id)],
    'reservations:ready': ['user', () => db.readyReservations()],

    'reminders:text': ['user', (p) => db.reminderText(p)],

    'labels:pending': ['user', () => db.labelsPending()],
    'labels:book': ['user', (id) => db.labelsForBook(id)],
    'labels:mark': ['user', ({ ids }) => db.markLabelsPrinted(ids)],
    'cards:list': ['user', (p) => db.cardsFor(p?.ids)],
    'overdue:all': ['user', () => db.allOverdue()],

    /* يحفظ ما هو معروض في نافذة التطبيق (بتنسيق الطباعة) كملف PDF */
    'print:pdf': ['user', async ({ name = 'print', landscape = false } = {}) => {
      const safe = String(name).replace(/[^\p{L}\p{N}_-]/gu, '') || 'print'
      const { canceled, filePath } = await ctx.dialog.showSaveDialog(ctx.getWindow(), {
        defaultPath: `${safe}-${backup.localDate()}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (canceled || !filePath) return { canceled: true }
      const buf = await ctx.getWindow().webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, landscape: !!landscape })
      fs.writeFileSync(filePath, buf)
      return { canceled: false, filePath }
    }],

    /* يفتح برنامج البريد الافتراضي (mailto فقط) */
    'app:openMail': ['user', async ({ to, subject = '', body = '' }) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to))) throw new Error(tr("البريد الإلكتروني غير صالح"))
      const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      await ctx.shell.openExternal(url)
      return true
    }],

    'users:list': ['admin', () => db.listUsers()],
    'users:save': ['admin', (p) => {
      if (!p.id) return db.createUser(p)
      if (p.id === currentUser.id && (!p.active || p.role !== 'admin'))
        throw new Error(tr("لا يمكنك إيقاف حسابك أو تغيير صلاحيتك بنفسك"))
      return db.updateUser(p)
    }],
    'users:resetPassword': ['admin', ({ id, password }) => db.resetPassword(id, password)],

    'excel:export': ['admin', async ({ kind }) => {
      const { canceled, filePath } = await ctx.dialog.showSaveDialog(ctx.getWindow(), {
        defaultPath: `${kind}-${backup.localDate()}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
      if (canceled || !filePath) return { canceled: true }
      const count = await excel.exportKind(kind, db, filePath)
      return { canceled: false, filePath, count }
    }],
    'excel:template': ['admin', async ({ kind }) => {
      const { canceled, filePath } = await ctx.dialog.showSaveDialog(ctx.getWindow(), {
        defaultPath: `template-${kind}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      })
      if (canceled || !filePath) return { canceled: true }
      await excel.template(kind, filePath)
      return { canceled: false, filePath }
    }],
    'excel:pickImport': ['admin', async ({ kind }) => {
      const r = await ctx.dialog.showOpenDialog(ctx.getWindow(), {
        properties: ['openFile'],
        filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'csv'] }],
      })
      if (r.canceled || !r.filePaths[0]) return { canceled: true }
      const rows = await excel.readRows(kind, r.filePaths[0])
      const items = kind === 'books' ? db.previewBooks(rows) : db.previewMembers(rows)
      pendingImport = { kind, rows }
      const counts = { new: 0, duplicate: 0, invalid: 0 }
      for (const it of items) counts[it.status]++
      return {
        canceled: false,
        kind,
        file: path.basename(r.filePaths[0]),
        total: items.length,
        counts,
        // نعرض كل المشاكل أولًا ثم عينة من الصفوف السليمة
        items: [...items.filter((i) => i.status !== 'new'), ...items.filter((i) => i.status === 'new')].slice(0, 100),
      }
    }],
    'excel:commitImport': ['admin', ({ mode }) => {
      if (!pendingImport) throw new Error(tr("لا يوجد ملف معاينة. اختر الملف من جديد."))
      const { kind, rows } = pendingImport
      pendingImport = null
      return kind === 'books' ? db.importBooks(rows, mode === 'copies' ? 'copies' : 'skip') : db.importMembers(rows)
    }],

    'backup:list': ['admin', () => ({ dir: ctx.backupDir, items: backup.list(ctx.backupDir) })],
    'backup:create': ['admin', () => ({ name: path.basename(backup.manual(db.raw, ctx.backupDir)) })],
    'backup:export': ['admin', async () => {
      const { canceled, filePath } = await ctx.dialog.showSaveDialog(ctx.getWindow(), {
        defaultPath: `library-backup-${backup.localDate()}.db`,
        filters: [{ name: 'SQLite', extensions: ['db'] }],
      })
      if (canceled || !filePath) return { canceled: true }
      backup.make(db.raw, filePath)
      return { canceled: false, filePath }
    }],
    'backup:restore': ['admin', ({ name }) => {
      if (path.basename(String(name)) !== name) throw new Error(tr("اسم ملف غير صالح"))
      restoreFrom(path.join(ctx.backupDir, name))
      return { canceled: false }
    }],
    'backup:restoreFile': ['admin', async () => {
      const r = await ctx.dialog.showOpenDialog(ctx.getWindow(), {
        properties: ['openFile'],
        filters: [{ name: 'SQLite', extensions: ['db', 'sqlite'] }],
      })
      if (r.canceled || !r.filePaths[0]) return { canceled: true }
      restoreFrom(r.filePaths[0])
      return { canceled: false }
    }],
    'backup:openFolder': ['admin', () => ctx.shell.openPath(ctx.backupDir)],
  }

  async function invoke(channel, payload) {
    try {
      const entry = table[channel]
      if (!entry) throw new Error(tr("قناة غير معروفة"))
      const [role, fn] = entry
      if (role !== 'public') {
        if (!currentUser) throw fail(tr("انتهت الجلسة. سجّل الدخول من جديد."), 'AUTH')
        const u = db.getUser(currentUser.id) // الصلاحية تُقرأ من القاعدة في كل طلب
        if (!u || !u.active) { currentUser = null; throw fail(tr("تم إيقاف هذا الحساب."), 'AUTH') }
        currentUser = pub(u)
        if (role === 'admin' && currentUser.role !== 'admin') throw fail(tr("ليست لديك صلاحية لهذا الإجراء."), 'FORBIDDEN')
      }
      const before = currentUser
      const result = await fn(payload)
      // الدخول والإعداد يعرفان الفاعل بعد التنفيذ؛ والخروج والاسترجاع يعرفانه قبله
      record(channel, payload, result, channel === 'auth:login' || channel === 'auth:setup' ? currentUser : before)
      return { ok: true, data: result }
    } catch (e) {
      recordFailure(channel, payload, e)
      const internal = String(e.code || '').startsWith('SQLITE')
      if (internal) console.error(e)
      return {
        ok: false,
        error: internal ? tr("حدث خطأ في قاعدة البيانات") : e.message,
        code: internal ? undefined : e.code,
        info: e.info,
      }
    }
  }

  /* لا نكتب نسخة احتياطية من قاعدة تالفة: قد تحلّ محل نسخة سليمة بنفس اليوم */
  const healthy = () => {
    try { return db.raw.pragma('quick_check', { simple: true }) === 'ok' } catch { return false }
  }

  return {
    invoke,
    channels: Object.keys(table),
    getDb: () => db,
    /* نسخة يومية: عند الفتح ثم كل ساعة */
    ensureDaily() {
      try {
        if (!backup.hasToday(ctx.backupDir) && healthy()) backup.auto(db.raw, ctx.backupDir)
      } catch (e) { console.error(e) }
    },
    /* عند الإغلاق: نسخة أخيرة ثم إغلاق القاعدة */
    shutdown() {
      try { if (healthy()) backup.auto(db.raw, ctx.backupDir) } catch (e) { console.error(e) }
      try { db.raw.close() } catch { /* تجاهل */ }
    },
  }
}

module.exports = { createHandlers }
