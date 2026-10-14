import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MotionConfig } from 'framer-motion'
import { boot, seedAdmin, loginUi, nav } from './helpers.jsx'
import Kiosk from '../../src/Kiosk.jsx'
import { ToastProvider } from '../../src/ui.jsx'

const off = (n) => `date('now','localtime','${n} days')`
function loan(h, bookId, memberId, loanOff, dueOff, retOff = null) {
  const db = h.getDb().raw
  const copy = db.prepare('SELECT id FROM copies WHERE book_id = ? ORDER BY id LIMIT 1').get(bookId).id
  db.prepare(`INSERT INTO loans (book_id, member_id, copy_id, loan_date, due_date, return_date)
    VALUES (?, ?, ?, ${off(loanOff)}, ${off(dueOff)}, ${retOff === null ? 'NULL' : off(retOff)})`).run(bookId, memberId, copy)
}
const tile = (label) => screen.getByText(label).previousElementSibling.textContent

describe('المرحلة الرابعة: التقارير', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const reportData = async (call) => {
    await seedAdmin(call)
    await call('books:save', { title: 'الأكثر استعارة', author: 'أ', category: 'رواية', copies: 1 })
    await call('books:save', { title: 'ثاني', author: 'ب', category: 'علوم', copies: 1 })
    await call('books:save', { title: 'قديم راكد', author: 'ج', copies: 1 })
    await call('members:save', { name: 'نشيط' })
    await call('members:save', { name: 'عادي' })
    await call('users:save', { username: 'amin', display_name: 'أمين', role: 'librarian', password: 'secret-pass' })
    await call('auth:logout')
  }
  const fill = (h) => {
    loan(h, 1, 1, -40, -26, -30); loan(h, 1, 2, -20, -6, -2); loan(h, 2, 1, -10, 4, -1); loan(h, 1, 1, -5, -1)
    loan(h, 3, 2, -400, -386, -390)
    h.getDb().raw.prepare("UPDATE books SET created_at = date('now','localtime','-500 days') WHERE id = 3").run()
  }

  test('الملخص والرسم والقوائم، وتغيير الفترة يعيد الحساب', async () => {
    const user = userEvent.setup()
    const { h } = await boot(reportData)
    fill(h)
    await loginUi(user)
    await nav(user, 'التقارير')
    await screen.findByRole('heading', { name: 'التقارير' })
    await waitFor(() => expect(tile('إعارات الفترة')).toBe('4'))
    expect(tile('إرجاعات الفترة')).toBe('3')
    expect(tile('متوسط مدة الإعارة (يومًا)')).toBe('12.3')
    expect(tile('نسبة الإرجاع المتأخر')).toBe('33%')
    expect(tile('متأخرة الآن')).toBe('1')

    // الرسم: 12 شهرًا ومجموعها 4، مع نسخة نصية لقارئات الشاشة
    expect(screen.getByRole('img', { name: /الإعارات الشهرية خلال آخر 12 شهرًا/ })).toBeTruthy()
    const rows = within(screen.getByRole('table', { name: 'الإعارات الشهرية' })).getAllByRole('row')
    expect(rows.length).toBe(12)
    expect(rows.reduce((a, r) => a + Number(r.lastChild.textContent), 0)).toBe(4)

    const top = screen.getByRole('heading', { name: 'أكثر الكتب استعارة' }).closest('section')
    const items = within(top).getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain('الأكثر استعارة')
    expect(items[0].endsWith('3')).toBe(true)
    const members = screen.getByRole('heading', { name: 'أنشط الأعضاء' }).closest('section')
    expect(within(members).getAllByRole('listitem')[0].textContent).toContain('نشيط')
    const idle = screen.getByRole('heading', { name: 'كتب راكدة' }).closest('section')
    expect(within(idle).getByText('قديم راكد')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'الكل' }))
    await waitFor(() => expect(tile('إعارات الفترة')).toBe('5'))
    expect(tile('إرجاعات الفترة')).toBe('4')
  })

  test('أمين المكتبة لا يرى التقارير', async () => {
    const user = userEvent.setup()
    await boot(reportData)
    await loginUi(user, 'amin')
    await screen.findByRole('heading', { name: 'نظرة عامة' })
    expect(screen.queryByRole('button', { name: 'التقارير' })).toBeNull()
  })

  test('قاعدة فارغة: أصفار وعبارات واضحة بلا أخطاء', async () => {
    const user = userEvent.setup()
    await boot(async (c) => { await seedAdmin(c); await c('auth:logout') })
    await loginUi(user)
    await nav(user, 'التقارير')
    await waitFor(() => expect(tile('إعارات الفترة')).toBe('0'))
    expect(screen.getAllByText('لا توجد إعارات في هذه الفترة.').length).toBe(3)
    expect(screen.getByText('لا شيء راكد')).toBeTruthy()
  })
})

