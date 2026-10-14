import { describe, test, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MotionConfig } from 'framer-motion'
import App from '../../src/App.jsx'
import { ToastProvider } from '../../src/ui.jsx'
import { AuthProvider } from '../../src/auth.jsx'

const require = createRequire(import.meta.url)
const { createDb } = require('../../electron/db.js')
const { createHandlers } = require('../../electron/handlers.js')

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x))) // يحاكي تسلسل IPC
let h
let call // استدعاء مباشر للخادم لتجهيز البيانات

async function boot(seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-'))
  const dbPath = path.join(dir, 'library.db')
  h = createHandlers({
    dbPath, backupDir: path.join(dir, 'backups'),
    dialog: {}, shell: {}, getWindow: () => null,
    openDb: () => createDb(dbPath),
  })
  window.api = { invoke: async (ch, p) => clone(await h.invoke(ch, clone(p))) }
  call = async (ch, p) => {
    const r = await h.invoke(ch, p)
    if (!r.ok) throw new Error(`${ch}: ${r.error}`)
    return r.data
  }
  if (seed) await seed()
  render(
    <MotionConfig>
      <ToastProvider><AuthProvider><App /></AuthProvider></ToastProvider>
    </MotionConfig>
  )
}

const seedAdmin = async () => {
  await call('auth:setup', { username: 'admin', display_name: 'المدير', password: 'secret-pass' })
}
const seedAdminAndLogout = async () => { await seedAdmin(); await call('auth:logout') }

async function loginUi(user, username = 'admin', password = 'secret-pass') {
  await user.type(await screen.findByLabelText('اسم المستخدم'), username)
  await user.type(screen.getByLabelText('كلمة المرور'), password)
  await user.click(screen.getByRole('button', { name: 'دخول' }))
}
const nav = (user, name) => user.click(screen.getByRole('button', { name }))

