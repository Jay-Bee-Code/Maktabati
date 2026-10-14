import { tr } from './i18n.js'
// جسر الاتصال بين الواجهة وقاعدة البيانات (عبر Electron IPC)
export async function call(channel, payload) {
  if (!window.api) throw new Error(tr("يجب تشغيل التطبيق داخل Electron (npm run dev)"))
  const res = await window.api.invoke(channel, payload)
  if (!res.ok) {
    const e = new Error(res.error)
    e.code = res.code
    e.info = res.info
    // انتهاء الجلسة: يعيد التطبيق إلى شاشة الدخول
    if (res.code === 'AUTH') window.dispatchEvent(new Event('auth-lost'))
    throw e
  }
  return res.data
}