describe('المرحلة الرابعة: الوضع الداكن', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); delete document.documentElement.dataset.theme })

  test('التبديل فاتح ← داكن ← حسب النظام، ويُحفظ الاختيار', async () => {
    const user = userEvent.setup()
    const original = window.matchMedia
    await boot(async (c) => { await seedAdmin(c); await c('auth:logout') })
    await loginUi(user)
    await screen.findByRole('heading', { name: 'نظرة عامة' })
    expect(document.documentElement.dataset.theme).toBe('light') // النظام فاتح افتراضيًا

    await user.click(screen.getByRole('button', { name: /المظهر: حسب النظام/ }))
    expect(screen.getByRole('button', { name: /المظهر: فاتح/ })).toBeTruthy()
    expect(localStorage.getItem('theme')).toBe('light')

    await user.click(screen.getByRole('button', { name: /المظهر: فاتح/ }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')

    // «حسب النظام» يتبع تفضيل نظام التشغيل
    window.matchMedia = (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })
    await user.click(screen.getByRole('button', { name: /المظهر: داكن/ }))
    expect(localStorage.getItem('theme')).toBe('system')
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    window.matchMedia = original
  })

  test('الاختيار المحفوظ يُطبَّق عند الفتح التالي', async () => {
    const user = userEvent.setup()
    localStorage.setItem('theme', 'dark')
    await boot(async (c) => { await seedAdmin(c); await c('auth:logout') })
    await loginUi(user)
    await screen.findByRole('heading', { name: 'نظرة عامة' })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: /المظهر: داكن/ })).toBeTruthy()
  })
})

