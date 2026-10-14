/**
 * تشغيل فعلي لـ electron/main.js ضد نسخة وهمية من electron (لا نافذة حقيقية).
 * يغطي ما لم تغطّه بقية الاختبارات: ربط النافذة والقنوات والاسترجاع عند الإقلاع.
 */
const { test, mock, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Module = require('module')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const Database = require('better-sqlite3')
const { createDb } = require('../electron/db')
const backup = require('../electron/backup')

const root = path.resolve(__dirname, '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'main-'))

/** electron وهمي: يسجّل كل ما تفعله main.js */
function makeElectron({ userData, lock = true }) {
  const ipc = new Map()
  const windows = []
  const dialog = { errors: [], messages: [], showErrorBox: (t, m) => dialog.errors.push([t, m]), showMessageBox: async (...a) => (dialog.messages.push(a), {}), showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) }
  class WebContents extends EventEmitter {
    constructor() { super(); this.devtools = []; this.toggles = 0; this.openHandler = null }
    setWindowOpenHandler(f) { this.openHandler = f }
    openDevTools(o) { this.devtools.push(o) }
    toggleDevTools() { this.toggles++ }
  }
  class BrowserWindow {
    constructor(opts) { this.opts = opts; this.webContents = new WebContents(); this.loaded = []; windows.push(this) }
    loadURL(u) { this.loaded.push(['url', u]) }
    loadFile(f) { this.loaded.push(['file', f]) }
    isDestroyed() { return false }
    isMinimized() { return false }
    focus() {}
    restore() {}
    static getAllWindows() { return windows }
  }
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, quitCalled: false,
    requestSingleInstanceLock: () => lock,
    whenReady: () => Promise.resolve(),
    getPath: () => userData,
    quit() { app.quitCalled = true },
  })
  const menu = { value: 'unset' }
  return {
    app, BrowserWindow, dialog, windows, ipc, menu,
    ipcMain: { handle: (ch, fn) => ipc.set(ch, fn) },
    Menu: { setApplicationMenu: (m) => { menu.value = m } },
    shell: { openPath: async () => '', openExternal: async () => {} },
  }
}

/** يحمّل main.js بوحدة electron الوهمية وبوسائط سطر الأوامر المعطاة ثم ينتظر انتهاء الإقلاع */
async function boot(electron, argv = []) {
  const orig = Module._load
  const realSetInterval = global.setInterval
  Module._load = function (request, ...rest) { return request === 'electron' ? electron : orig.call(this, request, ...rest) }
  global.setInterval = (...a) => { const t = realSetInterval(...a); t.unref?.(); return t } // مؤقّت ساعي لا يُبقي العملية حيّة
  const saved = process.argv
  process.argv = ['node', 'main', ...argv]
  delete require.cache[require.resolve('../electron/main.js')]
  try { require('../electron/main.js') } finally { Module._load = orig; process.argv = saved }
  await new Promise((r) => setImmediate(r))
  global.setInterval = realSetInterval
  return electron
}

const consoleLog = () => {
  const lines = []
  const orig = console.error
  console.error = (...a) => lines.push(a.map(String).join(' '))
  return { lines, restore: () => { console.error = orig } }
}
afterEach(() => mock.timers.reset())

test('الإنتاج (npm start): يحمّل dist/index.html لا خادم التطوير، بخيارات أمان صحيحة', async () => {
  const e = await boot(makeElectron({ userData: tmp() }))
  assert.equal(e.windows.length, 1)
  const w = e.windows[0]
  assert.deepEqual(w.loaded, [['file', path.join(root, 'dist/index.html')]]) // ← هذا ما كان مكسورًا: كان يحمّل localhost:5173
  assert.equal(w.opts.webPreferences.sandbox, true)
  assert.equal(w.opts.webPreferences.contextIsolation, true)
  assert.equal(w.opts.webPreferences.nodeIntegration, false)
  assert.ok(fs.existsSync(w.opts.webPreferences.preload), 'ملف preload غير موجود')
  assert.equal(e.menu.value, null)
  assert.equal(e.dialog.errors.length, 0)
})

