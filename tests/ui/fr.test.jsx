import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRequire } from 'node:module'
import { boot } from './helpers.jsx'
import { setLocale } from '../../src/i18n.js'

const require = createRequire(import.meta.url)
const fr = require('../../shared/locales/fr.json')
const F = (ar, args) => (fr[ar] ?? ar).replace(/\{(\d+)\}/g, (_, i) => args?.[i] ?? '') // للمفاتيح الطويلة فقط

const ARABIC = /[\u0600-\u06FF]/
const ENDONYM = /العربية/g // اسم اللغة بلغتها: مقصود أن يبقى عربيًا

/** يفتّش عن أي حرف عربي في النص الظاهر وفي خصائص الوصول، ويُظهر الكلمات المتسرّبة */
function noArabic(where) {
  const text = document.body.textContent.replace(ENDONYM, '')
  const attrs = [...document.querySelectorAll('[aria-label],[placeholder],[title]')]
    .flatMap((el) => ['aria-label', 'placeholder', 'title'].map((a) => el.getAttribute(a)))
    .filter(Boolean)
    .map((v) => v.replace(ENDONYM, ''))
  const leaked = [...(text.match(/\S*[\u0600-\u06FF]+\S*/g) || []), ...attrs.filter((a) => ARABIC.test(a))]
  expect(leaked, `نص عربي متسرّب في: ${where}`).toEqual([])
}

const loginFr = async (user, username = 'admin', password = 'secret-pass') => {
  await user.type(await screen.findByLabelText('Identifiant'), username)
  await user.type(screen.getByLabelText('Mot de passe'), password)
  await user.click(screen.getByRole('button', { name: 'Se connecter' }))
}
const navFr = (user, name) => user.click(screen.getByRole('button', { name }))

/** بيانات لاتينية فقط، واللغة تُضبط قبل أي عملية ليُسجَّل السجل بالفرنسية كله */
async function seedFr(call) {
  await call('app:setLanguage', { language: 'fr' })
  await call('auth:setup', { username: 'admin', display_name: 'Admin', password: 'secret-pass' })
  await call('settings:save', { fine_per_day: 10 })
  await call('books:save', { title: 'Le Petit Prince', author: 'Saint-Exupéry', category: 'Roman', shelf: 'A-1', copies: 2, isbn: '9780306406157' })
  await call('books:save', { title: 'Les Misérables', author: 'Victor Hugo', category: '', copies: 1 })
  await call('books:save', { title: 'Candide', author: 'Voltaire', copies: 1 })
  await call('members:save', { name: 'Ahmed Benali', phone: '0555123456', email: 'ahmed@example.com' })
  await call('members:save', { name: 'Sara Amrani' })
  await call('loans:borrow', { member_id: 2, book_id: 2 })                     // Sara: Les Misérables
  await call('reservations:create', { book_id: 2, member_id: 1 })              // Ahmed réserve
  await call('loans:return', 1)                                                // → réservation prête pour Ahmed
  await call('loans:borrow', { member_id: 1, book_id: 1 })                     // Ahmed: Petit Prince (en retard plus bas)
  await call('loans:borrow', { member_id: 2, book_id: 1, barcode: 'B00001-2' }) // Sara: 2e exemplaire
  await call('fines:add', { member_id: 1, amount: 50, reason: 'Livre abîmé' })
  await call('auth:logout')
}

