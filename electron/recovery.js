/**
 * فتح قاعدة البيانات عند التشغيل مع معالجة التلف (انقطاع كهرباء، قرص تالف...).
 * إن كان الملف تالفًا: يُحفظ كما هو باسم library.corrupt-<وقت>.db (لا يُحذف أبدًا)
 * ثم تُسترجع أحدث نسخة احتياطية سليمة. إن لم توجد نسخة سليمة يُرمى خطأ يشرح الموقف.
 */
const fs = require('fs')
const path = require('path')
const backup = require('./backup')
const { SCHEMA_VERSION } = require('./db')
const { tr } = require('./i18n')

const wipe = (file) => { for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true }) }

/** هل الخطأ دليل على تلف الملف (لا على سبب آخر مثل إصدار أحدث من التطبيق)؟ */
function isCorruption(e) {
  const code = String(e?.code || '')
  return code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT' || code.startsWith('SQLITE_CORRUPT') || /malformed|not a database|corrupt/i.test(String(e?.message))
}

/** @returns {{ db: any, recovered: null | { corruptCopy: string, backupName: string, backupTime: number } }} */
function openWithRecovery({ dbPath, backupDir, open }) {
  let reason
  try {
    const db = open()
    const res = db.raw.pragma('quick_check', { simple: true })
    if (res === 'ok') return { db, recovered: null }
    try { db.raw.close() } catch { /* تجاهل */ }
    reason = new Error(`quick_check: ${res}`)
  } catch (e) {
    if (!isCorruption(e)) throw e // مثال: «القاعدة أحدث من التطبيق» لا نلمسها
    reason = e
  }

  // الملف تالف: نبحث عن أحدث نسخة سليمة
  const candidates = backup.list(backupDir).filter((b) => b.name.endsWith('.db'))
  const good = candidates.find((b) => backup.validate(path.join(backupDir, b.name), SCHEMA_VERSION).ok)
  const stamp = backup.stamp()
  const corruptCopy = path.join(path.dirname(dbPath), `library.corrupt-${stamp}.db`)

  if (!good) {
    const err = new Error(
      tr("ملف قاعدة البيانات تالف ولا توجد نسخة احتياطية سليمة لاسترجاعها.\n") +
      tr("الملف: {0}\nالسبب: {1}\n", [dbPath, reason.message]) +
      tr("لم يُحذف شيء. انسخ الملف إلى مكان آمن واطلب المساعدة قبل أي خطوة أخرى.")
    )
    err.code = 'CORRUPT_NO_BACKUP'
    throw err
  }

  fs.copyFileSync(dbPath, corruptCopy) // نحفظ التالف للفحص
  wipe(dbPath)
  fs.copyFileSync(path.join(backupDir, good.name), dbPath)
  const db = open()
  return { db, recovered: { corruptCopy, backupName: good.name, backupTime: good.mtime } }
}

module.exports = { openWithRecovery, isCorruption }
