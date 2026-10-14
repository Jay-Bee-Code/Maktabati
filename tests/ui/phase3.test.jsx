import { describe, test, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { boot, seedAdmin, loginUi, nav } from './helpers.jsx'

/** يلتقط ما رُسم في #print-root لحظة استدعاء window.print */
function capturePrint() {
  const out = { calls: 0, root: null }
  window.print = () => {
    out.calls++
    out.root = document.getElementById('print-root').cloneNode(true)
  }
  return out
}

const overdue = (h, days) => h.getDb().raw.prepare(`UPDATE loans SET due_date = date('now','localtime','-${days} days')`).run()

const seedBooks = async (call) => {
  await seedAdmin(call)
  await call('books:save', { title: 'ك1', author: 'م', copies: 2 })
  await call('members:save', { name: 'سارة', email: 'sara@example.com' })
  await call('auth:logout')
}

describe('المرحلة الثالثة: الطباعة', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  test('ملصقات الباركود: العدّ والصفحات والخانة الأولى، ثم تأكيد التعليم', async () => {
    const user = userEvent.setup()
    const out = capturePrint()
    const { call } = await boot(seedBooks)
    await loginUi(user)
    await nav(user, 'الكتب')
    await user.click(await screen.findByRole('button', { name: 'ملصقات الباركود' }))
    const dlg = await screen.findByRole('dialog', { name: 'طباعة ملصقات الباركود' })
    expect((await within(dlg).findByText(/ملصقًا على/)).textContent.replace(/\s+/g, ' ').trim()).toBe('2 ملصقًا على 1 صفحة')

    const start = within(dlg).getByLabelText(/ابدأ من الخانة/)
    await user.clear(start)
    await user.type(start, '21')
    expect(within(dlg).getByText(/ملصقًا على/).textContent.replace(/\s+/g, ' ').trim()).toBe('2 ملصقًا على 2 صفحات')

    await user.click(within(dlg).getByRole('button', { name: 'طباعة' }))
    await within(dlg).findByText(/هل طُبعت الملصقات بنجاح/)
    expect(out.calls).toBe(1)
    const pages = out.root.querySelectorAll('.lbl-page')
    expect(pages.length).toBe(2)
    expect(out.root.querySelectorAll('svg[role="img"]').length).toBe(2)       // باركود لكل ملصق فقط
    expect(pages[0].querySelectorAll('.lbl').length).toBe(21)
    expect(pages[0].querySelectorAll('.lbl')[20].textContent).toContain('B00001-1') // الخانة 21
    expect(pages[1].querySelector('.lbl').textContent).toContain('B00001-2')
    expect(out.root.textContent).toContain('ك1')

    // «لا» يُبقي الملصقات غير مطبوعة
    await user.click(within(dlg).getByRole('button', { name: 'لا، سأعيد الطباعة' }))
    expect((await call('labels:pending')).length).toBe(2)
    await user.click(within(dlg).getByRole('button', { name: 'طباعة' }))
    await user.click(await within(dlg).findByRole('button', { name: 'نعم، طُبعت بنجاح' }))
    expect(await screen.findByText('تم التعليم كمطبوعة')).toBeTruthy()
    expect((await call('labels:pending')).length).toBe(0)

    // وتظهر رسالة واضحة حين لا يبقى شيء
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'ملصقات الباركود' }))
    expect(await screen.findByText(/كل النسخ الحالية مطبوعة/)).toBeTruthy()
  })

  test('حفظ الملصقات كـ PDF يكتب الملف عبر نافذة التطبيق', async () => {
    const user = userEvent.setup()
    const out = capturePrint()
    const file = path.join(os.tmpdir(), `lbl-${Date.now()}.pdf`)
    const win = { webContents: { printToPDF: vi.fn(async () => Buffer.from('%PDF-1.4 x')) } }
    await boot(seedBooks, { win, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: file }) } })
    await loginUi(user)
    await nav(user, 'الكتب')
    await user.click(await screen.findByRole('button', { name: 'ملصقات الباركود' }))
    const dlg = await screen.findByRole('dialog', { name: 'طباعة ملصقات الباركود' })
    await user.click(await within(dlg).findByRole('button', { name: 'حفظ PDF' }))
    await within(dlg).findByText(/هل طُبعت الملصقات بنجاح/)
    expect(out.calls).toBe(0) // لم يُفتح حوار الطباعة
    expect(win.webContents.printToPDF).toHaveBeenCalledOnce()
    expect(fs.readFileSync(file, 'utf8')).toBe('%PDF-1.4 x')
  })

  test('ملصقات كتاب واحد من درجه (تشمل المطبوعة سابقًا)', async () => {
    const user = userEvent.setup()
    const out = capturePrint()
    const { call } = await boot(async (c) => { await seedBooks(c); await c('auth:login', { username: 'admin', password: 'secret-pass' }); await c('labels:mark', { ids: [1, 2] }); await c('auth:logout') })
    await loginUi(user)
    await nav(user, 'الكتب')
    await user.click(await screen.findByRole('button', { name: 'ك1' }))
    const drawer = await screen.findByRole('dialog', { name: 'ك1' })
    await user.click(await within(drawer).findByRole('button', { name: 'طباعة الملصقات' }))
    const dlg = await screen.findByRole('dialog', { name: 'طباعة ملصقات نسخ الكتاب' })
    await within(dlg).findByText(/ملصقًا على/)
    await user.click(within(dlg).getByRole('button', { name: 'طباعة' }))
    await within(dlg).findByText(/هل طُبعت/)
    expect(out.root.querySelectorAll('svg[role="img"]').length).toBe(2)
    expect((await call('labels:pending')).length).toBe(0)
  })

  test('بطاقات الأعضاء: اسم ورقم وباركود لكل بطاقة', async () => {
    const user = userEvent.setup()
    const out = capturePrint()
    await boot(seedBooks)
    await loginUi(user)
    await nav(user, 'الأعضاء')
    await user.click(await screen.findByRole('button', { name: 'طباعة البطاقات' }))
    const dlg = await screen.findByRole('dialog', { name: 'طباعة بطاقات الأعضاء' })
    await within(dlg).findByText(/بطاقة/)
    await user.click(within(dlg).getByRole('button', { name: 'طباعة' }))
    await waitFor(() => expect(out.calls).toBe(1))
    const cards = out.root.querySelectorAll('.id-card')
    expect(cards.length).toBe(1)
    expect(cards[0].textContent).toContain('سارة')
    expect(cards[0].textContent).toContain('M00001')
    expect(cards[0].querySelector('svg[role="img"]')).toBeTruthy()
  })

  test('إيصال الإعارة من مكتب الإعارة', async () => {
    const user = userEvent.setup()
    const out = capturePrint()
    await boot(async (c) => { await seedBooks(c); await c('auth:login', { username: 'admin', password: 'secret-pass' }); await c('books:save', { title: 'ك2', author: 'م', copies: 1 }); await c('auth:logout') })
    await loginUi(user)
    await nav(user, 'مكتب الإعارة')
    await user.type(await screen.findByRole('combobox', { name: 'العضو' }), 'M00001{Enter}')
    const book = await screen.findByRole('combobox', { name: 'الكتاب' })
    await waitFor(() => expect(document.activeElement).toBe(book))
    await user.type(book, 'B00001-1{Enter}')
    await screen.findByText(/«ك1» \(B00001-1\)/)
    const book2 = await screen.findByRole('combobox', { name: 'الكتاب' })
    await waitFor(() => expect(document.activeElement).toBe(book2))
    await user.type(book2, 'B00002-1{Enter}')
    await screen.findByText(/«ك2» \(B00002-1\)/)

    await user.click(await screen.findByRole('button', { name: /طباعة إيصال/ }))
    await waitFor(() => expect(out.calls).toBe(1))
    const r = out.root.querySelector('.receipt')
    expect(r.textContent).toContain('سارة')
    expect(r.textContent).toContain('«ك1»')
    expect(r.textContent).toContain('«ك2»')
    expect(r.querySelectorAll('li').length).toBe(2)
    expect(out.root.querySelector('style').textContent).toContain('80mm')
  })

  test('كشف المتأخرات: صف لكل إعارة متأخرة بأيام التأخير', async () => {
    const user = userEvent.setup()
    const out = capturePrint()
    const { h } = await boot(async (c) => { await seedBooks(c); await c('auth:login', { username: 'admin', password: 'secret-pass' }); await c('loans:borrow', { member_id: 1, book_id: 1 }); await c('auth:logout') })
    overdue(h, 6)
    await loginUi(user)
    await nav(user, 'الإعارات')
    await user.click(await screen.findByRole('button', { name: 'كشف المتأخرات' }))
    const dlg = await screen.findByRole('dialog', { name: 'كشف الكتب المتأخرة' })
    await within(dlg).findByText(/إعارة متأخرة/)
    await user.click(within(dlg).getByRole('button', { name: 'طباعة' }))
    await waitFor(() => expect(out.calls).toBe(1))
    const cells = [...out.root.querySelectorAll('.report tbody td')].map((t) => t.textContent)
    expect(cells).toContain('سارة')
    expect(cells).toContain('ك1')
    expect(cells).toContain('6')
    expect(out.root.querySelector('style').textContent).toContain('margin: 12mm')
  })
})