test('وضع التطوير يُطلب صراحة بـ --dev ويحمّل خادم Vite', async () => {
  const e = await boot(makeElectron({ userData: tmp() }), ['--dev'])
  assert.deepEqual(e.windows[0].loaded, [['url', 'http://localhost:5173']])
  // app.isPackaged=false وحده لا يكفي
  const p = await boot(makeElectron({ userData: tmp() }), [])
  assert.equal(p.windows[0].loaded[0][0], 'file')
})

test('القنوات: كلها مسجّلة وتعمل فعلًا عبر IPC على قاعدة حقيقية', async () => {
  const e = await boot(makeElectron({ userData: tmp() }))
  for (const ch of ['app:info', 'auth:status', 'books:list', 'kiosk:search', 'reports:get', 'excel:pickImport', 'audit:list', 'backup:list'])
    assert.ok(e.ipc.has(ch), `قناة غير مسجّلة: ${ch}`)
  assert.deepEqual(await e.ipc.get('app:info')({}, undefined), { ok: true, data: { language: 'ar' } })
  const st = await e.ipc.get('auth:status')({}, undefined)
  assert.deepEqual(st.data, { hasUsers: false, user: null })
  assert.equal((await e.ipc.get('books:list')({}, {})).code, 'AUTH') // قناة محمية بلا جلسة
})

test('كل قناة تستدعيها الواجهة مسجّلة في الخادم (لا أخطاء إملائية في أسماء القنوات)', async () => {
  const e = await boot(makeElectron({ userData: tmp() }))
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]))
  const used = new Map()
  for (const f of walk(path.join(root, 'src')).filter((f) => /\.jsx?$/.test(f)))
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(?:call|invoke)\(\s*['"`]([a-z]+:[A-Za-z]+)['"`]/g)) used.set(m[1], path.relative(root, f))
  assert.ok(used.size > 40, `وجدتُ ${used.size} قناة فقط: الفحص معطّل`)
  const missing = [...used].filter(([ch]) => !e.ipc.has(ch)).map(([ch, f]) => `${ch}  (${f})`)
  assert.deepEqual(missing, [])
})

test('preload في بيئة معزولة: require محصور في electron، ويقبل كل قنوات الخادم ويرفض غيرها', async () => {
  const e = await boot(makeElectron({ userData: tmp() }))
  const exposed = {}
  const invoked = []
  const requireSandbox = (m) => {
    if (m !== 'electron') throw new Error(`require غير مسموح في preload المعزول: ${m}`)
    return {
      contextBridge: { exposeInMainWorld: (k, v) => { exposed[k] = v } },
      ipcRenderer: { invoke: (...a) => { invoked.push(a); return Promise.resolve('ok') } },
    }
  }
  const code = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8')
  new vm.Script(`(function (require) {${code}\n})`).runInNewContext({})(requireSandbox)
  assert.deepEqual(Object.keys(exposed), ['api'])
  assert.deepEqual(Object.keys(exposed.api), ['invoke'])
  for (const ch of e.ipc.keys()) assert.equal(await exposed.api.invoke(ch, {}), 'ok', `preload يرفض قناة الخادم ${ch}`)
  for (const bad of ['evil:x', 'auth:../x', 'auth', 'auth:', 'fs:readFile', 'AUTH:login']) await assert.rejects(exposed.api.invoke(bad, {}), undefined, bad)
  assert.equal(invoked.length, e.ipc.size)
})

