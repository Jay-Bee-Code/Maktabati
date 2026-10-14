const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { tr, tk } = require('./i18n')

const KINDS = {
  'auto-': tk("تلقائية"),
  'manual-': tk("يدوية"),
  'pre-restore-': tk("قبل الاسترجاع"),
  'pre-migration-': tk("قبل ترقية القاعدة"),
}

const pad = (n) => String(n).padStart(2, '0')
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stamp = (d = new Date()) => `${localDate(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

/* نسخة متسقة ومضغوطة عبر VACUUM INTO (متزامنة وآمنة مع WAL) */
function make(rawDb, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) fs.unlinkSync(file)
  rawDb.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  return file
}

function list(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.db'))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name))
      const prefix = Object.keys(KINDS).find((k) => name.startsWith(k))
      return { name, size: st.size, mtime: st.mtimeMs, kind: tr(prefix ? KINDS[prefix] : tk("أخرى")), code: prefix ? prefix.replace(/-$/, '') : 'other' }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

function prune(dir, prefix, keep) {
  list(dir)
    .filter((b) => b.name.startsWith(prefix))
    .slice(keep)
    .forEach((b) => {
      try { fs.unlinkSync(path.join(dir, b.name)) } catch { /* تجاهل */ }
    })
}

const hasToday = (dir) => fs.existsSync(path.join(dir, `auto-${localDate()}.db`))

function auto(rawDb, dir) {
  const f = make(rawDb, path.join(dir, `auto-${localDate()}.db`))
  prune(dir, 'auto-', 14)
  return f
}

function manual(rawDb, dir) {
  const f = make(rawDb, path.join(dir, `manual-${stamp()}.db`))
  prune(dir, 'manual-', 20)
  return f
}

/* التحقق من أن الملف قاعدة بيانات سليمة تخص التطبيق */
function validate(file, maxVersion) {
  let t
  try {
    t = new Database(file, { readonly: true, fileMustExist: true })
    if (t.pragma('integrity_check', { simple: true }) !== 'ok') return { ok: false, error: tr("الملف تالف (فشل فحص السلامة)") }
    const names = t.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    for (const need of ['books', 'members', 'loans'])
      if (!names.includes(need)) return { ok: false, error: tr("الملف ليس نسخة احتياطية لهذا التطبيق") }
    const version = t.pragma('user_version', { simple: true })
    if (version > maxVersion) return { ok: false, error: tr("النسخة أحدث من هذا التطبيق. حدّث التطبيق أولًا.") }
    return { ok: true, version, books: t.prepare('SELECT COUNT(*) c FROM books').get().c }
  } catch {
    return { ok: false, error: tr("الملف ليس قاعدة بيانات صالحة") }
  } finally {
    try { t?.close() } catch { /* تجاهل */ }
  }
}

module.exports = { make, list, prune, hasToday, auto, manual, validate, stamp, localDate }