describe('المرحلة الثالثة: التمديد والتذكير', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  test('تمديد إعارة من صفحة الإعارات', async () => {
    const user = userEvent.setup()
    const { call } = await boot(async (c) => { await seedBooks(c); await c('auth:login', { username: 'admin', password: 'secret-pass' }); await c('loans:borrow', { member_id: 1, book_id: 1, days: 3 }); await c('auth:logout') })
    await loginUi(user)
    await nav(user, 'الإعارات')
    const before = (await call('loans:list', {})).rows[0].due_date
    await user.click(await screen.findByRole('button', { name: /تمديد/ }))
    expect(await screen.findByText(/تم تمديد «ك1» حتى/)).toBeTruthy()
    const after = (await call('loans:list', {})).rows[0]
    expect(after.renewals).toBe(1)
    expect(after.due_date > before).toBe(true)
    expect(await screen.findByText(/جُدّدت 1×/)).toBeTruthy()
    // حتى الحد الأقصى ثم رسالة واضحة
    await user.click(screen.getByRole('button', { name: /تمديد/ }))
    await screen.findByText(/جُدّدت 2×/)
    await user.click(screen.getByRole('button', { name: /تمديد/ }))
    expect(await screen.findByText(/الحد الأقصى للتمديد \(2\)/)).toBeTruthy()
  })

  test('رسالة التذكير: نسخ وفتح في البريد، ولا زر تمديد للمتأخرة', async () => {
    const user = userEvent.setup()
    const opened = []
    const written = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => written.push(t) } })
    const { h } = await boot(async (c) => { await seedBooks(c); await c('auth:login', { username: 'admin', password: 'secret-pass' }); await c('loans:borrow', { member_id: 1, book_id: 1 }); await c('auth:logout') },
      { shell: { openExternal: async (u) => opened.push(u) } })
    overdue(h, 4)
    await loginUi(user)
    await nav(user, 'الإعارات')
    expect(screen.queryByRole('button', { name: /تمديد/ })).toBeNull()
    await user.click(await screen.findByRole('button', { name: /تذكير/ }))
    const dlg = await screen.findByRole('dialog', { name: 'رسالة تذكير بالإرجاع' })
    const box = await within(dlg).findByRole('textbox', { name: 'نص الرسالة' })
    expect(box.value).toContain('«ك1»')
    expect(box.value).toContain('متأخر 4 يومًا')

    await user.click(within(dlg).getByRole('button', { name: /نسخ الرسالة/ }))
    expect(await screen.findByText('تم نسخ الرسالة')).toBeTruthy()
    expect(written[0]).toBe(box.value)

    await user.type(box, ' (إضافة)')
    await user.click(within(dlg).getByRole('button', { name: /فتح في البريد/ }))
    await waitFor(() => expect(opened.length).toBe(1))
    expect(opened[0]).toMatch(/^mailto:sara%40example\.com/)
    expect(decodeURIComponent(opened[0])).toContain('(إضافة)') // التعديل اليدوي يصل للبريد
  })
})

