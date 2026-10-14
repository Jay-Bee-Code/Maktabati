const path = require('path')
const ExcelJS = require('exceljs')
const { arnorm } = require('./db')
const { tr, tk, trIn } = require('./i18n')

/* تعريف الأعمدة: [المفتاح, العنوان العربي, العرض, أسماء بديلة مقبولة عند الاستيراد] */
const SHEETS = {
  books: {
    title: tk("الكتب"),
    required: ['title', 'author'],
    text: ['isbn'],
    cols: [
      ['title', tk("العنوان"), 34, [tk("عنوان الكتاب"), tk("الكتاب")]],
      ['author', tk("المؤلف"), 26, [tk("اسم المؤلف")]],
      ['isbn', 'ISBN', 18, []],
      ['category', tk("التصنيف"), 16, [tk("القسم")]],
      ['shelf', tk("الرف"), 10, [tk("الرفّ")]],
      ['year', tk("سنة النشر"), 12, [tk("السنة")]],
      ['copies', tk("عدد النسخ"), 12, [tk("النسخ"), tk("الكمية")]],
    ],
    sample: { title: tk("ثلاثية غرناطة"), author: tk("رضوى عاشور"), isbn: '9780306406157', category: tk("رواية"), shelf: 'A-12', year: 1994, copies: 2 },
  },
  members: {
    title: tk("الأعضاء"),
    required: ['name'],
    text: ['phone', 'card_no'],
    cols: [
      ['name', tk("الاسم"), 28, [tk("الاسم الكامل")]],
      ['phone', tk("الهاتف"), 16, [tk("رقم الهاتف"), tk("الجوال")]],
      ['email', tk("البريد"), 26, [tk("البريد الإلكتروني")]],
      ['address', tk("العنوان"), 28, []],
      ['card_no', tk("رقم البطاقة"), 16, [tk("البطاقة")]],
    ],
    sample: { name: tk("أحمد بن علي"), phone: '0555123456', email: 'ahmed@example.com', address: tk("وهران"), card_no: '' },
  },
  loans: {
    title: tk("الإعارات"),
    cols: [
      ['title', tk("الكتاب"), 34], ['author', tk("المؤلف"), 24], ['barcode', tk("باركود النسخة"), 16],
      ['member_name', tk("العضو"), 26], ['card_no', tk("رقم البطاقة"), 14],
      ['loan_date', tk("تاريخ الإعارة"), 14], ['due_date', tk("موعد الإرجاع"), 14], ['return_date', tk("تاريخ الإرجاع"), 14],
      ['status', tk("الحالة"), 12],
    ],
  },
}
const STATUS_AR = { active: tk("جارية"), overdue: tk("متأخرة"), returned: tk("مُعادة") }

const norm = (s) => arnorm(s).replace(/[^\p{L}\p{N}]+/gu, '')

function styled(ws, def) {
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }]
  ws.columns = def.cols.map(([key, label, width]) => ({
    key, header: tr(label), width,
    style: def.text?.includes(key) ? { numFmt: '@' } : {},
  }))
  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E5560' } }
  head.alignment = { horizontal: 'center', vertical: 'middle' }
  head.height = 24
}

async function exportKind(kind, db, file) {
  const def = SHEETS[kind]
  if (!def) throw new Error(tr("نوع غير معروف"))
  const rows = kind === 'books' ? db.allBooks() : kind === 'members' ? db.allMembers() : db.allLoans().map((l) => ({ ...l, status: tr(STATUS_AR[l.status]) }))
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(tr(def.title))
  styled(ws, def)
  for (const r of rows) ws.addRow(Object.fromEntries(def.cols.map(([k]) => [k, r[k] ?? ''])))
  await wb.xlsx.writeFile(file)
  return rows.length
}

async function template(kind, file) {
  const def = SHEETS[kind]
  if (!def || !def.sample) throw new Error(tr("نوع غير معروف"))
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(tr(def.title))
  styled(ws, def)
  ws.addRow(Object.fromEntries(Object.entries(def.sample).map(([k, v]) => [k, typeof v === 'string' ? tr(v) : v])))
  await wb.xlsx.writeFile(file)
}

function cellValue(v) {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('')
    if (v.text != null) return String(v.text)
    if (v.result != null) return String(v.result)
    return ''
  }
  return v
}

/** يقرأ xlsx أو csv ويعيد صفوفًا بمفاتيح قياسية مع رقم الصف في الملف (_row) */
async function readRows(kind, file) {
  const def = SHEETS[kind]
  if (!def || !def.sample) throw new Error(tr("نوع غير معروف"))
  const wb = new ExcelJS.Workbook()
  if (path.extname(file).toLowerCase() === '.csv') await wb.csv.readFile(file)
  else await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error(tr("الملف لا يحتوي على أوراق"))

  const alias = new Map()
  for (const [key, label, , others = []] of def.cols) for (const a of [key, label, ...others]) for (const lang of ['ar', 'fr']) alias.set(norm(trIn(lang, a)), key)

  const colKey = {}
  ws.getRow(1).eachCell((cell, n) => {
    const k = alias.get(norm(cellValue(cell.value)))
    if (k) colKey[n] = k
  })
  for (const req of def.required) {
    if (!Object.values(colKey).includes(req)) {
      const label = def.cols.find((c) => c[0] === req)[1]
      throw new Error(tr("لم أجد العمود «{0}» في الصف الأول من الملف", [tr(label)]))
    }
  }

  const rows = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const o = { _row: rowNumber }
    let any = false
    for (const [n, key] of Object.entries(colKey)) {
      let v = cellValue(row.getCell(Number(n)).value)
      if (typeof v === 'number') {
        // ISBN-10 يفقد الصفر الأول عند حفظه كرقم في Excel
        v = key === 'isbn' && String(v).length === 9 ? String(v).padStart(10, '0') : def.text?.includes(key) ? String(v) : v
      }
      if (typeof v === 'string') v = v.trim()
      if (v !== '') any = true
      o[key] = v
    }
    if (any) rows.push(o)
  })
  if (rows.length === 0) throw new Error(tr("لا توجد صفوف بيانات تحت العناوين"))
  if (rows.length > 20000) throw new Error(tr("الملف كبير جدًا (الحد 20000 صف). قسّمه إلى ملفين."))
  return rows
}

module.exports = { exportKind, template, readRows }