describe('المرحلة الرابعة: وضع القارئ', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const kioskData = async (c) => {
    await seedAdmin(c)
    await c('books:save', { title: 'الإسلام والحضارة', author: 'محمد', category: 'فكر', shelf: 'A-3', copies: 2 })
    await c('books:save', { title: 'الاسلام السياسي', author: 'علي', shelf: 'B-1', copies: 1 })
    await c('members:save', { name: 'سر العضو', phone: '0555000111' })
    await c('loans:borrow', { member_id: 1, barcode: 'B00001-1' })
    await c('loans:borrow', { member_id: 1, barcode: 'B00002-1' })
    await c('auth:logout')
  }

  test('بحث عربي مطبَّع، توفر ورفّ، بلا أي بيانات شخصية، وقفل الاختصارات والإغلاق', async () => {
    const user = userEvent.setup()
    const win = { setFullScreen: vi.fn() }
    await boot(kioskData, { win })
    await loginUi(user)
    await screen.findByRole('heading', { name: 'نظرة عامة' })
    await user.click(screen.getByRole('button', { name: 'وضع القارئ' }))
    const k = await screen.findByRole('dialog', { name: 'وضع القارئ' })
    expect(win.setFullScreen).toHaveBeenLastCalledWith(true)
    expect(within(k).getByText(/اكتب حرفين على الأقل/)).toBeTruthy()

    await user.type(within(k).getByRole('textbox', { name: 'ابحث عن كتاب' }), 'الاسلام')
    const list = await within(k).findByRole('list', { name: 'نتائج البحث' })
    const cards = within(list).getAllByRole('listitem')
    expect(cards.length).toBe(2)
    const a = cards.find((c) => c.textContent.includes('الإسلام والحضارة'))
    const b = cards.find((c) => c.textContent.includes('الاسلام السياسي'))
    expect(a.textContent).toContain('متاح (1 نسخة)')
    expect(a.textContent).toContain('A-3')
    expect(b.textContent).toContain('معار حاليًا')
    expect(k.textContent).not.toContain('سر العضو')
    expect(k.textContent).not.toContain('0555')

    // لا شريط أوامر ولا إغلاق بـ Escape
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('dialog', { name: 'بحث وأوامر' })).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'وضع القارئ' })).toBeTruthy()

    // الخروج: كلمة مرور خاطئة تُبقي الشاشة مع رسالة داخلها
    await user.click(within(k).getByRole('button', { name: /خروج \(للموظفين\)/ }))
    const ask = await screen.findByRole('dialog', { name: 'الخروج من وضع القارئ' })
    await user.type(within(ask).getByLabelText('كلمة مرور المستخدم الحالي'), 'wrong-pass')
    await user.click(within(ask).getByRole('button', { name: 'خروج' }))
    expect((await within(ask).findByRole('alert')).textContent).toBe('كلمة المرور غير صحيحة')
    expect(screen.getByRole('dialog', { name: 'وضع القارئ' })).toBeTruthy()

    // الصحيحة تُخرج وتُنهي ملء الشاشة
    await user.type(within(ask).getByLabelText('كلمة مرور المستخدم الحالي'), 'secret-pass')
    await user.click(within(ask).getByRole('button', { name: 'خروج' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'وضع القارئ' })).toBeNull())
    expect(win.setFullScreen).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('heading', { name: 'نظرة عامة' })).toBeTruthy()
  })

  test('الاختصارات داخل وضع القارئ لا تترك شيئًا مفتوحًا يظهر بعد الخروج', async () => {
    const user = userEvent.setup()
    await boot(kioskData)
    await loginUi(user)
    await nav(user, 'الكتب')
    await screen.findByRole('heading', { name: 'الكتب' })
    await user.click(screen.getByRole('button', { name: 'وضع القارئ' }))
    const k = await screen.findByRole('dialog', { name: 'وضع القارئ' })
    await user.keyboard('{Control>}n{/Control}')
    await user.keyboard('{Control>}k{/Control}')
    await user.click(within(k).getByRole('button', { name: /خروج \(للموظفين\)/ }))
    const ask = await screen.findByRole('dialog', { name: 'الخروج من وضع القارئ' })
    await user.type(within(ask).getByLabelText('كلمة مرور المستخدم الحالي'), 'secret-pass')
    await user.click(within(ask).getByRole('button', { name: 'خروج' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'وضع القارئ' })).toBeNull())
    expect(screen.queryByRole('dialog', { name: 'إضافة كتاب' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'بحث وأوامر' })).toBeNull()
  })

  test('نتيجة فارغة تُظهر رسالة، والبحث بحرف واحد لا يُنفَّذ', async () => {
    const user = userEvent.setup()
    await boot(kioskData)
    await loginUi(user)
    await user.click(await screen.findByRole('button', { name: 'وضع القارئ' }))
    const k = await screen.findByRole('dialog', { name: 'وضع القارئ' })
    const box = within(k).getByRole('textbox', { name: 'ابحث عن كتاب' })
    await user.type(box, 'ا')
    expect(within(k).getByText(/اكتب حرفين على الأقل/)).toBeTruthy()
    await user.type(box, 'ظظظ')
    expect(await within(k).findByText(/لا توجد نتائج لـ/)).toBeTruthy()
  })

  test('الخمول يفرّغ البحث ليبدأ القارئ التالي من صفحة نظيفة', async () => {
    const user = userEvent.setup()
    await boot(async (c) => { await kioskData(c); await c('auth:login', { username: 'admin', password: 'secret-pass' }) })
    render(<MotionConfig><ToastProvider><Kiosk idleMs={300} onExit={() => {}} /></ToastProvider></MotionConfig>)
    const k = (await screen.findAllByRole('dialog', { name: 'وضع القارئ' })).at(-1)
    const box = within(k).getByRole('textbox', { name: 'ابحث عن كتاب' })
    await user.type(box, 'الاسلام')
    await within(k).findByRole('list', { name: 'نتائج البحث' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 3000 })
    await waitFor(() => expect(within(k).queryByRole('list', { name: 'نتائج البحث' })).toBeNull())
    expect(document.activeElement).toBe(box)
  })
})