test('فشل تحميل الواجهة في الإنتاج: صفحة شرح بدل الفراغ', async () => {
  const log = consoleLog()
  try {
    const e = await boot(makeElectron({ userData: tmp() }))
    const w = e.windows[0]
    w.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///x', true)             // تنقّل أُلغي: يُتجاهل
    w.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', false)     // إطار فرعي: يُتجاهل
    assert.equal(w.loaded.length, 1)
    w.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///C:/app/dist/index.html', true)
    assert.equal(w.loaded.length, 2)
    const page = decodeURIComponent(w.loaded[1][1])
    assert.match(w.loaded[1][1], /^data:text\/html/)
    assert.match(page, /ERR_FILE_NOT_FOUND/)
    assert.match(page, /npm run build/)
    assert.match(page, /dir="rtl"/)
    // فشل صفحة الشرح نفسها لا يدخل في حلقة
    w.webContents.emit('did-fail-load', {}, -2, 'ERR_FAILED', w.loaded[1][1], true)
    assert.equal(w.loaded.length, 2)
    assert.ok(log.lines.some((l) => l.includes('did-fail-load -6')))
  } finally { log.restore() }
})

test('وضع التطوير: يعيد المحاولة حتى يجهز Vite، ثم يشرح الأمر إن لم يجهز', async () => {
  const log = consoleLog()
  try {
    mock.timers.enable({ apis: ['setTimeout'] })
    const e = await boot(makeElectron({ userData: tmp() }), ['--dev'])
    const w = e.windows[0]
    const refuse = () => w.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:5173/', true)
    refuse()
    assert.equal(w.loaded.length, 1)       // لم يُعد بعد: ينتظر 500ms
    mock.timers.tick(500)
    assert.deepEqual(w.loaded[1], ['url', 'http://localhost:5173'])
    for (let i = 0; i < 39; i++) { refuse(); mock.timers.tick(500) }  // 40 محاولة في المجموع
    assert.equal(w.loaded.length, 41)
    refuse()                                // الحادية والأربعون: استسلام وشرح
    const last = decodeURIComponent(w.loaded[w.loaded.length - 1][1])
    assert.match(last, /npm run dev/)
    assert.match(last, /5173/)
  } finally { log.restore() }
})

test('انهيار عملية الواجهة يُظهر سببه', async () => {
  const log = consoleLog()
  try {
    const e = await boot(makeElectron({ userData: tmp() }))
    const w = e.windows[0]
    w.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9 })
    assert.match(decodeURIComponent(w.loaded[1][1]), /oom/)
    assert.ok(log.lines.some((l) => l.includes('render-process-gone')))
  } finally { log.restore() }
})

test('أخطاء الواجهة تصل الطرفية (الصيغتان الحديثة والقديمة)، والمعلومات العادية لا', async () => {
  const log = consoleLog()
  try {
    const e = await boot(makeElectron({ userData: tmp() }))
    const wc = e.windows[0].webContents
    wc.emit('console-message', { level: 'error', message: 'boom جديد', sourceId: 'app.js', lineNumber: 3 })
    wc.emit('console-message', { level: 'warning', message: 'تحذير', sourceId: 'a.js', lineNumber: 1 })
    wc.emit('console-message', { level: 'info', message: 'عادي', sourceId: 'a.js', lineNumber: 1 })
    wc.emit('console-message', {}, 3, 'boom قديم', 7, 'old.js')
    assert.ok(log.lines.includes('[renderer:error] boom جديد (app.js:3)'))
    assert.ok(log.lines.some((l) => l.startsWith('[renderer:warning] تحذير')))
    assert.ok(log.lines.includes('[renderer:error] boom قديم (old.js:7)'))
    assert.ok(!log.lines.some((l) => l.includes('عادي')))
  } finally { log.restore() }
})

test('أدوات المطوّر: مغلقة افتراضيًا (لا F12)، وتُفتح بـ --devtools فقط', async () => {
  const off = await boot(makeElectron({ userData: tmp() }))
  assert.equal(off.windows[0].webContents.devtools.length, 0)
  assert.equal(off.windows[0].webContents.listenerCount('before-input-event'), 0)

  const on = await boot(makeElectron({ userData: tmp() }), ['--devtools'])
  const wc = on.windows[0].webContents
  assert.deepEqual(wc.devtools, [{ mode: 'detach' }])
  const press = (input) => { let prevented = false; wc.emit('before-input-event', { preventDefault: () => { prevented = true } }, input); return prevented }
  assert.equal(press({ type: 'keyDown', key: 'F12' }), true)
  assert.equal(press({ type: 'keyDown', key: 'I', control: true, shift: true }), true)
  assert.equal(press({ type: 'keyDown', key: 'a' }), false)
  assert.equal(press({ type: 'keyUp', key: 'F12' }), false)
  assert.equal(wc.toggles, 2)
})

