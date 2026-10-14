import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { call } from './api.js'
import { useAuth } from './auth.jsx'
import { getLocale, setLocale, tr, tk } from './i18n.js'

export const SETTINGS_DEFAULTS = {
  library_name: tk("تسيير المكتبة"), default_loan_days: 14, max_loans: 5, max_renewals: 2,
  fine_per_day: 0, fine_cap: 0, fine_block_limit: 0, currency: tk("دج"), hold_days: 3, language: 'ar',
}
const Ctx = createContext({ settings: { ...SETTINGS_DEFAULTS, library_name: SETTINGS_DEFAULTS.library_name }, reload: () => {} })
export const useSettings = () => useContext(Ctx)

export function SettingsProvider({ children }) {
  const setLang = useAuth()?.setLang
  const [settings, setSettings] = useState(() => ({ ...SETTINGS_DEFAULTS, library_name: tr(SETTINGS_DEFAULTS.library_name), currency: tr(SETTINGS_DEFAULTS.currency) }))
  const reload = useCallback(async () => {
    try {
      const s = await call('settings:get')
      // لغة المكتبة تغيّرت (من الإعدادات): نضبطها ثم نعيد بناء الواجهة بها
      if (s.language !== getLocale()) {
        setLocale(s.language)
        setLang?.(s.language)
      }
      setSettings(s)
    } catch { /* الافتراضي */ }
  }, [setLang])
  useEffect(() => { reload() }, [reload])
  const value = useMemo(() => ({ settings, reload }), [settings, reload])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