describe('المرحلة الثالثة: الحجز', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  test('حجز من الدرج ← إرجاع في المكتب يُنبّه ← اللوحة تعرض الجاهز وتُنشئ رسالته', async () => {
    const user = userEvent.setup()
    await boot(async (c) => {
      await seedAdmin(c)
      await c('books:save', { title: 'مطلوب', author: 'م', copies: 1 })
      await c('members:save', { name: 'أحمد' })
      await c('members:save', { name: 'بشير', email: 'b@example.com' })
      await c('loans:borrow', { member_id: 1, book_id: 1 })
      await c('auth:logout')
    })
    await loginUi(user)
    await nav(user, 'الكتب')
    await user.click(await screen.findByRole('button', { name: 'مطلوب' }))
    const drawer = await screen.findByRole('dialog', { name: 'مطلوب' })
    await user.click(await within(drawer).findByRole('button', { name: /حجز لعضو/ }))
    const dlg = await screen.findByRole('dialog', { name: 'حجز الكتاب لعضو' })
    await user.type(within(dlg).getByRole('combobox', { name: 'العضو' }), 'بشير')
    await user.click(await within(dlg).findByRole('option', { name: /بشير/ }))
    await user.click(within(dlg).getByRole('button', { name: 'تأكيد الحجز' }))
    expect(await screen.findByText(/تم الحجز لـ بشير \(الدور 1\)/)).toBeTruthy()
    expect(await within(drawer).findByText('بالانتظار · الدور 1')).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await nav(user, 'مكتب الإعارة')
    await user.click(screen.getByRole('tab', { name: 'إرجاع' }))
    const box = await screen.findByRole('combobox', { name: 'الإعارة المفتوحة' })
    await waitFor(() => expect(document.activeElement).toBe(box))
    await user.type(box, 'B00001-1{Enter}')
    expect((await screen.findAllByText(/ضع «مطلوب» جانبًا: محجوزة للعضو بشير/)).length).toBeGreaterThan(0)

    await nav(user, 'نظرة عامة')
    expect(await screen.findByRole('heading', { name: 'حجوزات جاهزة للاستلام' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'إبلاغ' }))
    const msg = await screen.findByRole('dialog', { name: 'رسالة: الحجز جاهز' })
    expect((await within(msg).findByRole('textbox', { name: 'نص الرسالة' })).value).toContain('«مطلوب»')
  })

  test('النسخة المحجوزة لا تُعار لغير صاحبها من المكتب، وتُعار لصاحبها', async () => {
    const user = userEvent.setup()
    await boot(async (c) => {
      await seedAdmin(c)
      await c('books:save', { title: 'مطلوب', author: 'م', copies: 1 })
      for (const n of ['أحمد', 'بشير', 'جميل']) await c('members:save', { name: n })
      await c('loans:borrow', { member_id: 1, book_id: 1 })
      await c('reservations:create', { book_id: 1, member_id: 2 })
      await c('loans:return', 1)
      await c('auth:logout')
    })
    await loginUi(user)
    await nav(user, 'مكتب الإعارة')

    await user.type(await screen.findByRole('combobox', { name: 'العضو' }), 'M00003{Enter}') // جميل
    let book = await screen.findByRole('combobox', { name: 'الكتاب' })
    await waitFor(() => expect(document.activeElement).toBe(book))
    await user.type(book, 'B00001-1{Enter}')
    expect((await screen.findAllByText(/محجوزة لأعضاء آخرين/)).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /تغيير العضو/ }))
    await user.type(await screen.findByRole('combobox', { name: 'العضو' }), 'M00002{Enter}') // بشير
    expect(await screen.findByText(/حجز جاهز: مطلوب/)).toBeTruthy()
    book = await screen.findByRole('combobox', { name: 'الكتاب' })
    await waitFor(() => expect(document.activeElement).toBe(book))
    await user.type(book, 'B00001-1{Enter}')
    expect(await screen.findByText(/«مطلوب» \(B00001-1\) ← بشير/)).toBeTruthy()
  })
})

