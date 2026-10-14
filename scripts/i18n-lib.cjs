/**
 * أدوات مشتركة لمسح النصوص العربية في المصدر. يستعملها المحوّل (i18n-codemod) واختبار الاكتمال.
 * القاعدة: كل نص عربي يجب أن يكون الوسيط الأول لـ tr(...) أو tk(...)، أو مستثنى بعلامة i18n-ignore
 * في سطره أو السطر السابق، أو قالب SQL.
 */
const fs = require('fs')
const path = require('path')
const { parse } = require('@babel/parser')

const AR = /[\u0600-\u06FF]/
const MARK = 'i18n-ignore'
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|FROM|WHERE|PRAGMA|VACUUM)\b/
const isFn = (n) => /Function|ArrowFunction|ClassMethod|ObjectMethod/.test(n.type)
const isCall = (n, names) => n?.type === 'CallExpression' && n.callee.type === 'Identifier' && names.includes(n.callee.name)

const walkDir = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDir(path.join(d, e.name)) : [path.join(d, e.name)]))

/** ملفات المصدر المشمولة: واجهة src وعملية electron الرئيسية */
const sourceFiles = (root) =>
  [...walkDir(path.join(root, 'src')), ...walkDir(path.join(root, 'electron'))].filter((f) => /\.(jsx?|cjs)$/.test(f) && !f.includes('/locales/'))

const parseSrc = (src) => parse(src, { sourceType: 'unambiguous', plugins: ['jsx'] })

function marked(lines, node) {
  const l = node.loc.start.line
  return (lines[l - 1] || '').includes(MARK) || (lines[l - 2] || '').includes(MARK)
}

const childNodes = (node) => {
  const out = []
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments' || k === 'extra') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && out.push(c))
    else if (v && typeof v.type === 'string') out.push(v)
  }
  return out.sort((a, b) => a.start - b.start)
}

const isSqlTemplate = (node) => node.type === 'TemplateLiteral' && node.quasis.some((q) => SQL.test(q.value.cooked))

/** يمسح ملفًا: يعيد النصوص غير المترجمة والمفاتيح المستعملة */
function scan(file, srcText) {
  const src = srcText ?? fs.readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const ast = parseSrc(src)
  const untranslated = []
  const keys = []
  const add = (node, text, kind) => untranslated.push({ file, line: node.loc.start.line, kind, text: text.slice(0, 60) })

  ;(function visit(node, anc) {
    const p = anc[anc.length - 1]
    if (isCall(node, ['tr', 'tk']) && node.arguments[0]?.type === 'StringLiteral') {
      keys.push({ key: node.arguments[0].value, file, line: node.loc.start.line, fn: node.callee.name })
      // نزور بقية الوسائط (قد تحوي tr متداخلة) دون الوسيط الأول
      node.arguments.slice(1).forEach((a) => visit(a, [...anc, node]))
      return
    }
    if (node.type === 'JSXText' && AR.test(node.value)) { if (!marked(lines, node)) add(node, node.value.trim(), 'jsx-text') }
    else if (node.type === 'StringLiteral' && AR.test(node.value)) {
      const keyOfObject = p?.type === 'ObjectProperty' && p.key === node && !p.computed
      const imp = p?.type === 'ImportDeclaration'
      if (!keyOfObject && !imp && !marked(lines, node)) add(node, node.value, p?.type === 'JSXAttribute' ? 'attr' : 'string')
    } else if (node.type === 'TemplateLiteral' && node.quasis.some((q) => AR.test(q.value.cooked))) {
      if (!isSqlTemplate(node) && !marked(lines, node)) add(node, node.quasis.map((q) => q.value.cooked).join('{}'), 'template')
    }
    for (const c of childNodes(node)) visit(c, [...anc, node])
  })(ast.program, [])
  return { untranslated, keys }
}

module.exports = { AR, MARK, SQL, isFn, isCall, sourceFiles, parseSrc, marked, childNodes, isSqlTemplate, scan }
