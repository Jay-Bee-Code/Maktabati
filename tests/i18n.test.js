/**
 * اختبار اكتمال الترجمة: يفحص المصدر نفسه لا القاموس فقط.
 * يفشل إن بقي نص عربي خارج tr()/tk()، أو نقصت ترجمة، أو بقي مفتاح مهجور، أو اختل عدد المتغيرات.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { scan, sourceFiles, AR } = require('../scripts/i18n-lib.cjs')

const root = path.resolve(__dirname, '..')
const fr = require('../shared/locales/fr.json')
const files = sourceFiles(root)
const scans = files.map((f) => ({ f: path.relative(root, f), ...scan(f) }))
const keys = new Map()
for (const s of scans) for (const k of s.keys) keys.set(k.key, `${s.f}:${k.line}`)
const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join(',')

test('لا نص عربي في المصدر خارج tr() أو tk() أو علامة i18n-ignore', () => {
  const bad = scans.flatMap((s) => s.untranslated.map((u) => `${u.file.replace(root + '/', '')}:${u.line} [${u.kind}] ${u.text}`))
  assert.deepEqual(bad, [])
  assert.ok(files.length > 25, 'لم تُمسح ملفات المصدر')
})

/* كل ملف لغة في shared/locales يُفحص بالقواعد نفسها: إضافة لغة جديدة لا تحتاج تعديل هذا الاختبار */
const fs = require('fs')
const localesDir = path.join(root, 'shared/locales')
const catalogs = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json')).map((f) => [f.replace('.json', ''), require(path.join(localesDir, f))])

test('يوجد قاموس واحد على الأقل (الفرنسية)', () => {
  assert.ok(catalogs.some(([code]) => code === 'fr'))
})

for (const [code, dict] of catalogs) {
  test(`[${code}] كل مفتاح مستعمل في المصدر له ترجمة`, () => {
    const missing = [...keys].filter(([k]) => !(k in dict)).map(([k, where]) => `${where}  ${k.slice(0, 60)}`)
    assert.deepEqual(missing, [])
  })

  test(`[${code}] لا مفاتيح مهجورة (تُحذف عند حذف النص من المصدر)`, () => {
    assert.deepEqual(Object.keys(dict).filter((k) => !keys.has(k)).map((k) => k.slice(0, 60)), [])
  })

  test(`[${code}] عدد العناصر {n} ومواضعها متطابقة بين المفتاح وترجمته`, () => {
    const bad = Object.entries(dict).filter(([k, v]) => ph(k) !== ph(v)).map(([k, v]) => `${k.slice(0, 40)} ⇢ ${v.slice(0, 40)}`)
    assert.deepEqual(bad, [])
  })

  test(`[${code}] القيم غير فارغة وليس فيها حروف عربية`, () => {
    const empty = Object.entries(dict).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k)
    const arabic = Object.entries(dict).filter(([, v]) => AR.test(v)).map(([k]) => k.slice(0, 40))
    assert.deepEqual(empty, [])
    assert.deepEqual(arabic, [])
  })

  test(`[${code}] المسافات الطرفية والأسطر الجديدة محفوظة (تُلصق الأجزاء ببعضها)`, () => {
    const bad = []
    for (const [k, v] of Object.entries(dict)) {
      // أقواس الاقتباس « » تحتاج مسافة في اللغات اللاتينية ولا تحتاجها العربية: استثناء مقصود عند هذا الحد فقط
      if (!k.startsWith('»') && /^\s/.test(k) !== /^\s/.test(v)) bad.push(`بداية: ${JSON.stringify(k).slice(0, 40)}`)
      if (!k.endsWith('«') && /\s$/.test(k) !== /\s$/.test(v)) bad.push(`نهاية: ${JSON.stringify(k).slice(0, 40)}`)
      if ((k.match(/\n/g) || []).length !== (v.match(/\n/g) || []).length) bad.push(`أسطر: ${JSON.stringify(k).slice(0, 40)}`)
    }
    assert.deepEqual(bad, [])
  })
}

test('tr و tk في الخادم: ملء المتغيرات، والرجوع للمفتاح، والعربية أصل', () => {
  const i18n = require('../electron/i18n')
  i18n.setLocale('ar')
  assert.equal(i18n.tr('إعارة «{0}» إلى {1}', ['ك', 'س']), 'إعارة «ك» إلى س')
  assert.equal(i18n.tr('نص غير موجود في القاموس'), 'نص غير موجود في القاموس')
  i18n.setLocale('fr')
  assert.equal(i18n.tr('الكتب'), 'Livres')
  assert.equal(i18n.tr('تمديد «{0}» حتى {1}', ['ك', '2026-01-01']), "Prolongation de « ك » jusqu'au 2026-01-01")
  assert.equal(i18n.tr('نص غير موجود في القاموس'), 'نص غير موجود في القاموس') // لا يفشل بل يعرض العربية
  assert.equal(i18n.trIn('ar', 'الكتب'), 'الكتب')   // بغض النظر عن اللغة الحالية
  assert.equal(i18n.tk('الكتب'), 'الكتب')           // tk لا يترجم عند الاستدعاء
  i18n.setLocale('xx')                               // لغة غير معروفة: ترجع للعربية
  assert.equal(i18n.getLocale(), 'ar')
  assert.equal(i18n.tr('{0} و{1}', [0, undefined]), '0 و')
})
