/** يستخرج مفاتيح الترجمة (الوسيط الأول لـ tr/tk) من المصدر. node scripts/i18n-extract.cjs [--json] */
const path = require('path')
const { sourceFiles, scan } = require('./i18n-lib.cjs')
const root = path.resolve(__dirname, '..')
const map = new Map()
for (const f of sourceFiles(root)) {
  for (const k of scan(f).keys) {
    const e = map.get(k.key) || { key: k.key, files: new Set() }
    e.files.add(path.relative(root, f).replace(/^(src|electron)\//, ''))
    map.set(k.key, e)
  }
}
const list = [...map.values()].map((e) => ({ key: e.key, files: [...e.files] }))
if (process.argv.includes('--json')) console.log(JSON.stringify(list))
else {
  console.log('مفاتيح فريدة:', list.length)
  for (const e of list) console.log(JSON.stringify(e.key), '  //', e.files.join(','))
}
