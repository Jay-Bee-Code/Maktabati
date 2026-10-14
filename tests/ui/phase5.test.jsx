import { describe, test, expect, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { boot, loginUi, nav } from './helpers.jsx'

const CODE_RE = /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/
const codeOnScreen = () => screen.getByRole('note', { name: 'رمز الاسترداد' }).textContent

/** يعيد رمز الاسترداد الذي أُنشئ مع الحساب الأول */
const seedWithCode = (box) => async (call) => {
  const r = await call('auth:setup', { username: 'admin', display_name: 'المدير', password: 'secret-pass' })
  box.code = r.recoveryCode
  await call('auth:logout')
}

describe('المرحلة الخامسة: الإعداد الأول والاسترداد', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  test('الإعداد الأول يعرض رمزًا صالحًا مرة واحدة، ولا دخول قبل تأكيد الحفظ', async () => {
    const user = userEvent.setup()
    const { h } = await boot()
    await user.type(await screen.findByLabelText('الاسم الكامل'), 'المدير')
    await user.type(screen.getByLabelText('اسم المستخدم'), 'admin')
    await user.type(screen.getByLabelText('كلمة المرور (8 أحرف على الأقل)'), 'secret-pass')
    await user.type(screen.getByLabelText('تأكيد كلمة المرور'), 'secret-pass')
    await user.click(screen.getByRole('button', { name: 'إنشاء الحساب' }))
    await screen.findByRole('note', { name: 'رمز الاسترداد' })
    const code = codeOnScreen()
    expect(code).toMatch(CODE_RE)
    expect(h.getDb().verifyRecoveryCode(code)).toBe(true) // الرمز المعروض هو المخزَّن فعلًا
    expect(screen.queryByRole('heading', { name: 'نظرة عامة' })).toBeNull() // لم ندخل بعد
    const next = screen.getByRole('button', { name: 'متابعة إلى التطبيق' })
    expect(next.disabled).toBe(true)
    await user.click(next) // النقر على زر معطّل لا يدخل
    expect(screen.queryByRole('heading', { name: 'نظرة عامة' })).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: /حفظتُ الرمز/ }))
    expect(next.disabled).toBe(false)
    await user.click(next)
    expect(await screen.findByRole('heading', { name: 'نظرة عامة' })).toBeTruthy()
    // الرمز لا يظهر بعد ذلك في أي مكان
    expect(document.body.textContent).not.toContain(code)
  })

  test('نسيت كلمة المرور: استرداد برمز صغير الأحرف، ثم رمز جديد، ثم دخول بالجديدة', async () => {
    const user = userEvent.setup()
    const box = {}
    await boot(seedWithCode(box))
    await user.click(await screen.findByRole('button', { name: 'نسيت كلمة المرور؟' }))
    expect(await screen.findByRole('heading', { name: 'استرداد حساب المدير' })).toBeTruthy()
    await user.type(screen.getByLabelText('اسم مستخدم المدير'), 'admin')
    await user.type(screen.getByLabelText('رمز الاسترداد'), box.code.toLowerCase())
    await user.type(screen.getByLabelText('كلمة المرور الجديدة (8 أحرف على الأقل)'), 'brand-new-pass')
    await user.type(screen.getByLabelText('تأكيد كلمة المرور'), 'brand-new-pass')
    await user.click(screen.getByRole('button', { name: 'تعيين كلمة المرور' }))

    await screen.findByRole('note', { name: 'رمز الاسترداد' })
    const fresh = codeOnScreen()
    expect(fresh).toMatch(CODE_RE)
    expect(fresh).not.toBe(box.code)
    await user.click(screen.getByRole('checkbox', { name: /حفظتُ الرمز/ }))
    await user.click(screen.getByRole('button', { name: 'العودة إلى تسجيل الدخول' }))

    // اسم المستخدم يبقى معبّأً من خطوة الاسترداد، فنكتب كلمة المرور فقط
    expect(screen.getByLabelText('اسم المستخدم').value).toBe('admin')
    const pw = screen.getByLabelText('كلمة المرور')
    await user.type(pw, 'secret-pass') // القديمة مرفوضة
    await user.click(screen.getByRole('button', { name: 'دخول' }))
    expect(await screen.findByText('اسم المستخدم أو كلمة المرور غير صحيحة')).toBeTruthy()
    await user.clear(pw)
    await user.type(pw, 'brand-new-pass')
    await user.click(screen.getByRole('button', { name: 'دخول' }))
    expect(await screen.findByRole('heading', { name: 'نظرة عامة' })).toBeTruthy()
  })

  test('الاسترداد: كلمتان مختلفتان أو رمز خاطئ يُرفضان برسالة', async () => {
    const user = userEvent.setup()
    const box = {}
    await boot(seedWithCode(box))
    await user.click(await screen.findByRole('button', { name: 'نسيت كلمة المرور؟' }))
    await user.type(screen.getByLabelText('اسم مستخدم المدير'), 'admin')
    await user.type(screen.getByLabelText('رمز الاسترداد'), 'AAAAA-AAAAA-AAAAA-AAAAA')
    await user.type(screen.getByLabelText('كلمة المرور الجديدة (8 أحرف على الأقل)'), 'brand-new-pass')
    await user.type(screen.getByLabelText('تأكيد كلمة المرور'), 'different-pass')
    await user.click(screen.getByRole('button', { name: 'تعيين كلمة المرور' }))
    expect(await screen.findByText('كلمتا المرور غير متطابقتين')).toBeTruthy()

    const confirm = screen.getByLabelText('تأكيد كلمة المرور')
    await user.clear(confirm)
    await user.type(confirm, 'brand-new-pass')
    await user.click(screen.getByRole('button', { name: 'تعيين كلمة المرور' }))
    expect(await screen.findByText('رمز الاسترداد غير صحيح')).toBeTruthy()
    expect(screen.queryByRole('note', { name: 'رمز الاسترداد' })).toBeNull()
    // وزر العودة يرجع لنموذج الدخول
    await user.click(screen.getByRole('button', { name: 'العودة إلى تسجيل الدخول' }))
    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeTruthy()
  })

  test('الأمان: إنشاء رمز جديد يتطلب كلمة المرور، ولا يُغلق قبل تأكيد الحفظ، ويبطل القديم', async () => {
    const user = userEvent.setup()
    const box = {}
    const { h } = await boot(seedWithCode(box))
    await loginUi(user)
    await nav(user, 'الإدارة')
    await user.click(await screen.findByRole('tab', { name: 'الأمان' }))
    expect(await screen.findByText(/آخر إنشاء للرمز/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /إنشاء رمز جديد/ }))
    const ask = await screen.findByRole('dialog', { name: 'تأكيد كلمة المرور' })
    await user.type(within(ask).getByLabelText('كلمة المرور الحالية'), 'wrong-pass')
    await user.click(within(ask).getByRole('button', { name: 'إنشاء' }))
    expect(await screen.findByText('كلمة المرور غير صحيحة')).toBeTruthy()
    expect(h.getDb().verifyRecoveryCode(box.code)).toBe(true) // لم يتغيّر شيء

    await user.clear(within(ask).getByLabelText('كلمة المرور الحالية'))
    await user.type(within(ask).getByLabelText('كلمة المرور الحالية'), 'secret-pass')
    await user.click(within(ask).getByRole('button', { name: 'إنشاء' }))
    const dlg = await screen.findByRole('dialog', { name: 'رمز الاسترداد الجديد' })
    const fresh = within(dlg).getByRole('note', { name: 'رمز الاسترداد' }).textContent
    expect(fresh).toMatch(CODE_RE)
    expect(h.getDb().verifyRecoveryCode(fresh)).toBe(true)
    expect(h.getDb().verifyRecoveryCode(box.code)).toBe(false)

    // لا إغلاق بزر ولا Escape ولا نقرة خارجية قبل التأكيد
    expect(within(dlg).queryByRole('button', { name: 'إغلاق' })).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'رمز الاسترداد الجديد' })).toBeTruthy()
    const done = within(dlg).getByRole('button', { name: 'تم' })
    expect(done.disabled).toBe(true)
    await user.click(within(dlg).getByRole('checkbox', { name: /حفظتُ الرمز/ }))
    await user.click(done)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('حساب قديم بلا رمز استرداد: تنبيه واضح في تبويب الأمان', async () => {
    const user = userEvent.setup()
    const { h } = await boot(async (c) => { await c('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' }); await c('auth:logout') })
    h.getDb().raw.prepare("DELETE FROM settings WHERE key LIKE 'recovery_%'").run()
    await loginUi(user)
    await nav(user, 'الإدارة')
    await user.click(await screen.findByRole('tab', { name: 'الأمان' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/لم يُنشأ رمز استرداد بعد/)
    expect(screen.getByRole('button', { name: 'إنشاء رمز استرداد' })).toBeTruthy()
  })
})

