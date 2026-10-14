import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { MotionConfig } from 'framer-motion'
import App from '../../src/App.jsx'
import { ToastProvider } from '../../src/ui.jsx'
import { AuthProvider } from '../../src/auth.jsx'

const require = createRequire(import.meta.url)
const { createDb } = require('../../electron/db.js')
const { createHandlers } = require('../../electron/handlers.js')

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x))) // يحاكي تسلسل IPC

/** يبني خادمًا حقيقيًا (قاعدة + معالجات) ويربطه بالواجهة. يعيد دالة call لتجهيز البيانات. */
export async function boot(seed, { dialog = {}, win = null, shell = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-'))
  const dbPath = path.join(dir, 'library.db')
  const h = createHandlers({
    dbPath, backupDir: path.join(dir, 'backups'),
    dialog, shell, getWindow: () => win,
    openDb: () => createDb(dbPath),
  })
  window.api = { invoke: async (ch, p) => clone(await h.invoke(ch, clone(p))) }
  const call = async (ch, p) => {
    const r = await h.invoke(ch, p)
    if (!r.ok) throw new Error(`${ch}: ${r.error}`)
    return r.data
  }
  if (seed) await seed(call)
  render(
    <MotionConfig>
      <ToastProvider><AuthProvider><App /></AuthProvider></ToastProvider>
    </MotionConfig>
  )
  return { call, h }
}

export const seedAdmin = (call) => call('auth:setup', { username: 'admin', display_name: 'المدير', password: 'secret-pass' })

export async function loginUi(user, username = 'admin', password = 'secret-pass') {
  await user.type(await screen.findByLabelText('اسم المستخدم'), username)
  await user.type(screen.getByLabelText('كلمة المرور'), password)
  await user.click(screen.getByRole('button', { name: 'دخول' }))
}

export const nav = (user, name) => user.click(screen.getByRole('button', { name }))
