// نسخة مطابقة لدالة arnorm في electron/db.js (يتحقق tests/text.test.js من تطابقهما)
export function norm(s) {
  if (s == null) return ''
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/\u0671/g, 'ا')  // i18n-ignore: حرف تطبيع وظيفي
    .replace(/[\u0649\u06CC]/g, 'ي')  // i18n-ignore: حرف تطبيع وظيفي
    .replace(/\u0629/g, 'ه')  // i18n-ignore: حرف تطبيع وظيفي
    .replace(/\u06A9/g, 'ك')  // i18n-ignore: حرف تطبيع وظيفي
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
