// لغة الواجهة. المفتاح هو النص العربي نفسه، والعربية هي الأصل: لا قاموس لها.
// tr(key, args) يترجم الآن. tk(key) يعلّم نصًّا في ثابت على مستوى الملف، ويُترجَم عند العرض بـ tr(متغير).
import fr from '../shared/locales/fr.json'

const CATALOGS = { ar: {}, fr }
const DIR = { ar: 'rtl', fr: 'ltr' }
export const LOCALES = [
  ['ar', 'العربية'], // i18n-ignore: اسم اللغة بلغتها
  ['fr', 'Français'],
]

let locale = 'ar'
export const getLocale = () => locale
export const isRtl = () => DIR[locale] === 'rtl'
/** وسم اللغة للتواريخ والأرقام اللاتينية، مثل fr-u-nu-latn */
export const dateTag = () => `${locale}-u-nu-latn`

export function setLocale(l) {
  locale = CATALOGS[l] ? l : 'ar'
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
    document.documentElement.dir = DIR[locale]
    document.title = tr('تسيير المكتبة') // الاسم الافتراضي؛ يستبدله Shell باسم المكتبة المخصَّص
  }
}

const fill = (s, args) => (args ? s.replace(/\{(\d+)\}/g, (_, i) => String(args[i] ?? '')) : s)

export function tr(key, args) {
  return fill(CATALOGS[locale]?.[key] ?? key, args)
}
export const tk = (key) => key
/** ترجمة إلى لغة محددة بغض النظر عن اللغة الحالية (لقبول عناوين أعمدة Excel بلغتين) */
export const trIn = (l, key, args) => fill(CATALOGS[l]?.[key] ?? key, args)
