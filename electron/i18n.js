// لغة رسائل الخادم (الأخطاء، سجل العمليات، التذكيرات، Excel). نفس منطق src/i18n.js.
// اللغة إعداد للمكتبة كلها: تُضبط عند التشغيل وعند حفظ الإعدادات.
const fr = require('../shared/locales/fr.json')

const CATALOGS = { ar: {}, fr }
let locale = 'ar'

const fill = (s, args) => (args ? s.replace(/\{(\d+)\}/g, (_, i) => String(args[i] ?? '')) : s)

module.exports = {
  LANGUAGES: Object.keys(CATALOGS),
  getLocale: () => locale,
  setLocale: (l) => { locale = CATALOGS[l] ? l : 'ar' },
  tr: (key, args) => fill(CATALOGS[locale]?.[key] ?? key, args),
  tk: (key) => key,
  trIn: (l, key, args) => fill(CATALOGS[l]?.[key] ?? key, args),
}
