import { useCallback, useEffect, useRef, useState } from 'react'
import { call } from './api.js'
import { useToast } from './ui.jsx'

export function useDebounced(value, ms = 200) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * يحمّل قائمة مرقّمة من الخادم. يتجاهل الردود المتأخرة،
 * وإذا أصبحت الصفحة الحالية فارغة (بعد أرشفة آخر عنصر) ينتقل لآخر صفحة.
 */
export function useList(channel, params, setPage) {
  const notify = useToast()
  const [state, setState] = useState({ rows: [], total: 0, ready: false })
  const seq = useRef(0)
  const key = JSON.stringify(params)

  const reload = useCallback(async () => {
    const id = ++seq.current
    try {
      const p = JSON.parse(key)
      const r = await call(channel, p)
      if (id !== seq.current) return
      if (r.rows.length === 0 && r.total > 0 && p.page > 1 && setPage) {
        setPage(Math.ceil(r.total / p.pageSize))
        return
      }
      setState({ rows: r.rows, total: r.total, ready: true })
    } catch (e) {
      if (id !== seq.current) return
      if (e.code !== 'AUTH') notify(e.message, 'err')
      setState((s) => ({ ...s, ready: true }))
    }
  }, [channel, key, notify, setPage])

  useEffect(() => {
    reload()
  }, [reload])

  return { ...state, reload }
}
