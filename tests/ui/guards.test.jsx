import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import ErrorBoundary from '../../src/ErrorBoundary.jsx'
import { setLocale } from '../../src/i18n.js'

const root = path.resolve(__dirname, '../..')
const guardCode = fs.readFileSync(path.join(root, 'public/boot-guard.js'), 'utf8')

/** نافذة jsdom معزولة بحارس مُحمَّل فيها، ومهلة قصيرة للاختبار */
function guardedWindow({ rootHtml = '', timeoutMs = 8000 } = {}) {
  const dom = new JSDOM(`<!doctype html><body><div id="root">${rootHtml}</div></body>`, { runScripts: 'outside-only' })
  dom.window.eval(guardCode.replace('var TIMEOUT_MS = 8000', `var TIMEOUT_MS = ${timeoutMs}`))
  return dom.window
}
const alertText = (w) => w.document.querySelector('[role="alert"]')?.textContent ?? null

describe('حدّ أخطاء React', () => {
  beforeEach(() => { setLocale('ar'); vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks(); setLocale('ar') })

  const Boom = () => { throw new Error('انفجار أثناء الرسم') }

  test('الفرع السليم يُرسم كما هو بلا تدخل', () => {
    render(<ErrorBoundary><p>محتوى سليم</p></ErrorBoundary>)
    expect(screen.getByText('محتوى سليم')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('خطأ أثناء الرسم يُظهر الرسالة ونص الخطأ وزر إعادة التحميل بدل الفراغ', () => {
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } })
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    const box = screen.getByRole('alert')
    expect(box.textContent).toContain('حدث خطأ غير متوقع في الواجهة')
    expect(box.textContent).toContain('انفجار أثناء الرسم')          // نص الخطأ ظاهر ليُرسَل للمطوّر
    expect(box.querySelector('pre').getAttribute('dir')).toBe('ltr')
    fireEvent.click(screen.getByRole('button', { name: 'إعادة التحميل' }))
    expect(reload).toHaveBeenCalledOnce()
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  })

  test('بالفرنسية', () => {
    setLocale('fr')
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toContain("Une erreur inattendue s'est produite dans l'interface")
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeTruthy()
  })

  test('main.jsx يلفّ التطبيق بالحدّ فعلًا (لا يُحذف سهوًا)', () => {
    const main = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8')
    expect(main).toMatch(/<ErrorBoundary>[\s\S]*<App \/>[\s\S]*<\/ErrorBoundary>/)
  })
})

describe('حارس الإقلاع (public/boot-guard.js)', () => {
  test('استثناء قبل رسم الواجهة يُظهر نصه وموضعه بالعربية والفرنسية', () => {
    const w = guardedWindow()
    w.dispatchEvent(new w.ErrorEvent('error', { message: 'x is not defined', filename: 'app.js', lineno: 7, colno: 3 }))
    const t = alertText(w)
    expect(t).toContain('تعذّر عرض الواجهة')
    expect(t).toContain('Impossible d’afficher l’interface')
    expect(t).toContain('x is not defined')
    expect(t).toContain('app.js:7:3')
    expect(t).toContain('npm start -- --devtools')
  })

  test('فشل تحميل مورد (سكربت/CSS) يُلتقط رغم أنه لا يفور إلى window', () => {
    const w = guardedWindow()
    const img = w.document.createElement('img')
    img.setAttribute('src', 'file:///C:/app/dist/assets/index.js')
    w.document.body.appendChild(img)
    img.dispatchEvent(new w.Event('error'))
    expect(alertText(w)).toContain('Failed to load: file:///C:/app/dist/assets/index.js')
  })

  test('رفض وعد غير ممسوك يُلتقط', () => {
    const w = guardedWindow()
    const ev = new w.Event('unhandledrejection')
    ev.reason = new w.Error('فشل الاتصال')
    w.dispatchEvent(ev)
    expect(alertText(w)).toContain('فشل الاتصال')
  })

  test('لا يتدخل إن كانت الواجهة قد رُسمت (أخطاء لاحقة ليست من شأنه)', () => {
    const w = guardedWindow({ rootHtml: '<div>الواجهة تعمل</div>' })
    w.dispatchEvent(new w.ErrorEvent('error', { message: 'خطأ لاحق' }))
    expect(alertText(w)).toBeNull()
    expect(w.document.getElementById('root').textContent).toBe('الواجهة تعمل')
  })

  test('يظهر مرة واحدة فقط مهما تكررت الأخطاء', () => {
    const w = guardedWindow()
    for (let i = 0; i < 3; i++) w.dispatchEvent(new w.ErrorEvent('error', { message: `e${i}` }))
    expect(w.document.querySelectorAll('[role="alert"]').length).toBe(1)
    expect(alertText(w)).toContain('e0')
  })

  test('واجهة لم تُرسم بعد المهلة: يُنبَّه ولو لم يقع أي خطأ (حالة النافذة البيضاء)', async () => {
    const w = guardedWindow({ timeoutMs: 40 })
    expect(alertText(w)).toBeNull()
    await new Promise((r) => setTimeout(r, 120))
    expect(alertText(w)).toContain('No UI was rendered after')
  })

  test('واجهة رُسمت قبل المهلة: لا تنبيه', async () => {
    const w = guardedWindow({ timeoutMs: 40 })
    w.document.getElementById('root').innerHTML = '<main>مرحبًا</main>'
    await new Promise((r) => setTimeout(r, 120))
    expect(alertText(w)).toBeNull()
  })

  test('نص الخطأ لا يُفسَّر شيفرة أبدًا (لا XSS من رسائل الأخطاء)', () => {
    const w = guardedWindow()
    w.dispatchEvent(new w.ErrorEvent('error', { message: '<img src=x onerror=alert(1)><b>غامق</b>' }))
    expect(w.document.querySelector('[role="alert"] img')).toBeNull()
    expect(w.document.querySelector('[role="alert"] b')).toBeNull()
    expect(alertText(w)).toContain('<img src=x onerror=alert(1)>')
    // لا استعمال لأي واجهة تُفسّر النص شيفرة (التعليق الشارح لا يُحتسب لأنه لا يحوي نقطة قبل الاسم)
    expect(guardCode).not.toMatch(/\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write/)
  })

  test('يُحقن في أول <head> في الإنتاج قبل سكربت الواجهة (فحص ملف البناء إن وُجد)', () => {
    const dist = path.join(root, 'dist/index.html')
    if (!fs.existsSync(dist)) return
    const html = fs.readFileSync(dist, 'utf8')
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
    expect(head.indexOf('boot-guard.js')).toBeGreaterThan(-1)
    expect(head.indexOf('boot-guard.js')).toBeLessThan(head.indexOf('type="module"'))
    expect(fs.existsSync(path.join(root, 'dist/boot-guard.js'))).toBe(true)
  })
})