describe('الواجهة فوق قاعدة البيانات الحقيقية', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  test('أول تشغيل: إنشاء حساب المدير ثم الدخول إلى النظرة العامة', async () => {
    const user = userEvent.setup()
    await boot()
    await user.type(await screen.findByLabelText('الاسم الكامل'), 'المدير')
    await user.type(screen.getByLabelText('اسم المستخدم'), 'admin')
    await user.type(screen.getByLabelText('كلمة المرور (8 أحرف على الأقل)'), 'secret-pass')
    await user.type(screen.getByLabelText('تأكيد كلمة المرور'), 'secret-pass')
    await user.click(screen.getByRole('button', { name: 'إنشاء الحساب' }))
    // خطوة رمز الاسترداد: لا متابعة قبل تأكيد الحفظ
    expect(await screen.findByRole('note', { name: 'رمز الاسترداد' })).toBeTruthy()
    const next = screen.getByRole('button', { name: 'متابعة إلى التطبيق' })
    expect(next.disabled).toBe(true)
    await user.click(screen.getByRole('checkbox', { name: /حفظتُ الرمز/ }))
    await user.click(next)
    expect(await screen.findByRole('heading', { name: 'نظرة عامة' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'الإدارة' })).toBeTruthy()
  })

  test('كلمة مرور خاطئة تُظهر رسالة ولا تدخل', async () => {
    const user = userEvent.setup()
    await boot(seedAdminAndLogout)
    await loginUi(user, 'admin', 'wrong-pass')
    expect(await screen.findByText('اسم المستخدم أو كلمة المرور غير صحيحة')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'نظرة عامة' })).toBeNull()
  })

  test('إضافة كتاب ثم ISBN مكرر: تنبيه وإضافة نسخة بدل التكرار', async () => {
    const user = userEvent.setup()
    await boot(seedAdminAndLogout)
    await loginUi(user)
    await nav(user, 'الكتب')

    const add = async (title) => {
      await user.click(screen.getAllByRole('button', { name: 'إضافة كتاب' })[0])
      const dlg = await screen.findByRole('dialog', { name: 'إضافة كتاب' })
      await user.type(within(dlg).getByLabelText('العنوان'), title)
      await user.type(within(dlg).getByLabelText('المؤلف'), 'رضوى عاشور')
      await user.type(within(dlg).getByLabelText('ISBN (10 أو 13 خانة)'), '978-0-306-40615-7')
      await user.click(within(dlg).getByRole('button', { name: 'حفظ' }))
    }

    await add('ثلاثية غرناطة')
    expect(await screen.findByText('تمت إضافة الكتاب')).toBeTruthy()
    expect(await screen.findByText('ثلاثية غرناطة')).toBeTruthy()

    await add('نسخة مكررة')
    const dup = await screen.findByRole('dialog', { name: /مسجَّل بالفعل/ })
    expect(within(dup).getByText('ثلاثية غرناطة')).toBeTruthy()
    await user.click(within(dup).getByRole('button', { name: /إضافة نسخة إلى/ }))
    expect(await screen.findByText(/أصبح عدد نسخ/)).toBeTruthy()
    expect(await screen.findByText('2 / 2')).toBeTruthy()
    expect(screen.queryByText('نسخة مكررة')).toBeNull()
  })

  test('ISBN غير صالح يعرض رسالة الخطأ', async () => {
    const user = userEvent.setup()
    await boot(seedAdminAndLogout)
    await loginUi(user)
    await nav(user, 'الكتب')
    await user.click(screen.getAllByRole('button', { name: 'إضافة كتاب' })[0])
    const dlg = await screen.findByRole('dialog', { name: 'إضافة كتاب' })
    await user.type(within(dlg).getByLabelText('العنوان'), 'ك')
    await user.type(within(dlg).getByLabelText('المؤلف'), 'م')
    await user.type(within(dlg).getByLabelText('ISBN (10 أو 13 خانة)'), '9780306406158')
    await user.click(within(dlg).getByRole('button', { name: 'حفظ' }))
    expect(await screen.findByText(/رقم ISBN غير صالح/)).toBeTruthy()
  })

  test('الأرشفة مع «تراجع»، والكتاب المؤرشف يظهر في تبويبه', async () => {
    const user = userEvent.setup()
    await boot(async () => { await seedAdmin(); await call('books:save', { title: 'كتاب للأرشفة', author: 'م', copies: 1 }); await call('auth:logout') })
    await loginUi(user)
    await nav(user, 'الكتب')
    expect(await screen.findByText('كتاب للأرشفة')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'أرشفة' }))
    expect(await screen.findByText(/تمت أرشفة/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('كتاب للأرشفة')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'تراجع' }))
    expect(await screen.findByText('كتاب للأرشفة')).toBeTruthy()

    // أرشفة ثم الذهاب لتبويب المؤرشفة والاسترجاع
    await user.click(screen.getByRole('button', { name: 'أرشفة' }))
    await waitFor(() => expect(screen.queryByText('كتاب للأرشفة')).toBeNull())
    await user.click(screen.getByRole('tab', { name: 'المؤرشفة' }))
    expect(await screen.findByText('كتاب للأرشفة')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /استرجاع/ }))
    expect(await screen.findByText(/تم استرجاع/)).toBeTruthy()
  })

  test('الإعارة بالقوائم القابلة للبحث ثم الإرجاع', async () => {
    const user = userEvent.setup()
    await boot(async () => {
      await seedAdmin()
      await call('books:save', { title: 'مقدمة ابن خلدون', author: 'ابن خلدون', copies: 1 })
      await call('books:save', { title: 'كليلة ودمنة', author: 'ابن المقفع', copies: 2 })
      await call('members:save', { name: 'أحمد بن علي' })
      await call('auth:logout')
    })
    await loginUi(user)
    await nav(user, 'الإعارات')
    await user.click(await screen.findByRole('button', { name: 'إعارة جديدة' }))
    const dlg = await screen.findByRole('dialog', { name: 'إعارة جديدة' })

    const book = within(dlg).getByRole('combobox', { name: 'الكتاب' })
    await user.type(book, 'خلدون')
    await user.click(await within(dlg).findByRole('option', { name: /مقدمة ابن خلدون/ }))
    expect(book.value).toBe('مقدمة ابن خلدون')

    const member = within(dlg).getByRole('combobox', { name: 'العضو' })
    await user.click(member)
    await user.click(await within(dlg).findByRole('option', { name: /أحمد بن علي/ }))

    await user.click(within(dlg).getByRole('button', { name: '30 يومًا' }))
    await user.click(within(dlg).getByRole('button', { name: 'تسجيل الإعارة' }))
    expect(await screen.findByText(/تمت إعارة/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const table = await screen.findByRole('table')
    expect(within(table).getByText('أحمد بن علي')).toBeTruthy()
    expect(within(table).getByText('جارية')).toBeTruthy()

    await user.click(within(table).getByRole('button', { name: /إرجاع/ }))
    expect(await screen.findByText(/تم إرجاع/)).toBeTruthy()
    expect(await within(table).findByText('مُعادة')).toBeTruthy()
  })

  test('الإعارة بدون اختيار من القائمة تُرفض برسالة', async () => {
    const user = userEvent.setup()
    await boot(async () => { await seedAdmin(); await call('auth:logout') })
    await loginUi(user)
    await nav(user, 'الإعارات')
    await user.click(await screen.findByRole('button', { name: 'إعارة جديدة' }))
    const dlg = await screen.findByRole('dialog', { name: 'إعارة جديدة' })
    await user.type(within(dlg).getByRole('combobox', { name: 'الكتاب' }), 'نص حر')
    await user.click(within(dlg).getByRole('button', { name: 'تسجيل الإعارة' }))
    expect(await screen.findByText('اختر الكتاب من القائمة')).toBeTruthy()
  })

  test('حبس التركيز: Tab لا يخرج من النافذة، وEscape يغلقها ويعيد التركيز', async () => {
    const user = userEvent.setup()
    await boot(seedAdminAndLogout)
    await loginUi(user)
    await nav(user, 'الكتب')
    const opener = screen.getAllByRole('button', { name: 'إضافة كتاب' })[0]
    await user.click(opener)
    const dlg = await screen.findByRole('dialog', { name: 'إضافة كتاب' })
    expect(dlg.contains(document.activeElement)).toBe(true)
    expect(document.activeElement.tagName).toBe('INPUT')

    for (let i = 0; i < 14; i++) {
      await user.tab()
      expect(dlg.contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 4; i++) {
      await user.tab({ shift: true })
      expect(dlg.contains(document.activeElement)).toBe(true)
    }

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  test('الترقيم: 30 كتابًا على صفحتين', async () => {
    const user = userEvent.setup()
    await boot(async () => {
      await seedAdmin()
      for (let i = 1; i <= 30; i++) await call('books:save', { title: `كتاب رقم ${i}`, author: 'م', copies: 1 })
      await call('auth:logout')
    })
    await loginUi(user)
    await nav(user, 'الكتب')
    expect(await screen.findByText('1–25 من 30')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'الصفحة التالية' }))
    expect(await screen.findByText('26–30 من 30')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'الصفحة التالية' }).disabled).toBe(true)
  })

  test('أمين المكتبة: لا يرى الإدارة ولا الأرشفة ولا تبويب المؤرشفة', async () => {
    const user = userEvent.setup()
    await boot(async () => {
      await seedAdmin()
      await call('users:save', { username: 'amin', display_name: 'أمين', role: 'librarian', password: 'secret-pass' })
      await call('books:save', { title: 'كتاب', author: 'م', copies: 1 })
      await call('auth:logout')
    })
    await loginUi(user, 'amin')
    expect(await screen.findByRole('heading', { name: 'نظرة عامة' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'الإدارة' })).toBeNull()
    await nav(user, 'الكتب')
    expect(await screen.findByText('كتاب')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'أرشفة' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'المؤرشفة' })).toBeNull()
    expect(screen.getByRole('button', { name: 'تعديل' })).toBeTruthy()
  })

  test('الإدارة: المدير يضيف مستخدمًا ويُنشئ نسخة احتياطية', async () => {
    const user = userEvent.setup()
    await boot(seedAdminAndLogout)
    await loginUi(user)
    await nav(user, 'الإدارة')
    await user.click(await screen.findByRole('button', { name: 'إضافة مستخدم' }))
    const dlg = await screen.findByRole('dialog', { name: 'إضافة مستخدم' })
    await user.type(within(dlg).getByLabelText('الاسم الكامل'), 'سارة')
    await user.type(within(dlg).getByLabelText('اسم المستخدم'), 'sara')
    await user.type(within(dlg).getByLabelText('كلمة المرور (8 أحرف على الأقل)'), 'sara-pass-1')
    await user.click(within(dlg).getByRole('button', { name: 'حفظ' }))
    expect(await screen.findByText('تمت إضافة المستخدم')).toBeTruthy()
    expect(await screen.findByText('سارة')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'النسخ الاحتياطي' }))
    await user.click(await screen.findByRole('button', { name: 'إنشاء نسخة الآن' }))
    expect(await screen.findByText('تم إنشاء نسخة احتياطية')).toBeTruthy()
    const table = await screen.findByRole('table')
    expect(within(table).getAllByText('يدوية').length).toBe(1)
  })

  test('تسجيل الخروج يعيد شاشة الدخول', async () => {
    const user = userEvent.setup()
    await boot(seedAdminAndLogout)
    await loginUi(user)
    await screen.findByRole('heading', { name: 'نظرة عامة' })
    await user.click(screen.getByRole('button', { name: 'تسجيل الخروج' }))
    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeTruthy()
  })
})