describe('المرحلة الثالثة: الغرامات', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const withFine = async (c) => {
    await seedAdmin(c)
    await c('settings:save', { fine_per_day: 10 })
    await c('books:save', { title: 'ك', author: 'م', copies: 1 })
    await c('members:save', { name: 'سارة' })
    await c('users:save', { username: 'amin', display_name: 'أمين', role: 'librarian', password: 'secret-pass' })
    await c('loans:borrow', { member_id: 1, book_id: 1 })
  }

  test('إرجاع متأخر في المكتب يُنشئ غرامة تُسدَّد من بطاقة العضو', async () => {
    const user = userEvent.setup()
    const { h } = await boot(async (c) => { await withFine(c); await c('auth:logout') })
    overdue(h, 3)
    await loginUi(user)
    await nav(user, 'مكتب الإعارة')
    await user.type(await screen.findByRole('combobox', { name: 'العضو' }), 'M00001{Enter}')
    await screen.findByText('بحوزته 1 من 5')
    await user.click(screen.getByRole('tab', { name: 'إرجاع' }))
    const box = await screen.findByRole('combobox', { name: 'الإعارة المفتوحة' })
    await waitFor(() => expect(document.activeElement).toBe(box))
    await user.type(box, 'B00001-1{Enter}')
    expect(await screen.findByText(/30 دج على سارة \(تأخير 3 يومًا\)/)).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'إعارة' }))
    expect(await screen.findByText('غرامات 30 دج')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /تسديد الغرامات/ }))
    expect(await screen.findByText('30 دج من سارة')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('غرامات 30 دج')).toBeNull())
  })

  test('درج العضو: الغرامات والتسديد، والمدير وحده يعفي ويضيف', async () => {
    const user = userEvent.setup()
    const { h } = await boot(async (c) => { await withFine(c); await c('auth:logout') })
    overdue(h, 3)
    h.getDb().returnLoan(1) // غرامة 30
    await loginUi(user)
    await nav(user, 'الأعضاء')
    await screen.findByText('غرامة 30')
    await user.click(screen.getByRole('button', { name: 'سارة' }))
    const drawer = await screen.findByRole('dialog', { name: 'سارة' })
    expect(await within(drawer).findByText(/تأخير 3 يومًا في إرجاع «ك»/)).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: 'إعفاء' })).toBeTruthy()

    // إضافة غرامة يدوية
    await user.click(within(drawer).getByRole('button', { name: /إضافة غرامة/ }))
    const fd = await screen.findByRole('dialog', { name: 'إضافة غرامة' })
    await user.type(within(fd).getByLabelText(/المبلغ/), '200')
    await user.type(within(fd).getByLabelText('السبب'), 'كتاب تالف')
    await user.click(within(fd).getByRole('button', { name: 'إضافة' }))
    expect(await screen.findByText('أُضيفت الغرامة')).toBeTruthy()
    expect(await within(drawer).findByText('كتاب تالف')).toBeTruthy()
    expect(await within(drawer).findByRole('button', { name: /تسديد الكل \(230 دج\)/ })).toBeTruthy()

    await user.click(within(drawer).getByRole('button', { name: /تسديد الكل/ }))
    expect(await screen.findByText('سُدِّد 230 دج')).toBeTruthy()
    expect(await within(drawer).findByText('لا توجد غرامات غير مسددة.')).toBeTruthy()
  })

  test('أمين المكتبة يسدّد لكنه لا يعفي ولا يضيف غرامة', async () => {
    const user = userEvent.setup()
    const { h } = await boot(async (c) => { await withFine(c); await c('auth:logout') })
    overdue(h, 3)
    h.getDb().returnLoan(1)
    await loginUi(user, 'amin')
    await nav(user, 'الأعضاء')
    await user.click(await screen.findByRole('button', { name: 'سارة' }))
    const drawer = await screen.findByRole('dialog', { name: 'سارة' })
    await within(drawer).findByText(/تأخير 3 يومًا/)
    expect(within(drawer).getByRole('button', { name: 'تسديد' })).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: 'إعفاء' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: /إضافة غرامة/ })).toBeNull()
  })

  test('منع الإعارة بسبب الغرامات يُظهر الرسالة في المكتب', async () => {
    const user = userEvent.setup()
    await boot(async (c) => {
      await withFine(c)
      await c('loans:return', 1)
      await c('fines:add', { member_id: 1, amount: 500, reason: 'تلف' })
      await c('settings:save', { fine_block_limit: 400 })
      await c('auth:logout')
    })
    await loginUi(user)
    await nav(user, 'مكتب الإعارة')
    await user.type(await screen.findByRole('combobox', { name: 'العضو' }), 'M00001{Enter}')
    const book = await screen.findByRole('combobox', { name: 'الكتاب' })
    await waitFor(() => expect(document.activeElement).toBe(book))
    await user.type(book, 'B00001-1{Enter}')
    expect((await screen.findAllByText(/غرامات غير مسددة \(500 دج\)/)).length).toBeGreaterThan(0)
  })

  test('الغرامات تظهر في إحصاءات اللوحة', async () => {
    const user = userEvent.setup()
    await boot(async (c) => { await withFine(c); await c('fines:add', { member_id: 1, amount: 120, reason: 'x' }); await c('auth:logout') })
    await loginUi(user)
    expect(await screen.findByText('غرامات مستحقة (دج)')).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy()
  })
})
