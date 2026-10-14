const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron')
const path = require('path')
const { createDb } = require('./db')
const { createHandlers } = require('./handlers')
const backup = require('./backup')
const { openWithRecovery } = require('./recovery')
const { tr, getLocale } = require('./i18n')

// وضع التطوير صريح (--dev). الاعتماد على app.isPackaged وحده كان يجعل «npm start» (electron .) يطلب
// خادم Vite غير الموجود فتبقى النافذة فارغة.
const isDev = process.argv.includes('--dev')
// أدوات المطوّر بطلب صريح فقط: تتيح تنفيذ شيفرة بصلاحيات المستخدم المسجَّل، فلا تُفتح افتراضيًا
const DEBUG = process.argv.includes('--devtools') || process.env.ELECTRON_DEVTOOLS === '1'
const DEV_URL = 'http://localhost:5173'
const DEV_RETRY_MS = 500
const DEV_RETRIES = 40
let win
let handlers
let recovered = null // يُملأ إن استُرجعت نسخة احتياطية عند التشغيل بسبب تلف الملف

/* ---------- النافذة ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#f1f4f3',
    title: tr("تسيير المكتبة"),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  Menu.setApplicationMenu(null)
  // منع فتح نوافذ جديدة أو التنقل لخارج التطبيق
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(DEV_URL) && !url.startsWith('file://')) e.preventDefault()
  })
  watch(win)
  if (isDev) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '../dist/index.html'))
}

/* ---------- الواجهة الفارغة يجب ألّا تكون صامتة أبدًا ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** صفحة شرح تُعرض بدل الفراغ حين يفشل تحميل الواجهة */
function errorPage(title, lines) {
  const loc = getLocale()
  const html =
    `<!doctype html><html lang="${loc}" dir="${loc === 'ar' ? 'rtl' : 'ltr'}"><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<body style="font:16px/1.9 system-ui,'Segoe UI',Tahoma,sans-serif;background:#f1f4f3;color:#17262b;margin:0;padding:48px">` +
    `<div style="max-width:720px;margin:auto"><h1 style="font-size:28px;margin-top:0">${esc(title)}</h1>` +
    lines.map((l) => `<p style="margin:12px 0">${esc(l)}</p>`).join('') +
    `</div></body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

function watch(win) {
  const wc = win.webContents
  let tries = 0

  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (code === -3) return // ERR_ABORTED: تنقّل أُلغي عمدًا
    console.error(`[main] did-fail-load ${code} ${desc} ${url}`)
    if (!isMainFrame || String(url).startsWith('data:')) return
    // وضع التطوير: Vite قد لا يكون جاهزًا بعد (رفض اتصال)، فنعيد المحاولة قبل الاستسلام
    if (isDev && code === -102 && tries < DEV_RETRIES) {
      tries += 1
      setTimeout(() => { if (!win.isDestroyed()) win.loadURL(DEV_URL) }, DEV_RETRY_MS)
      return
    }
    win.loadURL(
      errorPage(tr("تعذّر تحميل واجهة التطبيق"), [
        tr("السبب: {0} ({1})", [desc, code]),
        String(url),
        isDev
          ? tr("وضع التطوير: تأكد أن خادم Vite يعمل على {0}. شغّل التطبيق بالأمر npm run dev.", [DEV_URL])
          : tr("إن لم يكن مجلد dist موجودًا فنفّذ npm run build ثم npm start."),
      ])
    )
  })

  wc.on('render-process-gone', (_e, details) => {
    console.error('[main] render-process-gone', details)
    win.loadURL(errorPage(tr("توقفت عملية الواجهة"), [tr("السبب: {0}", [details?.reason ?? '?'])]))
  })

  // أخطاء الواجهة (استثناءات غير ممسوكة وغيرها) تظهر في الطرفية بدل أن تختفي
  wc.on('console-message', (...a) => {
    const d = a[0] // Electron الحديث: كائن تفاصيل؛ القديم: (event, level, message, line, sourceId)
    const level = typeof d?.level === 'string' ? d.level : ['verbose', 'info', 'warning', 'error'][a[1]] || 'info'
    const message = d?.message ?? a[2]
    if (level === 'error' || level === 'warning') console.error(`[renderer:${level}] ${message} (${d?.sourceId ?? a[4] ?? ''}:${d?.lineNumber ?? a[3] ?? ''})`)
  })
  wc.on('preload-error', (_e, preloadPath, error) => console.error('[main] preload-error', preloadPath, error))

  if (DEBUG) {
    wc.openDevTools({ mode: 'detach' })
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && String(input.key).toLowerCase() === 'i'))) {
        wc.toggleDevTools()
        e.preventDefault()
      }
    })
  }
}

/* ---------- دورة حياة التطبيق ---------- */
const gotLock = app.requestSingleInstanceLock() // يمنع تشغيل نسختين على الملف نفسه
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    const dbPath = path.join(app.getPath('userData'), 'library.db')
    const backupDir = path.join(app.getPath('userData'), 'backups')
    const rawOpen = () =>
      createDb(dbPath, {
        onBeforeMigrate: (from, raw) => backup.make(raw, path.join(backupDir, `pre-migration-v${from}-${backup.stamp()}.db`)),
      })
    let first = true
    // أول فتح فقط يمرّ بفحص السلامة والاسترجاع التلقائي (الاسترجاع اليدوي يفتح مباشرة)
    const openDb = () => {
      if (!first) return rawOpen()
      first = false
      const r = openWithRecovery({ dbPath, backupDir, open: rawOpen })
      recovered = r.recovered
      return r.db
    }

    try {
      handlers = createHandlers({
        dbPath,
        backupDir,
        dialog,
        shell,
        getWindow: () => win,
        openDb,
      })
    } catch (e) {
      dialog.showErrorBox(tr("تعذّر فتح قاعدة البيانات"), e.message)
      app.quit()
      return
    }

    for (const channel of handlers.channels) ipcMain.handle(channel, (_e, payload) => handlers.invoke(channel, payload))
    createWindow()

    if (recovered) {
      dialog.showMessageBox(win, {
        type: 'warning',
        title: tr("استُرجعت نسخة احتياطية"),
        message: tr("اكتُشف تلف في ملف قاعدة البيانات، فاستُرجعت أحدث نسخة احتياطية سليمة."),
        detail:
          tr("النسخة المستعملة: {0} ({1}).\n", [recovered.backupName, new Date(recovered.backupTime).toLocaleString('sv-SE').slice(0, 16)]) +
          tr("ما أُنجز بعد هذا التاريخ غير موجود الآن، فراجع الإعارات الأخيرة.\n") +
          tr("حُفظ الملف التالف للفحص في:\n{0}", [recovered.corruptCopy]),
      })
    }

    handlers.ensureDaily()
    setInterval(() => handlers.ensureDaily(), 60 * 60 * 1000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((e) => {
    console.error('[main] startup failed', e)
    dialog.showErrorBox(tr("تعذّر تشغيل التطبيق"), String(e?.stack || e))
    app.quit()
  })

  let quitting = false
  app.on('before-quit', () => {
    if (quitting || !handlers) return
    quitting = true
    handlers.shutdown()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
