const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8')
const block = (re) => (css.match(re) || [, ''])[1]
const parse = (b) => Object.fromEntries([...b.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]))
const light = parse(block(/@theme\s*\{([\s\S]*?)\n\}/))
const dark = { ...light, ...parse(block(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)) }
const darkOnly = parse(block(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/))

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

test('كل رمز لون في الوضع الفاتح له قيمة صريحة في الداكن (عدا المقصود بقاؤه)', () => {
  const sameOnPurpose = new Set(['danger', 'danger-deep'])   // أزرار حمراء بنص أبيض في الوضعين
  const missing = Object.keys(light).filter((k) => !(k in darkOnly) && !sameOnPurpose.has(k))
  assert.deepEqual(missing, [], `رموز بلا نظير داكن: ${missing.join(', ')}`)
  assert.ok(Object.keys(light).length >= 15)
})

/* أزواج النص/الخلفية الفعلية في الواجهة. النص العادي يحتاج 4.5 على الأقل (WCAG AA). */
const PAIRS = [
  ['ink', 'paper'], ['ink', 'card'], ['ink', 'mist'],
  ['muted', 'card'], ['muted', 'paper'], ['muted', 'mist'],
  ['accent', 'card'], ['accent', 'paper'],
  ['moss', 'ok-bg'], ['brass', 'warn-bg'], ['brick', 'bad-bg'],
  ['brick', 'card'], ['moss', 'card'], ['brass', 'card'],
]
const ON_DARK_BG = [['white', 'teal'], ['white', 'teal-deep'], ['white', 'danger']] // نص أبيض على خلفية ملونة

for (const [name, theme] of [['الفاتح', light], ['الداكن', dark]]) {
  test(`التباين في الوضع ${name}: نص عادي ≥ 4.5`, () => {
    const bad = []
    for (const [fg, bg] of PAIRS) {
      const r = ratio(theme[fg], theme[bg])
      if (r < 4.5) bad.push(`${fg} على ${bg} = ${r.toFixed(2)}`)
    }
    for (const [, bg] of ON_DARK_BG) {
      const r = ratio('#ffffff', theme[bg])
      if (r < 4.5) bad.push(`أبيض على ${bg} = ${r.toFixed(2)}`)
    }
    assert.deepEqual(bad, [])
  })
}
