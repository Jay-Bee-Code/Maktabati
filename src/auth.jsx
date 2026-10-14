import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { call } from './api.js'
import { getLocale, setLocale } from './i18n.js'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }) {
  // phase: loading | setup | login | ready | error
  const [state, setState] = useState({ phase: 'loading', user: null })
  const [lang, setLang] = useState(getLocale())
  const pending = useRef(null) // المدير الجديد بين إنشاء الحساب وتأكيد حفظ رمز الاسترداد

  const refresh = useCallback(async () => {
    try {
      // لغة المكتبة أولًا لتظهر شاشة الدخول بها
      const info = await call('app:info')
      if (info.language !== getLocale()) {
        setLocale(info.language)
        setLang(info.language)
      }
      const s = await call('auth:status')
      setState(s.user ? { phase: 'ready', user: s.user } : { phase: s.hasUsers ? 'login' : 'setup', user: null })
    } catch (e) {
      setState({ phase: 'error', user: null, error: e.message })
    }
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('auth-lost', refresh)
    return () => window.removeEventListener('auth-lost', refresh)
  }, [refresh])

  const value = useMemo(
    () => ({
      ...state,
      isAdmin: state.user?.role === 'admin',
      lang,
      setLang,
      // عند الإعداد الأول يختار المستخدم اللغة قبل إنشاء الحساب
      changeLanguage: async (language) => {
        const r = await call('app:setLanguage', { language })
        setLocale(r.language)
        setLang(r.language)
      },
      login: async (username, password) => setState({ phase: 'ready', user: await call('auth:login', { username, password }) }),
      // يُنشئ الحساب ويعيد رمز الاسترداد. لا ندخل التطبيق قبل finishSetup (بعد تأكيد حفظ الرمز).
      setup: async (p) => {
        const { recoveryCode, ...user } = await call('auth:setup', p)
        pending.current = user
        return recoveryCode
      },
      finishSetup: () => {
        setState({ phase: 'ready', user: pending.current })
        pending.current = null
      },
      logout: async () => {
        await call('auth:logout')
        setState({ phase: 'login', user: null })
      },
    }),
    [state, lang]
  )
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