describe('المرحلة الخامسة: سجل العمليات', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const seed = async (call) => {
    await call('auth:setup', { username: 'admin', display_name: 'المدير', password: 'secret-pass' })
    await call('books:save', { title: 'الإسلام والحضارة', author: 'م', copies: 2 })
    await call('members:save', { name: 'سارة' })
    await call('users:save', { username: 'amin', display_name: 'أمين', role: 'librarian', password: 'secret-pass' })
    await call('auth:logout')
    await call('auth:login', { username: 'amin', password: 'secret-pass' })
    await call('loans:borrow', { member_id: 1, book_id: 1 })
    await call('auth:logout')
  }

  test('يعرض العمليات بفاعلها، مع بحث عربي مطبَّع وتصفية بالمستخدم، والفاشل بلا مستخدم', async () => {
    const user = userEvent.setup()
    const { h } = await boot(seed)
    await h.invoke('auth:login', { username: 'ghost', password: 'x' }) // محاولة فاشلة مقصودة
    await loginUi(user)
    await nav(user, 'الإدارة')
    await user.click(await screen.findByRole('tab', { name: 'سجل العمليات' }))
    const table = await screen.findByRole('table')
    expect(await within(table).findByText(/إعارة «الإسلام والحضارة»/)).toBeTruthy()

    // الدخول الفاشل بلا فاعل، ومعروض بلون التنبيه
    const failed = within(table).getByText('محاولة دخول فاشلة للمستخدم «ghost»')
    expect(failed.className).toContain('text-brick')
    expect(within(failed.closest('tr')).getByText('غير مسجَّل الدخول')).toBeTruthy()

    // بحث بدون همزات
    await user.type(screen.getByRole('textbox', { name: 'ابحث في السجل' }), 'الاسلام')
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText(/محاولة دخول فاشلة/)).toBeNull())
    expect(within(screen.getByRole('table')).getAllByRole('row').length).toBe(1 + 2) // الرأس + إضافة الكتاب + الإعارة

    // تصفية بالمستخدم amin
    await user.clear(screen.getByRole('textbox', { name: 'ابحث في السجل' }))
    await user.selectOptions(screen.getByLabelText('المستخدم'), 'amin')
    await waitFor(() => {
      const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
      expect(rows.length).toBeGreaterThan(0)
      rows.forEach((r) => expect(r.textContent).toContain('amin'))
    })
  })

  test('قاعدة جديدة: حالة فارغة مفهومة', async () => {
    const user = userEvent.setup()
    // نمسح السجل بإعادة إنشاء قاعدة دون عمليات سابقة قدر الإمكان: فقط الدخول يُسجَّل
    await boot(async (c) => { await c('auth:setup', { username: 'admin', display_name: 'م', password: 'secret-pass' }); await c('auth:logout') })
    await loginUi(user)
    await nav(user, 'الإدارة')
    await user.click(await screen.findByRole('tab', { name: 'سجل العمليات' }))
    await user.type(await screen.findByRole('textbox', { name: 'ابحث في السجل' }), 'لا يوجد شيء بهذا الاسم')
    expect(await screen.findByText('لا توجد سجلات')).toBeTruthy()
  })
})
