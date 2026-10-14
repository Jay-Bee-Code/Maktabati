import { describe, test, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { boot, seedAdmin, loginUi, nav } from './helpers.jsx'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')

const base = async (call) => {
  await seedAdmin(call)
  await call('books:save', { title: 'كتاب الباركود', author: 'م', copies: 2 })
  await call('books:save', { title: 'الإسلام والحضارة', author: 'محمد', copies: 1 })
  await call('members:save', { name: 'عضو الباركود' })
  await call('auth:logout')
}

describe('المرحلة الثانية', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  test('مكتب الإعارة: مسح بطاقة ثم باركود + Enter فورًا (قبل وصول النتائج)', async () => {
    const user = userEvent.setup()
    const { call } = await boot(base)
    await loginUi(user)
    await nav(user, 'مكتب الإعارة')

    // الماسح يكتب الرمز ثم Enter بسرعة: يجب ألا تُختار نتيجة قديمة
    await user.type(await screen.findByRole('combobox', { name: 'العضو' }), 'M00001{Enter}')
    expect(await screen.findByText('بحوزته 0 من 5')).toBeTruthy()

    const bookBox = await screen.findByRole('combobox', { name: 'الكتاب' })
    await waitFor(() => expect(document.activeElement).toBe(bookBox)) // المؤشر ينتقل تلقائيًا
    await user.type(bookBox, 'B00001-2{Enter}')

    const logItem = await screen.findByText(/«كتاب الباركود» \(B00001-2\)/)
    expect(logItem.textContent).toContain('عضو الباركود')
    expect(await screen.findByText('بحوزته 1 من 5')).toBeTruthy()
    const copies = (await call('auth:login', { username: 'admin', password: 'secret-pass' }), (await call('books:get', 1)).copies)
    expect(copies.find((c) => c.barcode === 'B00001-2').loan_id).toBeTruthy()
    expect(copies.find((c) => c.barcode === 'B00001-1').loan_id).toBeNull()

    // الحقل فُرِّغ وعاد التركيز إليه: مسح النسخة نفسها ثانية يُرفض برسالة واضحة
    const again = await screen.findByRole('combobox', { name: 'الكتاب' })
    await waitFor(() => expect(document.activeElement).toBe(again))
    await user.type(again, 'B00001-2{Enter}')
    expect(await screen.findByText(/معارة حاليًا/, { selector: 'li span, div' })).toBeTruthy()
  })

  test('مكتب الإعارة: Enter على حقل فارغ لا يعير شيئًا', async () => {
    const user = userEvent.setup()
    const { call } = await boot(base)
    await loginUi(user)
    await nav(user, 'مكتب الإعارة')
    await user.type(await screen.findByRole('combobox', { name: 'العضو' }), 'M00001{Enter}')
    const bookBox = await screen.findByRole('combobox', { name: 'الكتاب' })
    await waitFor(() => expect(document.activeElement).toBe(bookBox))
    await user.keyboard('{Enter}{Enter}')
    await new Promise((r) => setTimeout(r, 300))
    expect((await call('stats:get')).active).toBe(0)
  })

  test('مكتب الإعارة: الإرجاع بالباركود يسجل التأخير', async () => {
    const user = userEvent.setup()
    const { h } = await boot(async (call) => {
      await base(call)
      await call('auth:login', { username: 'admin', password: 'secret-pass' })
      await call('loans:borrow', { member_id: 1, barcode: 'B00001-1', days: 7 })
      await call('auth:logout')
    })
    h.getDb().raw.prepare("UPDATE loans SET due_date = date('now','-5 days')").run()
    await loginUi(user)
    await nav(user, 'مكتب الإعارة')
    await user.click(screen.getByRole('tab', { name: 'إرجاع' }))
    const box = await screen.findByRole('combobox', { name: 'الإعارة المفتوحة' })
    await waitFor(() => expect(document.activeElement).toBe(box))
    await user.type(box, 'b00001-1{Enter}')
    expect(await screen.findByText(/متأخر 5 يومًا/, { selector: 'span' })).toBeTruthy()
    await waitFor(() => expect(h.getDb().stats().active).toBe(0))
  })

  test('شريط الأوامر: Ctrl+K ثم البحث بدون همزات يفتح درج الكتاب', async () => {
    const user = userEvent.setup()
    await boot(base)
    await loginUi(user)
    await screen.findByRole('heading', { name: 'نظرة عامة' })

    await user.keyboard('{Control>}k{/Control}')
    const dlg = await screen.findByRole('dialog', { name: 'بحث وأوامر' })
    await user.type(within(dlg).getByRole('combobox'), 'الاسلام')       // بدون همزة
    expect(await within(dlg).findByRole('option', { name: /الإسلام والحضارة/ })).toBeTruthy()
    await user.keyboard('{ArrowDown}'.repeat(0) + '{Enter}')
    // يفتح صفحة الكتب مع درج الكتاب
    const drawer = await screen.findByRole('dialog', { name: 'الإسلام والحضارة' })
    expect(within(drawer).getByText('محمد')).toBeTruthy()
    expect(within(drawer).getByText('B00002-1')).toBeTruthy()
  })

  test('شريط الأوامر: الأوامر الثابتة تعمل، وEscape يغلقه', async () => {
    const user = userEvent.setup()
    await boot(base)
    await loginUi(user)
    await screen.findByRole('heading', { name: 'نظرة عامة' })
    await user.keyboard('{Control>}k{/Control}')
    const dlg = await screen.findByRole('dialog', { name: 'بحث وأوامر' })
    await user.type(within(dlg).getByRole('combobox'), 'إضافة كتاب{Enter}')
    expect(await screen.findByRole('dialog', { name: 'إضافة كتاب' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: 'بحث وأوامر' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('Ctrl+N يفتح نموذج الإضافة في الصفحة الحالية', async () => {
    const user = userEvent.setup()
    await boot(base)
    await loginUi(user)
    await nav(user, 'الأعضاء')
    await screen.findByText('عضو الباركود')
    await user.keyboard('{Control>}n{/Control}')
    expect(await screen.findByRole('dialog', { name: 'إضافة عضو' })).toBeTruthy()
  })

  test('درج الكتاب: تغيير حالة نسخة وإضافة نسخة', async () => {
    const user = userEvent.setup()
    await boot(base)
    await loginUi(user)
    await nav(user, 'الكتب')
    await user.click(await screen.findByRole('button', { name: 'كتاب الباركود' }))
    const drawer = await screen.findByRole('dialog', { name: 'كتاب الباركود' })
    expect(await within(drawer).findByText('2 متاحة من 2')).toBeTruthy()

    await user.selectOptions(within(drawer).getByLabelText('حالة النسخة B00001-1'), 'damaged')
    expect(await screen.findByText(/تم تغيير حالة B00001-1/)).toBeTruthy()
    expect(await within(drawer).findByText('1 متاحة من 2')).toBeTruthy()

    await user.click(within(drawer).getByRole('button', { name: 'إضافة نسخة' }))
    expect(await screen.findByText(/B00001-3/, { selector: '[role=status] span' })).toBeTruthy()
    expect(await within(drawer).findByText('2 متاحة من 3')).toBeTruthy()
  })

  test('درج العضو ثم «إعارة كتاب» ينقل العضو إلى مكتب الإعارة', async () => {
    const user = userEvent.setup()
    await boot(base)
    await loginUi(user)
    await nav(user, 'الأعضاء')
    await user.click(await screen.findByRole('button', { name: 'عضو الباركود' }))
    const drawer = await screen.findByRole('dialog', { name: 'عضو الباركود' })
    expect(within(drawer).getByText('M00001')).toBeTruthy()
    await user.click(within(drawer).getByRole('button', { name: /إعارة كتاب لهذا العضو/ }))
    expect(await screen.findByRole('heading', { name: 'مكتب الإعارة' })).toBeTruthy()
    expect(await screen.findByText('بحوزته 0 من 5')).toBeTruthy()
    expect(screen.getByText('عضو الباركود')).toBeTruthy()
  })

  test('البحث العربي في صفحة الكتب', async () => {
    const user = userEvent.setup()
    await boot(base)
    await loginUi(user)
    await nav(user, 'الكتب')
    await user.type(await screen.findByRole('textbox', { name: /ابحث بالعنوان/ }), 'الاسلام')
    expect(await screen.findByRole('button', { name: 'الإسلام والحضارة' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'كتاب الباركود' })).toBeNull())
  })

  test('الإعدادات: تغيير الاسم والمدة الافتراضية يظهر في الواجهة', async () => {
    const user = userEvent.setup()
    await boot(base)
    await loginUi(user)
    await nav(user, 'الإدارة')
    await user.click(await screen.findByRole('tab', { name: 'الإعدادات' }))
    const name = await screen.findByLabelText('اسم المكتبة')
    await user.clear(name)
    await user.type(name, 'مكتبة الأمل')
    const days = screen.getByLabelText('مدة الإعارة (أيام)')
    await user.clear(days)
    await user.type(days, '21')
    await user.click(screen.getByRole('button', { name: 'حفظ الإعدادات' }))
    expect(await screen.findByText('تم حفظ الإعدادات')).toBeTruthy()
    expect(await screen.findByText('مكتبة الأمل', { selector: 'aside div' })).toBeTruthy()

    await nav(user, 'الإعارات')
    await user.click(await screen.findByRole('button', { name: 'إعارة جديدة' }))
    const dlg = await screen.findByRole('dialog', { name: 'إعارة جديدة' })
    expect(within(dlg).getByLabelText('عدد الأيام').value).toBe('21')
  })

  test('الاستيراد من Excel: معاينة ثم تأكيد', async () => {
    const user = userEvent.setup()
    const file = path.join(os.tmpdir(), `imp-${Date.now()}.xlsx`)
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('x')
    ws.addRow(['العنوان', 'المؤلف', 'ISBN', 'عدد النسخ'])
    ws.addRow(['كتاب مستورد', 'مؤلف', '9780306406157', 3])
    ws.addRow(['', 'بلا عنوان', '', 1])
    ws.addRow(['كتاب بلا isbn', 'مؤلف', '', 1])
    await wb.xlsx.writeFile(file)

    const { call } = await boot(base, { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) } })
    await loginUi(user)
    await nav(user, 'الإدارة')
    await user.click(await screen.findByRole('tab', { name: 'البيانات' }))
    await user.click(await screen.findByRole('button', { name: 'استيراد كتب' }))
    const dlg = await screen.findByRole('dialog', { name: /معاينة استيراد الكتب/ })
    expect(within(dlg).getByText('جديد 2')).toBeTruthy()
    expect(within(dlg).getByText('أخطاء 1')).toBeTruthy()
    expect(within(dlg).getByText('عنوان الكتاب مطلوب')).toBeTruthy()
    await user.click(within(dlg).getByRole('button', { name: 'استيراد 2 سجلًا' }))
    expect(await screen.findByText(/أُضيف 2/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await call('auth:login', { username: 'admin', password: 'secret-pass' })
    const list = (await call('books:list', { pageSize: 50 })).rows.map((b) => b.title)
    expect(list).toContain('كتاب مستورد')
    expect(list).toContain('كتاب بلا isbn')
  })

  test('أمين المكتبة لا يرى تبويبات الإعدادات والاستيراد (صفحة الإدارة مخفية)', async () => {
    const user = userEvent.setup()
    await boot(async (call) => {
      await base(call)
      await call('auth:login', { username: 'admin', password: 'secret-pass' })
      await call('users:save', { username: 'amin', display_name: 'أمين', role: 'librarian', password: 'secret-pass' })
      await call('auth:logout')
    })
    await loginUi(user, 'amin')
    await screen.findByRole('heading', { name: 'نظرة عامة' })
    expect(screen.queryByRole('button', { name: 'الإدارة' })).toBeNull()
    await user.keyboard('{Control>}k{/Control}')
    const dlg = await screen.findByRole('dialog', { name: 'بحث وأوامر' })
    expect(within(dlg).queryByRole('option', { name: 'الإدارة' })).toBeNull()
    expect(within(dlg).getByRole('option', { name: 'مكتب الإعارة' })).toBeTruthy()
  })
})
