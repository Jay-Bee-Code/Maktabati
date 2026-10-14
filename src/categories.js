import { tr, tk } from './i18n.js'

/** تسمية التصنيف الافتراضي تأتي من الخادم (SQL) نصًّا عربيًا، فتُترجَم عند العرض.
 *  tk هنا يسجّل المفتاح في القاموس ويراه اختبار الاكتمال. */
export const UNCATEGORIZED = tk('غير مصنّف')
export const catLabel = (name) => (name === UNCATEGORIZED ? tr(UNCATEGORIZED) : name)