describe('الواجهة بالفرنسية', () => {
  beforeEach(() => { document.body.innerHTML = ''; setLocale('ar') })
  afterEach(() => setLocale('ar'))

  test('شاشة الدخول: فرنسية، من اليسار لليمين، وأخطاء الخادم بالفرنسية', async () => {
    const user = userEvent.setup()
    await boot(seedFr)
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeTruthy()
    expect(document.documentElement.lang).toBe('fr')
    expect(document.documentElement.dir).toBe('ltr')
    expect(screen.getByRole('button', { name: 'Mot de passe oublié ?' })).toBeTruthy()
    noArabic('شاشة الدخول')

    await loginFr(user, 'admin', 'wrong-pass')
    expect(await screen.findByText('Identifiant ou mot de passe incorrect')).toBeTruthy()
    const pw = screen.getByLabelText('Mot de passe')
    await user.clear(pw)
    await user.type(pw, 'secret-pass')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('heading', { name: "Vue d'ensemble" })).toBeTruthy()
  })

  test('جولة كاملة: لا حرف عربي واحد في أي صفحة أو تبويب أو نافذة', async () => {
    const user = userEvent.setup()
    const { h, call } = await boot(seedFr)
    h.getDb().raw.prepare("UPDATE loans SET due_date = date('now','localtime','-5 days') WHERE return_date IS NULL").run()
    await loginFr(user)

    // --- نظرة عامة ---
    await screen.findByRole('heading', { name: "Vue d'ensemble" })
    expect(screen.getByRole('heading', { name: 'Réservations prêtes à retirer' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'À suivre' })).toBeTruthy()
    expect(screen.getByText('Gestion de bibliothèque')).toBeTruthy()          // اسم المكتبة الافتراضي بالفرنسية
    expect(document.title).toBe('Gestion de bibliothèque')                    // عنوان النافذة يتبعه
    expect(document.body.textContent).toMatch(/lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche/i) // تاريخ فرنسي
    noArabic('نظرة عامة')
    await user.click(screen.getAllByRole('button', { name: 'Relance' })[0])
    await screen.findByRole('dialog', { name: 'Message de rappel de retour' })
    noArabic('نافذة التذكير')
    await user.keyboard('{Escape}')

    // --- مكتب الإعارة ---
    await navFr(user, 'Guichet de prêt')
    await user.type(await screen.findByRole('combobox', { name: 'Adhérent' }), 'M00001{Enter}')
    await screen.findByText(/livre\(s\) sur 5/)
    noArabic('مكتب الإعارة (إعارة)')
    await user.click(screen.getByRole('tab', { name: 'Retour' }))
    noArabic('مكتب الإعارة (إرجاع)')

    // --- الكتب ---
    await navFr(user, 'Livres')
    await user.click(await screen.findByRole('button', { name: 'Le Petit Prince' }))
    const drawer = await screen.findByRole('dialog', { name: 'Le Petit Prince' })
    expect(within(drawer).getByText('Exemplaires')).toBeTruthy()
    within(drawer).getAllByRole('option', { name: 'Bon état' })
    noArabic('درج الكتاب')
    await user.click(within(drawer).getByRole('button', { name: 'Imprimer les étiquettes' }))
    await screen.findByRole('dialog', { name: "Imprimer les étiquettes des exemplaires du livre" })
    noArabic('نافذة الملصقات')
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getAllByRole('button', { name: 'Ajouter un livre' })[0])
    await screen.findByRole('dialog', { name: 'Ajouter un livre' })
    noArabic('نموذج كتاب')
    await user.keyboard('{Escape}')

    // --- الأعضاء ---
    await navFr(user, 'Adhérents')
    await user.click(await screen.findByRole('button', { name: 'Ahmed Benali' }))
    const md = await screen.findByRole('dialog', { name: 'Ahmed Benali' })
    expect(await within(md).findByText('Amendes')).toBeTruthy()
    noArabic('درج العضو')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Imprimer les cartes' }))
    await screen.findByRole('dialog', { name: 'Imprimer les cartes des adhérents' })
    noArabic('نافذة البطاقات')
    await user.keyboard('{Escape}')

    // --- الإعارات ---
    await navFr(user, 'Prêts')
    await screen.findByRole('table')
    noArabic('الإعارات')
    await user.click(screen.getByRole('button', { name: 'Liste des retards' }))
    await screen.findByRole('dialog', { name: 'Liste des livres en retard' })
    noArabic('كشف المتأخرات')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Nouveau prêt' }))
    await screen.findByRole('dialog', { name: 'Nouveau prêt' })
    noArabic('إعارة جديدة')
    await user.keyboard('{Escape}')

    // --- التقارير ---
    await navFr(user, 'Rapports')
    await screen.findByRole('heading', { name: 'Rapports' })
    await screen.findByText('Prêts de la période')
    noArabic('التقارير')

    // --- الإدارة: كل التبويبات ---
    await navFr(user, 'Administration')
    for (const tab of ['Utilisateurs', 'Paramètres', 'Données', 'Sauvegardes', 'Journal des opérations', 'Sécurité']) {
      await user.click(await screen.findByRole('tab', { name: tab }))
      if (tab === 'Sauvegardes') {
        await user.click(await screen.findByRole('button', { name: 'Créer une sauvegarde maintenant' }))
        await screen.findByText('Manuelle')
      }
      if (tab === 'Journal des opérations') await screen.findByText(/Prêt de « Les Misérables »/)
      noArabic(`الإدارة / ${tab}`)
    }

    // --- شريط الأوامر ووضع القارئ ---
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: 'Recherche et commandes' })
    noArabic('شريط الأوامر')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Mode lecteur' }))
    const k = await screen.findByRole('dialog', { name: 'Mode lecteur' })
    await user.type(within(k).getByRole('textbox', { name: 'Rechercher un livre' }), 'prince')
    await within(k).findByRole('list', { name: 'Résultats de la recherche' })
    expect(k.textContent).toContain('Rayon :')
    expect(k.textContent).toMatch(/Disponible|Actuellement emprunté/)
    noArabic('وضع القارئ')
    expect(call).toBeTruthy()
  })

  test('الاتجاه: أزرار الترقيم والرسم الشهري يتبعان اتجاه القراءة', async () => {
    const user = userEvent.setup()
    await boot(async (c) => {
      await c('app:setLanguage', { language: 'fr' })
      await c('auth:setup', { username: 'admin', display_name: 'Admin', password: 'secret-pass' })
      for (let i = 1; i <= 30; i++) await c('books:save', { title: `Book ${i}`, author: 'A', copies: 1 })
      await c('auth:logout')
    })
    await loginFr(user)
    await navFr(user, 'Livres')
    const next = await screen.findByRole('button', { name: 'Page suivante' })
    expect(next.querySelector('.lucide-chevron-right')).toBeTruthy()        // التالي إلى اليمين بالفرنسية
    expect(screen.getByRole('button', { name: 'Page précédente' }).querySelector('.lucide-chevron-left')).toBeTruthy()

    await navFr(user, 'Rapports')
    const svg = await screen.findByRole('img', { name: /Prêts mensuels sur les 12 derniers mois/ })
    await waitFor(() => expect(svg.querySelectorAll('rect').length).toBe(12))
    const xs = [...svg.querySelectorAll('rect')].map((r) => Number(r.getAttribute('x')))
    expect(xs[0]).toBeLessThan(xs[11])                                      // الأقدم في اليسار بالفرنسية
  })

  test('الإعداد الأول: تبديل اللغة من الشاشة يحفظها في الخادم، والنصوص كلها بالفرنسية', async () => {
    const user = userEvent.setup()
    const { h } = await boot()
    expect(await screen.findByRole('heading', { name: 'إنشاء حساب المدير' })).toBeTruthy()
    expect(document.documentElement.dir).toBe('rtl')
    await user.click(screen.getByRole('button', { name: 'Français' }))
    expect(await screen.findByRole('heading', { name: 'Créer le compte administrateur' })).toBeTruthy()
    expect(document.documentElement.dir).toBe('ltr')
    expect((await h.invoke('app:info')).data.language).toBe('fr')
    noArabic('إعداد أول')

    await user.type(screen.getByLabelText('Nom complet'), 'Admin')
    await user.type(screen.getByLabelText('Identifiant'), 'admin')
    await user.type(screen.getByLabelText('Mot de passe (8 caractères minimum)'), 'secret-pass')
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'secret-pass')
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }))
    expect(await screen.findByRole('note', { name: 'Code de récupération' })).toBeTruthy()
    noArabic('رمز الاسترداد')
    await user.click(screen.getByRole('checkbox', { name: "J'ai conservé le code en lieu sûr" }))
    await user.click(screen.getByRole('button', { name: "Continuer vers l'application" }))
    expect(await screen.findByRole('heading', { name: "Vue d'ensemble" })).toBeTruthy()
  })

  test('تبديل لغة المكتبة من الإعدادات: فرنسية ← عربية ← فرنسية، وتُحفظ في الخادم', async () => {
    const user = userEvent.setup()
    const { h } = await boot(seedFr)
    await loginFr(user)
    await navFr(user, 'Administration')
    await user.click(await screen.findByRole('tab', { name: 'Paramètres' }))
    const sel = await screen.findByLabelText(F('لغة المكتبة (الواجهة والرسائل والطباعة والتصدير)'))
    await user.selectOptions(sel, 'ar')
    await user.click(screen.getByRole('button', { name: 'Enregistrer les paramètres' }))
    expect(await screen.findByRole('heading', { name: 'الإدارة' })).toBeTruthy()
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
    expect((await h.invoke('app:info')).data.language).toBe('ar')

    await user.click(await screen.findByRole('tab', { name: 'الإعدادات' }))
    await user.selectOptions(await screen.findByLabelText('لغة المكتبة (الواجهة والرسائل والطباعة والتصدير)'), 'fr')
    await user.click(screen.getByRole('button', { name: 'حفظ الإعدادات' }))
    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeTruthy()
    expect(document.documentElement.dir).toBe('ltr')
  })

  test('إيصال الإعارة بالفرنسية', async () => {
    const user = userEvent.setup()
    let root = null
    window.print = () => { root = document.getElementById('print-root').cloneNode(true) }
    await boot(seedFr)
    await loginFr(user)
    await navFr(user, 'Guichet de prêt')
    await user.type(await screen.findByRole('combobox', { name: 'Adhérent' }), 'M00002{Enter}')
    const book = await screen.findByRole('combobox', { name: 'Livre' })
    await waitFor(() => expect(document.activeElement).toBe(book))
    await user.type(book, 'B00003-1{Enter}')   // Candide (libre; Les Misérables est réservé pour Ahmed)
    await user.click(await screen.findByRole('button', { name: /Imprimer un reçu/ }))
    await waitFor(() => expect(root).not.toBeNull())
    expect(root.textContent).toContain('Reçu de prêt')
    expect(root.textContent).toContain("Merci. Veuillez rendre les livres à la date prévue.")
    expect(ARABIC.test(root.textContent)).toBe(false)
  })
})
