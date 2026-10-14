import { useEffect, useState } from 'react'
import { tk } from './i18n.js'

const KEY = 'theme'
export const MODES = ['light', 'dark', 'system']
export const MODE_LABEL = { light: tk("فاتح"), dark: tk("داكن"), system: tk("حسب النظام") }

export function getMode() {
  try {
    const v = localStorage.getItem(KEY)
    return MODES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

const prefersDark = () => !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
export const resolveTheme = (mode) => (mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode)

export function applyTheme(mode) {
  document.documentElement.dataset.theme = resolveTheme(mode)
}

/** يعيد الوضع الحالي ودالة للتبديل بين: فاتح ← داكن ← حسب النظام. يُحفظ الاختيار. */
export function useTheme() {
  const [mode, setMode] = useState(getMode)

  useEffect(() => {
    applyTheme(mode)
    if (mode !== 'system') return
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq?.addEventListener?.('change', onChange)
    return () => mq?.removeEventListener?.('change', onChange)
  }, [mode])

  const cycle = () => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length]
    try { localStorage.setItem(KEY, next) } catch { /* التخزين غير متاح: يبقى للجلسة فقط */ }
    setMode(next)
  }
  return { mode, cycle }
}
