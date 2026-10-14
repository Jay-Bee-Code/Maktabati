import { useState } from 'react'
import { motion } from 'framer-motion'
import { Library } from 'lucide-react'
import { call } from './api.js'
import { useAuth } from './auth.jsx'
import { RecoveryCodePanel } from './RecoveryCode.jsx'
import { Button, Field, SPINES, inputCls, useToast } from './ui.jsx'
import { LOCALES } from './i18n.js'
import { tr } from './i18n.js'

const HEIGHTS = [150, 210, 120, 250, 180, 140, 230, 170]

export default function Login() {
  const { phase, login, setup, finishSetup, error, lang, changeLanguage } = useAuth()
  const notify = useToast()
  const isSetup = phase === 'setup'
  const [view, setView] = useState('form') // form | recover | code
  const [shown, setShown] = useState(null) // { code, intro, done }
  const [f, setF] = useState({ display_name: '', username: '', password: '', confirm: '', recoveryCode: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if ((isSetup || view === 'recover') && f.password !== f.confirm) return notify(tr("كلمتا المرور غير متطابقتين"), 'err')
    setBusy(true)
    try {
      if (isSetup) {
        const code = await setup({ display_name: f.display_name, username: f.username, password: f.password })
        setShown({ code, intro: tr("تم إنشاء حساب المدير. هذا رمز الاسترداد، وهو الطريقة الوحيدة لاستعادة الوصول إن نسيت كلمة المرور."), done: finishSetup, label: tr("متابعة إلى التطبيق") })
        setView('code')
      } else if (view === 'recover') {
        const r = await call('auth:recover', { username: f.username, code: f.recoveryCode, newPassword: f.password })
        setShown({
          code: r.recoveryCode,
          intro: tr("تم تغيير كلمة المرور. الرمز القديم لم يعد صالحًا، وهذا رمزك الجديد."),
          done: () => { setF((x) => ({ ...x, password: '', confirm: '', recoveryCode: '' })); setView('form') },
          label: tr("العودة إلى تسجيل الدخول"),
        })
        setView('code')
      } else {
        await login(f.username, f.password)
      }
    } catch (err) {
      notify(err.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'error')
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="max-w-md text-sm leading-7 text-brick">{error}</p>
      </div>
    )

  const recovering = view === 'recover'
  const title = view === 'code' ? tr("رمز الاسترداد") : isSetup ? tr("إنشاء حساب المدير") : recovering ? tr("استرداد حساب المدير") : tr("تسجيل الدخول")
  const lead =
    view === 'code' ? tr("احفظ الرمز قبل المتابعة.")
    : isSetup ? tr("أول تشغيل: أنشئ حساب المدير الذي سيدير المستخدمين والنسخ الاحتياطية.")
    : recovering ? tr("أدخل رمز الاسترداد المحفوظ لديك لتعيين كلمة مرور جديدة لحساب المدير.")
    : tr("سجّل دخولك لمتابعة الإعارات والكتب والأعضاء.")

  return (
    <div className="grid h-full grid-cols-[1.1fr_1fr]">
      <div className="relative flex flex-col justify-between overflow-hidden bg-teal-deep px-12 py-14 text-white">
        <div>
          <div className="mb-6 grid size-12 place-items-center rounded-xl bg-white/10"><Library size={26} /></div>
          <h1 className="font-display text-5xl font-bold leading-tight">{tr("تسيير المكتبة")}</h1>
          <p className="mt-3 max-w-sm text-white/75">{lead}</p>
        </div>
        <div className="flex items-end gap-2 border-b-[6px] border-brass" aria-hidden="true">
          {HEIGHTS.map((h, i) => (
            <div key={i} className="w-12 rounded-t-md" style={{ height: h, backgroundColor: SPINES[i % SPINES.length] }} />
          ))}
        </div>
      </div>

      <div className="grid place-items-center overflow-auto px-8 py-8">
        {view === 'code' ? (
          <div className="w-full max-w-sm">
            <h2 className="mb-4 font-display text-3xl font-bold">{title}</h2>
            <RecoveryCodePanel code={shown.code} intro={shown.intro} doneLabel={shown.label} onDone={shown.done} />
          </div>
        ) : (
          <motion.form
            key={view}
            onSubmit={submit}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex w-full max-w-sm flex-col gap-4"
          >
            {isSetup && (
              <div className="flex gap-1 self-end" role="group" aria-label={tr("اللغة")}>
                {LOCALES.map(([code, label]) => (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={lang === code}
                    onClick={() => changeLanguage(code).catch((e) => notify(e.message, 'err'))}
                    className={`cursor-pointer rounded-md border px-3 py-1 text-sm ${lang === code ? 'border-teal bg-teal text-white' : 'border-line hover:bg-mist'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <h2 className="font-display text-3xl font-bold">{title}</h2>
            {isSetup && (
              <Field label={tr("الاسم الكامل")}>
                <input autoFocus required value={f.display_name} onChange={set('display_name')} className={inputCls} />
              </Field>
            )}
            <Field label={recovering ? tr("اسم مستخدم المدير") : tr("اسم المستخدم")}>
              <input autoFocus={!isSetup} required value={f.username} onChange={set('username')} autoComplete="username" dir="ltr" className={`${inputCls} text-end`} />
            </Field>
            {recovering && (
              <Field label={tr("رمز الاسترداد")}>
                <input required value={f.recoveryCode} onChange={set('recoveryCode')} autoComplete="off" spellCheck={false} dir="ltr" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" className={`${inputCls} text-end font-mono`} />
              </Field>
            )}
            <Field label={isSetup ? tr("كلمة المرور (8 أحرف على الأقل)") : recovering ? tr("كلمة المرور الجديدة (8 أحرف على الأقل)") : tr("كلمة المرور")}>
              <input type="password" required minLength={isSetup || recovering ? 8 : undefined} value={f.password} onChange={set('password')} autoComplete={isSetup || recovering ? 'new-password' : 'current-password'} dir="ltr" className={`${inputCls} text-end`} />
            </Field>
            {(isSetup || recovering) && (
              <Field label={tr("تأكيد كلمة المرور")}>
                <input type="password" required value={f.confirm} onChange={set('confirm')} autoComplete="new-password" dir="ltr" className={`${inputCls} text-end`} />
              </Field>
            )}
            <Button type="submit" disabled={busy} className="mt-2 py-2.5">
              {isSetup ? tr("إنشاء الحساب") : recovering ? tr("تعيين كلمة المرور") : tr("دخول")}
            </Button>
            {!isSetup && (
              <button
                type="button"
                onClick={() => setView(recovering ? 'form' : 'recover')}
                className="cursor-pointer text-sm text-accent underline-offset-4 hover:underline"
              >
                {recovering ? tr("العودة إلى تسجيل الدخول") : tr("نسيت كلمة المرور؟")}
              </button>
            )}
          </motion.form>
        )}
      </div>
    </div>
  )
}