test('قفل التنقل: لا نوافذ جديدة ولا روابط خارجية', async () => {
  const e = await boot(makeElectron({ userData: tmp() }))
  const wc = e.windows[0].webContents
  assert.deepEqual(wc.openHandler(), { action: 'deny' })
  const nav = (url) => { let prevented = false; wc.emit('will-navigate', { preventDefault: () => { prevented = true } }, url); return prevented }
  assert.equal(nav('https://evil.example/x'), true)
  assert.equal(nav('http://localhost:5173/page'), false)
  assert.equal(nav('file:///C:/app/dist/index.html'), false)
})

test('فشل فتح القاعدة عند الإقلاع: رسالة خطأ وخروج، بلا نافذة', async () => {
  const userData = tmp()
  fs.mkdirSync(path.join(userData, 'library.db')) // مجلد بدل الملف: لا يمكن فتحه
  const e = await boot(makeElectron({ userData }))
  assert.equal(e.windows.length, 0)
  assert.equal(e.dialog.errors.length, 1)
  assert.equal(e.app.quitCalled, true)
})

test('تلف القاعدة عند الإقلاع: تُسترجع نسخة سليمة وتظهر رسالة بذلك (الربط الفعلي في main)', async () => {
  const userData = tmp()
  const dbPath = path.join(userData, 'library.db')
  const d = createDb(dbPath)
  for (let i = 1; i <= 40; i++) d.saveBook({ title: `كتاب ${i}`, author: 'م', copies: 2 })
  backup.auto(d.raw, path.join(userData, 'backups'))
  d.raw.close()
  const buf = fs.readFileSync(dbPath)
  for (let i = 4096; i < Math.min(buf.length, 16384); i++) buf[i] = 0xff
  fs.writeFileSync(dbPath, buf)
  fs.rmSync(dbPath + '-wal', { force: true })
  fs.rmSync(dbPath + '-shm', { force: true })

  const e = await boot(makeElectron({ userData }))
  assert.equal(e.windows.length, 1)
  assert.equal(e.dialog.messages.length, 1)
  const opts = e.dialog.messages[0][1]
  assert.equal(opts.type, 'warning')
  assert.match(opts.detail, /auto-\d{4}-\d\d-\d\d\.db/)
  assert.ok(fs.readdirSync(userData).some((f) => f.startsWith('library.corrupt-')))
  const list = await e.ipc.get('books:list')({}, {})
  assert.equal(list.code, 'AUTH')            // تعمل القاعدة المستردّة وراء الجلسة
  const t = new Database(dbPath, { readonly: true })
  assert.equal(t.prepare('SELECT COUNT(*) c FROM books').get().c, 40)
  t.close()
})

test('نسخة ثانية من التطبيق: تخرج فورًا ولا تفتح القاعدة ولا نافذة', async () => {
  const userData = tmp()
  const e = await boot(makeElectron({ userData, lock: false }))
  assert.equal(e.app.quitCalled, true)
  assert.equal(e.windows.length, 0)
  assert.equal(e.ipc.size, 0)
  assert.equal(fs.existsSync(path.join(userData, 'library.db')), false)
})

test('الإغلاق: نسخة احتياطية أخيرة ثم إغلاق القاعدة', async () => {
  const userData = tmp()
  const e = await boot(makeElectron({ userData }))
  e.app.emit('before-quit')
  const backups = fs.readdirSync(path.join(userData, 'backups'))
  assert.ok(backups.some((f) => /^auto-\d{4}-\d\d-\d\d\.db$/.test(f)))
  e.app.emit('window-all-closed')
  assert.equal(e.app.quitCalled, true)
})
