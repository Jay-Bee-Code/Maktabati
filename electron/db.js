const Database = require('better-sqlite3')
const crypto = require('crypto')
const { tr, tk, LANGUAGES } = require('./i18n')

const ROLES = ['admin', 'librarian']
const COPY_STATUSES = ['ok', 'damaged', 'lost']
const SETTINGS_DEFAULTS = {
  library_name: tk("تسيير المكتبة"),
  default_loan_days: 14,
  max_loans: 5,
  max_renewals: 2,       // 0 = التمديد معطّل
  fine_per_day: 0,       // 0 = لا غرامات
  fine_cap: 0,           // 0 = بلا سقف للغرامة الواحدة
  fine_block_limit: 0,   // 0 = لا يُمنع الاستعارة بسبب الغرامات
  currency: tk("دج"),
  hold_days: 3,          // مدة الاحتفاظ بنسخة محجوزة جاهزة للاستلام
  language: 'ar',        // لغة المكتبة: الواجهة والرسائل والطباعة والتصدير
}

/* خطأ برمز ومعلومات إضافية تصل إلى الواجهة */
function err(message, code, info) {
  const e = new Error(message)
  if (code) e.code = code
  if (info) e.info = info
  return e
}

const barcodeOf = (bookId, n) => `B${String(bookId).padStart(5, '0')}-${n}`
const cardOf = (memberId) => `M${String(memberId).padStart(5, '0')}`

/* ====================================================================
   تطبيع النص العربي للبحث: إزالة التشكيل والتطويل، توحيد الألف والياء
   والتاء المربوطة، الأرقام الهندية واللاتينية، وإزالة علامات اللاتينية.
   (نسخة مطابقة في src/text.js للواجهة، ويختبرها tests/text.test.js)
   ==================================================================== */
function arnorm(s) {
  if (s == null) return ''
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/\u0671/g, 'ا')  // i18n-ignore: حرف تطبيع وظيفي
    .replace(/[\u0649\u06CC]/g, 'ي')  // i18n-ignore: حرف تطبيع وظيفي
    .replace(/\u0629/g, 'ه')  // i18n-ignore: حرف تطبيع وظيفي
    .replace(/\u06A9/g, 'ك')  // i18n-ignore: حرف تطبيع وظيفي
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/* ====================================================================
   الترحيلات: كل عنصر ينقل القاعدة من الإصدار i إلى i+1
   (يُخزَّن الإصدار في PRAGMA user_version). لا تعدّل عنصرًا قديمًا أبدًا،
   أضف عنصرًا جديدًا في النهاية.
   ==================================================================== */
const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS books (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  author     TEXT NOT NULL,
  isbn       TEXT,
  category   TEXT,
  year       INTEGER,
  copies     INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 0),
  shelf      TEXT,
  created_at TEXT NOT NULL DEFAULT (date('now','localtime'))
);
CREATE TABLE IF NOT EXISTS members (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  phone     TEXT,
  email     TEXT,
  address   TEXT,
  joined_at TEXT NOT NULL DEFAULT (date('now','localtime'))
);
CREATE TABLE IF NOT EXISTS loans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     INTEGER NOT NULL REFERENCES books(id),
  member_id   INTEGER NOT NULL REFERENCES members(id),
  loan_date   TEXT NOT NULL,
  due_date    TEXT NOT NULL,
  return_date TEXT
);
CREATE INDEX IF NOT EXISTS idx_loans_book   ON loans(book_id, return_date);
CREATE INDEX IF NOT EXISTS idx_loans_member ON loans(member_id, return_date);
`

const MIGRATIONS = [
  // 1: المخطط الأساسي
  (db) => db.exec(SCHEMA_V1),

  // 2: الأرشفة (حذف ناعم) + ISBN فريد + المستخدمون
  (db) => {
    db.exec(`
      ALTER TABLE books   ADD COLUMN archived_at TEXT;
      ALTER TABLE members ADD COLUMN archived_at TEXT;
    `)
    db.exec(`UPDATE books SET isbn = NULLIF(upper(replace(replace(trim(isbn),'-',''),' ','')),'') WHERE isbn IS NOT NULL`)
    db.exec(`
      UPDATE books SET isbn = isbn || '#dup' || id
      WHERE isbn IS NOT NULL
        AND id NOT IN (SELECT MIN(id) FROM books WHERE isbn IS NOT NULL GROUP BY isbn)
    `)
    db.exec(`CREATE UNIQUE INDEX idx_books_isbn ON books(isbn) WHERE isbn IS NOT NULL AND archived_at IS NULL`)
    db.exec(`
      CREATE TABLE users (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        role         TEXT NOT NULL CHECK (role IN ('admin','librarian')),
        pw_salt      TEXT NOT NULL,
        pw_hash      TEXT NOT NULL,
        active       INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL DEFAULT (date('now','localtime'))
      );
    `)
  },

  // 3: نسخ بباركود لكل نسخة + بطاقة العضو + الإعدادات
  //    العمود books.copies يصبح قديمًا (legacy) ولا يُستعمل بعد الآن.
  (db) => {
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE copies (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id    INTEGER NOT NULL REFERENCES books(id),
        barcode    TEXT NOT NULL UNIQUE,
        status     TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','damaged','lost')),
        created_at TEXT NOT NULL DEFAULT (date('now','localtime'))
      );
      CREATE INDEX idx_copies_book ON copies(book_id);
      ALTER TABLE loans   ADD COLUMN copy_id INTEGER REFERENCES copies(id);
      ALTER TABLE members ADD COLUMN card_no TEXT;
    `)
    const insCopy = db.prepare('INSERT INTO copies (book_id, barcode) VALUES (?, ?)')
    for (const b of db.prepare('SELECT id, copies FROM books').all())
      for (let n = 1; n <= b.copies; n++) insCopy.run(b.id, barcodeOf(b.id, n))

    // ربط الإعارات الجارية بنسخ فعلية (السجل القديم المُعاد يبقى بلا نسخة)
    const setCopy = db.prepare('UPDATE loans SET copy_id = ? WHERE id = ?')
    for (const { book_id } of db.prepare('SELECT DISTINCT book_id FROM loans WHERE return_date IS NULL').all()) {
      const loans = db.prepare('SELECT id FROM loans WHERE book_id = ? AND return_date IS NULL ORDER BY id').all(book_id)
      const copies = db.prepare('SELECT id FROM copies WHERE book_id = ? ORDER BY id').all(book_id)
      loans.forEach((l, i) => {
        let c = copies[i]
        if (!c) {
          // بيانات غير متسقة (إعارات أكثر من النسخ): ننشئ نسخة ناقصة بدل فقدان الإعارة
          const id = Number(insCopy.run(book_id, barcodeOf(book_id, copies.length + 1)).lastInsertRowid)
          c = { id }
          copies.push(c)
        }
        setCopy.run(c.id, l.id)
      })
    }
    db.exec(`UPDATE members SET card_no = 'M' || printf('%05d', id)`)
    db.exec(`CREATE UNIQUE INDEX idx_members_card ON members(card_no) WHERE card_no IS NOT NULL`)
  },

  // 4: تتبّع طباعة الملصقات + التمديد + الغرامات + الحجوزات
  (db) => {
    db.exec(`
      ALTER TABLE copies ADD COLUMN label_printed_at TEXT;
      ALTER TABLE loans  ADD COLUMN renewals INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE fines (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id  INTEGER NOT NULL REFERENCES members(id),
        loan_id    INTEGER REFERENCES loans(id),
        amount     INTEGER NOT NULL CHECK (amount > 0),
        reason     TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (date('now','localtime')),
        paid_at    TEXT,
        waived_at  TEXT
      );
      CREATE INDEX idx_fines_member ON fines(member_id);
      CREATE TABLE reservations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id    INTEGER NOT NULL REFERENCES books(id),
        member_id  INTEGER NOT NULL REFERENCES members(id),
        status     TEXT NOT NULL DEFAULT 'waiting'
                   CHECK (status IN ('waiting','ready','fulfilled','cancelled','expired')),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        ready_at   TEXT,
        expires_at TEXT
      );
      CREATE INDEX idx_res_book   ON reservations(book_id, status);
      CREATE INDEX idx_res_member ON reservations(member_id, status);
    `)
  },

  // 5: سجل العمليات. للإلحاق فقط: المشغّلات تمنع التعديل والحذف من أي شيفرة في التطبيق.
  (db) => {
    db.exec(`
      CREATE TABLE audit_log (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        user_id  INTEGER,
        username TEXT,
        action   TEXT NOT NULL,
        summary  TEXT NOT NULL
      );
      CREATE INDEX idx_audit_user ON audit_log(username);
      CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'سجل العمليات للقراءة فقط'); END;
      CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'سجل العمليات للقراءة فقط'); END;
    `)
  },
]
const SCHEMA_VERSION = MIGRATIONS.length

/* ---------- أدوات مساعدة ---------- */
const clean = (v) => (typeof v === 'string' ? v.trim() : v)
const escLike = (s) => s.replace(/[\\%_]/g, '\\$&')

function paging(page, pageSize) {
  const limit = Math.min(Math.max(parseInt(pageSize) || 25, 1), 200)
  const p = Math.max(parseInt(page) || 1, 1)
  return { limit, offset: (p - 1) * limit }
}

/* معاملات البحث الموحّدة */
function P(search) {
  const raw = String(search ?? '').trim()
  return {
    s: raw,
    like: `%${escLike(arnorm(raw))}%`,
    likeCode: `%${escLike(raw.toUpperCase())}%`,
    likeIsbn: `%${escLike(raw.replace(/[\s-]/g, '').toUpperCase())}%`,
    code: raw.toUpperCase(),
  }
}

function normIsbn(s) {
  const v = clean(s)
  return v ? String(v).replace(/[\s-]/g, '').toUpperCase() : null
}

/* التحقق من المجموع الاختباري لـ ISBN-10 و ISBN-13 */
function isbnValid(s) {
  if (/^\d{13}$/.test(s)) {
    let sum = 0
    for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1)
    return (10 - (sum % 10)) % 10 === Number(s[12])
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0
    for (let i = 0; i < 9; i++) sum += Number(s[i]) * (10 - i)
    sum += s[9] === 'X' ? 10 : Number(s[9])
    return sum % 11 === 0
  }
  return false
}

function hashPw(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }
}
function checkPw(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, 64)
  const b = Buffer.from(hash, 'hex')
  return b.length === h.length && crypto.timingSafeEqual(h, b)
}
const DUMMY = hashPw('dummy-password')

/* رمز الاسترداد: 20 حرفًا من أبجدية بلا حروف ملتبسة (0/O/1/I)، بإنتروبيا 100 بت */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 حرفًا = 5 بتات لكل حرف
const normCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
function genRecoveryCode() {
  const chars = [...crypto.randomBytes(20)].map((b) => RECOVERY_ALPHABET[b & 31])
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-')
}

function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw err(tr("كلمة المرور يجب ألا تقل عن 8 أحرف"))
}

/* ---------- تنظيف وفحص المدخلات (مشترك بين الحفظ والاستيراد) ---------- */
function cleanBook(b, storedIsbn) {
  const title = clean(b.title)
  const author = clean(b.author)
  if (!title) throw err(tr("عنوان الكتاب مطلوب"))
  if (!author) throw err(tr("اسم المؤلف مطلوب"))
  const copies = b.copies === '' || b.copies == null ? 1 : Number(b.copies)
  if (!Number.isInteger(copies) || copies < 0 || copies > 1000) throw err(tr("عدد النسخ يجب أن يكون عددًا صحيحًا بين 0 و1000"))
  const year = b.year === '' || b.year == null ? null : Number(b.year)
  if (year !== null && (!Number.isInteger(year) || year < 0 || year > 3000)) throw err(tr("سنة النشر غير صالحة"))
  const isbn = normIsbn(b.isbn)
  // لا نعيد فحص ISBN القديم إذا لم يُعدَّل (قد يكون من بيانات سابقة غير قياسية)
  if (isbn && isbn !== storedIsbn && !isbnValid(isbn)) throw err(tr("رقم ISBN غير صالح. تحقق من الأرقام (10 أو 13 خانة)."), 'BAD_ISBN')
  return { title, author, isbn, year, copies, category: clean(b.category) || null, shelf: clean(b.shelf) || null }
}

function cleanMember(m) {
  const name = clean(m.name)
  if (!name) throw err(tr("اسم العضو مطلوب"))
  const email = clean(m.email) || null
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw err(tr("البريد الإلكتروني غير صالح"))
  return {
    name,
    email,
    phone: clean(m.phone) || null,
    address: clean(m.address) || null,
    card_no: (clean(m.card_no) || '').toUpperCase() || null,
  }
}

/* ---------- استعلامات مشتركة ---------- */
const BOOK_SQL = `
SELECT b.id, b.title, b.author, b.isbn, b.category, b.year, b.shelf, b.created_at, b.archived_at,
       (SELECT COUNT(*) FROM copies c WHERE c.book_id = b.id AND c.status != 'lost') AS copies,
       MAX(0,
         (SELECT COUNT(*) FROM copies c
           WHERE c.book_id = b.id AND c.status = 'ok'
             AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.return_date IS NULL))
         - (SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status = 'ready')) AS available,
       (SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status IN ('waiting','ready')) AS reservations
FROM books b`

const MEMBER_SQL = `
SELECT m.*,
       (SELECT COUNT(*) FROM loans l WHERE l.member_id = m.id AND l.return_date IS NULL) AS active_loans,
       (SELECT COALESCE(SUM(f.amount), 0) FROM fines f
         WHERE f.member_id = m.id AND f.paid_at IS NULL AND f.waived_at IS NULL) AS unpaid_fines
FROM members m`

const LOAN_SQL = `
SELECT l.id, l.book_id, l.member_id, l.copy_id, l.loan_date, l.due_date, l.return_date, l.renewals,
       b.title, b.author, m.name AS member_name, m.card_no, m.phone AS member_phone, c.barcode,
       CASE WHEN l.return_date IS NOT NULL THEN 'returned'
            WHEN l.due_date < date('now','localtime') THEN 'overdue'
            ELSE 'active' END AS status,
       CASE WHEN l.return_date IS NULL AND l.due_date < date('now','localtime')
            THEN CAST(julianday(date('now','localtime')) - julianday(l.due_date) AS INTEGER)
            ELSE 0 END AS days_late
FROM loans l
JOIN books b   ON b.id = l.book_id
JOIN members m ON m.id = l.member_id
LEFT JOIN copies c ON c.id = l.copy_id`

const RES_SQL = `
SELECT r.id, r.book_id, r.member_id, r.status, r.created_at, r.ready_at, r.expires_at,
       b.title, m.name AS member_name, m.card_no, m.phone, m.email,
       (SELECT COUNT(*) FROM reservations r2
         WHERE r2.book_id = r.book_id AND r2.status IN ('waiting','ready') AND r2.id <= r.id) AS position
FROM reservations r
JOIN books b   ON b.id = r.book_id
JOIN members m ON m.id = r.member_id`

const BOOK_SEARCH = `
(@s = '' OR arnorm(bk.title) LIKE @like ESCAPE '\\' OR arnorm(bk.author) LIKE @like ESCAPE '\\'
 OR arnorm(bk.category) LIKE @like ESCAPE '\\' OR arnorm(bk.shelf) LIKE @like ESCAPE '\\'
 OR bk.isbn LIKE @likeIsbn ESCAPE '\\'
 OR EXISTS (SELECT 1 FROM copies c WHERE c.book_id = bk.id AND upper(c.barcode) LIKE @likeCode ESCAPE '\\'))`

const MEMBER_SEARCH = `
(@s = '' OR arnorm(mm.name) LIKE @like ESCAPE '\\' OR mm.phone LIKE @like ESCAPE '\\'
 OR arnorm(mm.email) LIKE @like ESCAPE '\\' OR upper(COALESCE(mm.card_no,'')) LIKE @likeCode ESCAPE '\\')`

const ARCHIVED = (a) => `((@archived = 1 AND ${a}.archived_at IS NOT NULL) OR (@archived = 0 AND ${a}.archived_at IS NULL))`

const LOAN_FILTER = `
(@status = 'all' OR status = @status OR (@status = 'open' AND status != 'returned'))
AND (@s = '' OR arnorm(title) LIKE @like ESCAPE '\\' OR arnorm(member_name) LIKE @like ESCAPE '\\'
     OR arnorm(author) LIKE @like ESCAPE '\\' OR upper(COALESCE(barcode,'')) LIKE @likeCode ESCAPE '\\'
     OR upper(COALESCE(card_no,'')) LIKE @likeCode ESCAPE '\\')`

/**
 * @param {string} file مسار ملف القاعدة
 * @param {{onBeforeMigrate?: (fromVersion:number, rawDb:any)=>void}} opts
 */
function createDb(file, opts = {}) {
  const db = new Database(file)

  // نفحص الإصدار أولًا، قبل أي تعديل في الملف (وضع السجل يغيّر ترويسته)
  const current = db.pragma('user_version', { simple: true })
  if (current > SCHEMA_VERSION) {
    db.close()
    throw err(tr("قاعدة البيانات أحدث من هذه النسخة من التطبيق. حدّث التطبيق أولًا."))
  }
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.function('arnorm', { deterministic: true }, arnorm)
  if (current < SCHEMA_VERSION) {
    const hasData = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='books'").get()
    if (hasData && opts.onBeforeMigrate) opts.onBeforeMigrate(current, db)
    for (let v = current; v < SCHEMA_VERSION; v++) {
      db.transaction(() => {
        MIGRATIONS[v](db)
        db.pragma(`user_version = ${v + 1}`)
      })()
    }
  }

  const activeLoansOf = (col, id) =>
    db.prepare(`SELECT COUNT(*) c FROM loans WHERE ${col} = ? AND return_date IS NULL`).get(id).c

  /* ---------- الإعدادات ---------- */
  function getSettings() {
    const out = { ...SETTINGS_DEFAULTS }
    const stored = new Set()
    for (const r of db.prepare('SELECT key, value FROM settings').all())
      if (r.key in out) {
        stored.add(r.key)
        out[r.key] = typeof SETTINGS_DEFAULTS[r.key] === 'number' ? Number(r.value) : r.value
      }
    // القيم النصية غير المخصّصة تظهر بلغة المكتبة الحالية
    for (const k of ['library_name', 'currency']) if (!stored.has(k)) out[k] = tr(SETTINGS_DEFAULTS[k])
    return out
  }

  /* ---------- نسخ الكتب ---------- */
  function addCopyRow(bookId) {
    const n = db.prepare('SELECT COUNT(*) c FROM copies WHERE book_id = ?').get(bookId).c + 1
    const barcode = barcodeOf(bookId, n)
    const id = Number(db.prepare('INSERT INTO copies (book_id, barcode) VALUES (?, ?)').run(bookId, barcode).lastInsertRowid)
    return { id, barcode }
  }

  function createBook(row) {
    return db.transaction(() => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO books (title, author, isbn, category, year, copies, shelf)
             VALUES (@title, @author, @isbn, @category, @year, 0, @shelf)`
          )
          .run(row).lastInsertRowid
      )
      for (let i = 0; i < row.copies; i++) addCopyRow(id)
      return id
    })()
  }

  const findByIsbn = (isbn) =>
    db.prepare('SELECT id, title, author FROM books WHERE isbn = ? AND archived_at IS NULL').get(isbn)

  function createMember(row) {
    return db.transaction(() => {
      const id = Number(
        db
          .prepare('INSERT INTO members (name, phone, email, address, card_no) VALUES (@name, @phone, @email, @address, @card_no)')
          .run(row).lastInsertRowid
      )
      if (!row.card_no) db.prepare('UPDATE members SET card_no = ? WHERE id = ?').run(cardOf(id), id)
      return id
    })()
  }

  function queryLoans({ status = 'all', search = '', page = 1, pageSize = 25, limit, offset } = {}) {
    const pg = paging(page, pageSize)
    const st = ['all', 'active', 'overdue', 'returned', 'open'].includes(status) ? status : 'all'
    const p = { ...P(search), status: st }
    const total = db.prepare(`SELECT COUNT(*) c FROM (${LOAN_SQL}) WHERE ${LOAN_FILTER}`).get(p).c
    const rows = db
      .prepare(
        `SELECT * FROM (${LOAN_SQL}) WHERE ${LOAN_FILTER}
         ORDER BY CASE status WHEN 'overdue' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, id DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...p, limit: limit ?? pg.limit, offset: offset ?? pg.offset })
    return { rows, total }
  }

  /* ---------- الحجوزات: الترقية من «انتظار» إلى «جاهز» ---------- */
  const freeCopies = (bookId) =>
    db.prepare(
      `SELECT COUNT(*) c FROM copies c WHERE c.book_id = ? AND c.status = 'ok'
         AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.return_date IS NULL)`
    ).get(bookId).c
  const readyCount = (bookId) =>
    db.prepare("SELECT COUNT(*) c FROM reservations WHERE book_id = ? AND status = 'ready'").get(bookId).c

  /** يعيد ضبط الحجوزات الجاهزة (إن نقصت النسخ) ثم يرقّي أقدم المنتظرين. يعيد معرّفات من أصبحوا جاهزين. */
  function promote(bookId) {
    const s = getSettings()
    // إن قلّت النسخ الحرة عن الحجوزات الجاهزة (نسخة تلفت مثلًا) يعود أحدثها لقائمة الانتظار
    while (readyCount(bookId) > freeCopies(bookId)) {
      const last = db.prepare("SELECT id FROM reservations WHERE book_id = ? AND status = 'ready' ORDER BY id DESC LIMIT 1").get(bookId)
      db.prepare("UPDATE reservations SET status = 'waiting', ready_at = NULL, expires_at = NULL WHERE id = ?").run(last.id)
    }
    const made = []
    while (freeCopies(bookId) - readyCount(bookId) > 0) {
      const next = db
        .prepare(
          `SELECT r.id FROM reservations r JOIN members m ON m.id = r.member_id
           WHERE r.book_id = ? AND r.status = 'waiting' AND m.archived_at IS NULL ORDER BY r.id LIMIT 1`
        )
        .get(bookId)
      if (!next) break
      db.prepare(
        "UPDATE reservations SET status = 'ready', ready_at = datetime('now','localtime'), expires_at = date('now','localtime', ?) WHERE id = ?"
      ).run(`+${s.hold_days} days`, next.id)
      made.push(next.id)
    }
    return made
  }

  /** تنتهي الحجوزات الجاهزة التي فات موعد استلامها، وتنتقل النسخة للتالي في الطابور */
  function housekeeping() {
    const books = db
      .prepare("SELECT DISTINCT book_id FROM reservations WHERE status = 'ready' AND expires_at < date('now','localtime')")
      .all()
    if (!books.length) return
    db.prepare("UPDATE reservations SET status = 'expired' WHERE status = 'ready' AND expires_at < date('now','localtime')").run()
    for (const { book_id } of books) promote(book_id)
  }

  const unpaidOf = (memberId) =>
    db.prepare('SELECT COALESCE(SUM(amount),0) s FROM fines WHERE member_id = ? AND paid_at IS NULL AND waived_at IS NULL').get(memberId).s

  const api = {
    raw: db,

    /* ================= الإعدادات ================= */
    getSettings,
    saveSettings(input) {
      const p = { ...getSettings(), ...input }
      const name = clean(p.library_name)
      const cur = clean(p.currency)
      const int = (v, lo, hi, msg) => {
        const n = Number(v)
        if (!Number.isInteger(n) || n < lo || n > hi) throw err(msg)
        return n
      }
      if (!name || name.length > 60) throw err(tr("اسم المكتبة مطلوب (حتى 60 حرفًا)"))
      if (!cur || cur.length > 10) throw err(tr("رمز العملة مطلوب (حتى 10 أحرف)"))
      const clean_ = {
        library_name: name,
        currency: cur,
        default_loan_days: int(p.default_loan_days, 1, 120, tr("المدة الافتراضية بين 1 و120 يومًا")),
        max_loans: int(p.max_loans, 1, 50, tr("الحد الأقصى للكتب بين 1 و50")),
        max_renewals: int(p.max_renewals, 0, 10, tr("عدد مرات التمديد بين 0 و10")),
        fine_per_day: int(p.fine_per_day, 0, 100000, tr("الغرامة اليومية بين 0 و100000")),
        fine_cap: int(p.fine_cap, 0, 1000000, tr("سقف الغرامة بين 0 و1000000")),
        fine_block_limit: int(p.fine_block_limit, 0, 1000000, tr("حد المنع بين 0 و1000000")),
        hold_days: int(p.hold_days, 1, 30, tr("مدة الاحتفاظ بالحجز بين 1 و30 يومًا")),
        language: p.language,
      }
      if (!LANGUAGES.includes(clean_.language)) throw err(tr("اللغة غير مدعومة"))
      const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      const isStored = (k) => !!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k)
      db.transaction(() => {
        for (const [k, v] of Object.entries(clean_)) {
          // قيمة افتراضية لم تُخصَّص: نتركها دون حفظ لتتبع لغة المكتبة
          if ((k === 'library_name' || k === 'currency') && !isStored(k) && v === tr(SETTINGS_DEFAULTS[k])) continue
          up.run(k, String(v))
        }
      })()
      return getSettings()
    },

    /* ================= الكتب ================= */
    listBooks({ search = '', page = 1, pageSize = 25, archived = false } = {}) {
      const { limit, offset } = paging(page, pageSize)
      const p = { ...P(search), archived: archived ? 1 : 0 }
      const where = `${ARCHIVED('bk')} AND ${BOOK_SEARCH}`
      const total = db.prepare(`SELECT COUNT(*) c FROM (${BOOK_SQL}) bk WHERE ${where}`).get(p).c
      const rows = db
        .prepare(`SELECT bk.* FROM (${BOOK_SQL}) bk WHERE ${where} ORDER BY bk.id DESC LIMIT @limit OFFSET @offset`)
        .all({ ...p, limit, offset })
      return { rows, total }
    },

    /* للقوائم القابلة للبحث. onlyAvailable=false في مكتب الإعارة ليظهر سبب الرفض. */
    searchBooks(arg) {
      const { q = '', onlyAvailable = true } = typeof arg === 'string' ? { q: arg } : arg || {}
      return db
        .prepare(
          `SELECT bk.*,
                  (SELECT c.barcode FROM copies c WHERE c.book_id = bk.id AND upper(c.barcode) = @code) AS matched_barcode
           FROM (${BOOK_SQL}) bk
           WHERE bk.archived_at IS NULL AND (@onlyAvail = 0 OR bk.available > 0) AND ${BOOK_SEARCH}
           ORDER BY (matched_barcode IS NULL), bk.title LIMIT 20`
        )
        .all({ ...P(q), onlyAvail: onlyAvailable ? 1 : 0 })
    },

    getBook(id) {
      housekeeping()
      const book = db.prepare(`SELECT * FROM (${BOOK_SQL}) WHERE id = ?`).get(id)
      if (!book) throw err(tr("الكتاب غير موجود"))
      const copies = db
        .prepare(
          `SELECT c.id, c.barcode, c.status, l.id AS loan_id, l.due_date, m.name AS member_name
           FROM copies c
           LEFT JOIN loans l   ON l.copy_id = c.id AND l.return_date IS NULL
           LEFT JOIN members m ON m.id = l.member_id
           WHERE c.book_id = ? ORDER BY c.id`
        )
        .all(id)
      const history = db.prepare(`SELECT * FROM (${LOAN_SQL}) WHERE book_id = ? ORDER BY id DESC LIMIT 30`).all(id)
      return { book, copies, history, reservations: api.reservationsFor({ book_id: id }) }
    },

    saveBook(b) {
      const stored = b.id ? db.prepare('SELECT isbn FROM books WHERE id = ?').get(b.id) : null
      const row = cleanBook(b, stored?.isbn)
      if (row.isbn) {
        const dup = db
          .prepare('SELECT id, title, author FROM books WHERE isbn = ? AND archived_at IS NULL AND id IS NOT ?')
          .get(row.isbn, b.id ?? null)
        if (dup) {
          dup.copies = db.prepare("SELECT COUNT(*) c FROM copies WHERE book_id = ? AND status != 'lost'").get(dup.id).c
          throw err(tr("هذا الكتاب مسجَّل بالفعل (ISBN مكرر)."), 'DUP_ISBN', dup)
        }
      }
      try {
        if (b.id) {
          // عدد النسخ لا يُعدَّل من النموذج: تُدار النسخ من صفحة الكتاب
          db.prepare(
            `UPDATE books SET title=@title, author=@author, isbn=@isbn, category=@category,
                              year=@year, shelf=@shelf WHERE id=@id`
          ).run({ ...row, id: b.id })
          return b.id
        }
        return createBook(row)
      } catch (e) {
        if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw err(tr("رقم ISBN مستعمل في كتاب آخر"), 'DUP_ISBN_RACE')
        throw e
      }
    },

    addCopy(id) {
      const b = db.prepare('SELECT id, title FROM books WHERE id = ? AND archived_at IS NULL').get(id)
      if (!b) throw err(tr("الكتاب غير موجود"))
      const { barcode } = addCopyRow(id)
      promote(id)
      const copies = db.prepare("SELECT COUNT(*) c FROM copies WHERE book_id = ? AND status != 'lost'").get(id).c
      return { id, title: b.title, copies, barcode }
    },

    setCopyStatus({ id, status }) {
      if (!COPY_STATUSES.includes(status)) throw err(tr("حالة النسخة غير صالحة"))
      const c = db.prepare('SELECT id, book_id FROM copies WHERE id = ?').get(id)
      if (!c) throw err(tr("النسخة غير موجودة"))
      if (db.prepare('SELECT 1 FROM loans WHERE copy_id = ? AND return_date IS NULL').get(id))
        throw err(tr("هذه النسخة معارة حاليًا. أرجعها أولًا ثم غيّر حالتها."))
      db.prepare('UPDATE copies SET status = ? WHERE id = ?').run(status, id)
      promote(c.book_id)
      return true
    },

    archiveBook(id) {
      if (activeLoansOf('book_id', id) > 0) throw err(tr("لا يمكن أرشفة كتاب لديه نسخ معارة حاليًا"))
      db.prepare("UPDATE reservations SET status = 'cancelled' WHERE book_id = ? AND status IN ('waiting','ready')").run(id)
      db.prepare("UPDATE books SET archived_at = datetime('now','localtime') WHERE id = ? AND archived_at IS NULL").run(id)
      return true
    },

    restoreBook(id) {
      try {
        db.prepare('UPDATE books SET archived_at = NULL WHERE id = ?').run(id)
      } catch (e) {
        if (String(e.code).startsWith('SQLITE_CONSTRAINT'))
          throw err(tr("تعذّر الاسترجاع: رقم ISBN مستعمل الآن في كتاب آخر نشط"))
        throw e
      }
      return true
    },

    /* ================= الأعضاء ================= */
    listMembers({ search = '', page = 1, pageSize = 25, archived = false } = {}) {
      const { limit, offset } = paging(page, pageSize)
      const p = { ...P(search), archived: archived ? 1 : 0 }
      const where = `${ARCHIVED('mm')} AND ${MEMBER_SEARCH}`
      const total = db.prepare(`SELECT COUNT(*) c FROM (${MEMBER_SQL}) mm WHERE ${where}`).get(p).c
      const rows = db
        .prepare(`SELECT mm.* FROM (${MEMBER_SQL}) mm WHERE ${where} ORDER BY mm.id DESC LIMIT @limit OFFSET @offset`)
        .all({ ...p, limit, offset })
      return { rows, total }
    },

    searchMembers(search = '') {
      return db
        .prepare(
          `SELECT mm.* FROM (${MEMBER_SQL}) mm
           WHERE mm.archived_at IS NULL AND ${MEMBER_SEARCH}
           ORDER BY (upper(COALESCE(mm.card_no,'')) = @code) DESC, mm.name LIMIT 20`
        )
        .all(P(search))
    },

    getMember(id) {
      housekeeping()
      const member = db.prepare(`SELECT * FROM (${MEMBER_SQL}) WHERE id = ?`).get(id)
      if (!member) throw err(tr("العضو غير موجود"))
      const open = db.prepare(`SELECT * FROM (${LOAN_SQL}) WHERE member_id = ? AND status != 'returned' ORDER BY due_date`).all(id)
      const history = db.prepare(`SELECT * FROM (${LOAN_SQL}) WHERE member_id = ? AND status = 'returned' ORDER BY id DESC LIMIT 30`).all(id)
      const total = db.prepare('SELECT COUNT(*) c FROM loans WHERE member_id = ?').get(id).c
      return {
        member, open, history, total,
        fines: api.listFines({ member_id: id, status: 'unpaid', pageSize: 100 }).rows,
        reservations: api.reservationsFor({ member_id: id }),
      }
    },

    saveMember(m) {
      const row = cleanMember(m)
      if (row.card_no) {
        const clash = db.prepare('SELECT 1 FROM members WHERE upper(card_no) = ? AND id IS NOT ?').get(row.card_no, m.id ?? null)
        if (clash) throw err(tr("رقم البطاقة مستعمل لعضو آخر"))
      }
      if (m.id) {
        db.prepare(
          `UPDATE members SET name=@name, phone=@phone, email=@email, address=@address,
                              card_no = COALESCE(@card_no, card_no) WHERE id=@id`
        ).run({ ...row, id: m.id })
        return m.id
      }
      return createMember(row)
    },

    archiveMember(id) {
      if (activeLoansOf('member_id', id) > 0) throw err(tr("لا يمكن أرشفة عضو لديه كتب لم يُرجعها بعد"))
      const heldBooks = db.prepare("SELECT DISTINCT book_id FROM reservations WHERE member_id = ? AND status IN ('waiting','ready')").all(id)
      db.prepare("UPDATE reservations SET status = 'cancelled' WHERE member_id = ? AND status IN ('waiting','ready')").run(id)
      for (const { book_id } of heldBooks) promote(book_id)
      db.prepare("UPDATE members SET archived_at = datetime('now','localtime') WHERE id = ? AND archived_at IS NULL").run(id)
      return true
    },

    restoreMember(id) {
      db.prepare('UPDATE members SET archived_at = NULL WHERE id = ?').run(id)
      return true
    },

    /* بحث شامل لشريط الأوامر */
    searchAll(q) {
      const p = { ...P(q), archived: 0 }
      return {
        books: db
          .prepare(`SELECT bk.id, bk.title, bk.author, bk.available, bk.copies FROM (${BOOK_SQL}) bk WHERE ${ARCHIVED('bk')} AND ${BOOK_SEARCH} ORDER BY bk.title LIMIT 6`)
          .all(p),
        members: db
          .prepare(`SELECT mm.id, mm.name, mm.card_no, mm.active_loans FROM (${MEMBER_SQL}) mm WHERE ${ARCHIVED('mm')} AND ${MEMBER_SEARCH} ORDER BY mm.name LIMIT 6`)
          .all(p),
      }
    },

    /* ================= الإعارات ================= */
    listLoans(params) {
      return queryLoans(params)
    },

    searchOpenLoans(q) {
      return queryLoans({ status: 'open', search: q, limit: 20, offset: 0 }).rows
    },

    borrow({ book_id, member_id, days, barcode }) {
      housekeeping()
      const s = getSettings()
      const d = Number(days ?? s.default_loan_days)
      if (!member_id || (!book_id && !barcode)) throw err(tr("اختر الكتاب والعضو"))
      if (!Number.isInteger(d) || d < 1 || d > 120) throw err(tr("مدة الإعارة يجب أن تكون بين 1 و120 يومًا"))
      const copyFree = `NOT EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.return_date IS NULL)`

      return db.transaction(() => {
        let copy
        let book
        if (barcode) {
          copy = db
            .prepare('SELECT c.id, c.barcode, c.status, c.book_id FROM copies c WHERE upper(c.barcode) = upper(?)')
            .get(String(barcode).trim())
          if (!copy) throw err(tr("الباركود «{0}» غير معروف", [barcode]))
          book = db.prepare(`SELECT * FROM (${BOOK_SQL}) WHERE id = ?`).get(copy.book_id)
          if (book.archived_at) throw err(tr("الكتاب مؤرشف"))
          if (copy.status !== 'ok') throw err(copy.status === 'lost' ? tr("هذه النسخة ({0}) مفقودة ولا تُعار", [copy.barcode]) : tr("هذه النسخة ({0}) تالفة ولا تُعار", [copy.barcode]))
          if (db.prepare('SELECT 1 FROM loans WHERE copy_id = ? AND return_date IS NULL').get(copy.id))
            throw err(tr("هذه النسخة ({0}) معارة حاليًا", [copy.barcode]))
        } else {
          book = db.prepare(`SELECT * FROM (${BOOK_SQL}) WHERE id = ?`).get(book_id)
          if (!book || book.archived_at) throw err(tr("الكتاب غير موجود أو مؤرشف"))
          copy = db
            .prepare(`SELECT c.id, c.barcode FROM copies c WHERE c.book_id = ? AND c.status = 'ok' AND ${copyFree} ORDER BY c.id LIMIT 1`)
            .get(book.id)
          if (!copy) throw err(tr("لا توجد نسخة متاحة من «{0}»", [book.title]))
        }
        const member = db.prepare('SELECT name, archived_at FROM members WHERE id = ?').get(member_id)
        if (!member || member.archived_at) throw err(tr("العضو غير موجود أو مؤرشف"))

        // النسخ المحجوزة الجاهزة لا يأخذها إلا أصحاب الحجز
        const mine = db.prepare("SELECT id FROM reservations WHERE book_id = ? AND member_id = ? AND status = 'ready'").get(book.id, member_id)
        if (!mine && book.available <= 0) throw err(tr("لا توجد نسخة متاحة من «{0}» (محجوزة لأعضاء آخرين)", [book.title]))

        if (s.fine_block_limit > 0) {
          const unpaid = unpaidOf(member_id)
          if (unpaid >= s.fine_block_limit) throw err(tr("على العضو غرامات غير مسددة ({0} {1}). سدّدها أولًا.", [unpaid, s.currency]), 'FINES')
        }
        if (db.prepare('SELECT 1 FROM loans WHERE book_id=? AND member_id=? AND return_date IS NULL').get(book.id, member_id))
          throw err(tr("هذا العضو يستعير هذا الكتاب بالفعل"))
        if (activeLoansOf('member_id', member_id) >= s.max_loans)
          throw err(tr("بلغ العضو الحد الأقصى ({0} كتب). أرجع كتابًا أولًا.", [s.max_loans]))

        const id = Number(
          db
            .prepare(
              `INSERT INTO loans (book_id, member_id, copy_id, loan_date, due_date)
               VALUES (?, ?, ?, date('now','localtime'), date('now','localtime', ?))`
            )
            .run(book.id, member_id, copy.id, `+${d} days`).lastInsertRowid
        )
        db.prepare("UPDATE reservations SET status = 'fulfilled' WHERE book_id = ? AND member_id = ? AND status IN ('waiting','ready')").run(book.id, member_id)
        const due = db.prepare('SELECT due_date FROM loans WHERE id = ?').get(id).due_date
        return { id, title: book.title, member_name: member.name, barcode: copy.barcode, due_date: due }
      })()
    },

    returnLoan(id) {
      housekeeping()
      const s = getSettings()
      const info = db
        .prepare(`SELECT id, book_id, member_id, title, member_name, barcode, days_late FROM (${LOAN_SQL}) WHERE id = ? AND return_date IS NULL`)
        .get(id)
      if (!info) throw err(tr("هذه الإعارة مُسجَّلة كمُعادة من قبل"))
      return db.transaction(() => {
        db.prepare("UPDATE loans SET return_date = date('now','localtime') WHERE id = ?").run(id)
        let fine = 0
        if (s.fine_per_day > 0 && info.days_late > 0) {
          fine = info.days_late * s.fine_per_day
          if (s.fine_cap > 0) fine = Math.min(fine, s.fine_cap)
          db.prepare('INSERT INTO fines (member_id, loan_id, amount, reason) VALUES (?, ?, ?, ?)').run(
            info.member_id, id, fine, tr("تأخير {0} يومًا في إرجاع «{1}»", [info.days_late, info.title])
          )
        }
        const made = promote(info.book_id)
        const holdFor = made.length
          ? db.prepare('SELECT m.name FROM reservations r JOIN members m ON m.id = r.member_id WHERE r.id = ?').get(made[0]).name
          : null
        return { id, title: info.title, member_name: info.member_name, barcode: info.barcode, days_late: info.days_late, fine, holdFor }
      })()
    },

    renewLoan(id) {
      housekeeping()
      const s = getSettings()
      const l = db.prepare(`SELECT * FROM (${LOAN_SQL}) WHERE id = ?`).get(id)
      if (!l || l.return_date) throw err(tr("هذه الإعارة ليست مفتوحة"))
      if (l.status === 'overdue') throw err(tr("لا يمكن تمديد إعارة متأخرة. أرجع الكتاب أولًا."))
      if (l.renewals >= s.max_renewals)
        throw err(s.max_renewals === 0 ? tr("التمديد غير مفعّل في الإعدادات") : tr("بلغت الإعارة الحد الأقصى للتمديد ({0})", [s.max_renewals]))
      if (db.prepare("SELECT 1 FROM reservations WHERE book_id = ? AND member_id <> ? AND status IN ('waiting','ready')").get(l.book_id, l.member_id))
        throw err(tr("لا يمكن التمديد: يوجد حجز على هذا الكتاب من عضو آخر"))
      if (s.fine_block_limit > 0 && unpaidOf(l.member_id) >= s.fine_block_limit)
        throw err(tr("على العضو غرامات غير مسددة ({0} {1}). سدّدها أولًا.", [unpaidOf(l.member_id), s.currency]), 'FINES')
      db.prepare("UPDATE loans SET renewals = renewals + 1, due_date = date(max(due_date, date('now','localtime')), ?) WHERE id = ?").run(
        `+${s.default_loan_days} days`, id
      )
      const r = db.prepare('SELECT due_date, renewals FROM loans WHERE id = ?').get(id)
      return { id, title: l.title, due_date: r.due_date, renewals: r.renewals }
    },

    /* ================= الغرامات ================= */
    listFines({ member_id = null, status = 'unpaid', page = 1, pageSize = 25 } = {}) {
      const { limit, offset } = paging(page, pageSize)
      const st = ['unpaid', 'paid', 'waived', 'all'].includes(status) ? status : 'unpaid'
      const where = `(@member_id IS NULL OR f.member_id = @member_id) AND (
        @status = 'all'
        OR (@status = 'unpaid' AND f.paid_at IS NULL AND f.waived_at IS NULL)
        OR (@status = 'paid' AND f.paid_at IS NOT NULL)
        OR (@status = 'waived' AND f.waived_at IS NOT NULL))`
      const p = { member_id, status: st }
      const total = db.prepare(`SELECT COUNT(*) c FROM fines f WHERE ${where}`).get(p).c
      const rows = db
        .prepare(
          `SELECT f.id, f.member_id, f.loan_id, f.amount, f.reason, f.created_at, f.paid_at, f.waived_at, m.name AS member_name
           FROM fines f JOIN members m ON m.id = f.member_id
           WHERE ${where} ORDER BY f.id DESC LIMIT @limit OFFSET @offset`
        )
        .all({ ...p, limit, offset })
      const sum = db.prepare(`SELECT COALESCE(SUM(f.amount),0) s FROM fines f WHERE ${where}`).get(p).s
      return { rows, total, sum }
    },

    payFine(id) {
      const r = db.prepare("UPDATE fines SET paid_at = date('now','localtime') WHERE id = ? AND paid_at IS NULL AND waived_at IS NULL").run(id)
      if (r.changes === 0) throw err(tr("هذه الغرامة مسددة أو مُعفاة مسبقًا"))
      return true
    },

    payMemberFines(member_id) {
      const sum = unpaidOf(member_id)
      if (sum === 0) throw err(tr("لا توجد غرامات غير مسددة لهذا العضو"))
      db.prepare("UPDATE fines SET paid_at = date('now','localtime') WHERE member_id = ? AND paid_at IS NULL AND waived_at IS NULL").run(member_id)
      return { paid: sum }
    },

    waiveFine(id) {
      const r = db.prepare("UPDATE fines SET waived_at = date('now','localtime') WHERE id = ? AND paid_at IS NULL AND waived_at IS NULL").run(id)
      if (r.changes === 0) throw err(tr("هذه الغرامة مسددة أو مُعفاة مسبقًا"))
      return true
    },

    addFine({ member_id, amount, reason }) {
      const n = Number(amount)
      const why = clean(reason)
      if (!Number.isInteger(n) || n < 1 || n > 1000000) throw err(tr("المبلغ يجب أن يكون عددًا صحيحًا موجبًا"))
      if (!why || why.length > 120) throw err(tr("سبب الغرامة مطلوب (حتى 120 حرفًا)"))
      if (!db.prepare('SELECT 1 FROM members WHERE id = ?').get(member_id)) throw err(tr("العضو غير موجود"))
      return Number(db.prepare('INSERT INTO fines (member_id, amount, reason) VALUES (?, ?, ?)').run(member_id, n, why).lastInsertRowid)
    },

    /* ================= الحجوزات ================= */
    reserve({ book_id, member_id }) {
      housekeeping()
      const book = db.prepare(`SELECT * FROM (${BOOK_SQL}) WHERE id = ?`).get(book_id)
      if (!book || book.archived_at) throw err(tr("الكتاب غير موجود أو مؤرشف"))
      const member = db.prepare('SELECT archived_at FROM members WHERE id = ?').get(member_id)
      if (!member || member.archived_at) throw err(tr("العضو غير موجود أو مؤرشف"))
      if (book.copies === 0) throw err(tr("لا توجد نسخ صالحة للإعارة لهذا الكتاب"))
      if (db.prepare('SELECT 1 FROM loans WHERE book_id = ? AND member_id = ? AND return_date IS NULL').get(book_id, member_id))
        throw err(tr("هذا العضو يستعير هذا الكتاب حاليًا"))
      if (db.prepare("SELECT 1 FROM reservations WHERE book_id = ? AND member_id = ? AND status IN ('waiting','ready')").get(book_id, member_id))
        throw err(tr("لدى العضو حجز لهذا الكتاب بالفعل"))
      if (book.available > 0) throw err(tr("الكتاب متاح الآن. يمكن إعارته مباشرة دون حجز."))
      const id = Number(db.prepare('INSERT INTO reservations (book_id, member_id) VALUES (?, ?)').run(book_id, member_id).lastInsertRowid)
      return { id, position: db.prepare(`SELECT position FROM (${RES_SQL}) WHERE id = ?`).get(id).position }
    },

    cancelReservation(id) {
      const r = db.prepare("SELECT book_id, status FROM reservations WHERE id = ? AND status IN ('waiting','ready')").get(id)
      if (!r) throw err(tr("هذا الحجز لم يعد قائمًا"))
      db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(id)
      if (r.status === 'ready') promote(r.book_id)
      return true
    },

    reservationsFor({ book_id = null, member_id = null }) {
      housekeeping()
      return db
        .prepare(
          `SELECT * FROM (${RES_SQL}) WHERE status IN ('waiting','ready')
             AND (@book_id IS NULL OR book_id = @book_id) AND (@member_id IS NULL OR member_id = @member_id)
           ORDER BY id`
        )
        .all({ book_id, member_id })
    },

    readyReservations() {
      housekeeping()
      return db.prepare(`SELECT * FROM (${RES_SQL}) WHERE status = 'ready' ORDER BY expires_at, id LIMIT 50`).all()
    },

    /* ================= رسائل التذكير ================= */
    reminderText({ member_id, kind = 'overdue' }) {
      housekeeping()
      const s = getSettings()
      const m = db.prepare('SELECT id, name, phone, email FROM members WHERE id = ?').get(member_id)
      if (!m) throw err(tr("العضو غير موجود"))
      let body
      let subject
      if (kind === 'ready') {
        const rows = db.prepare(`SELECT title, expires_at FROM (${RES_SQL}) WHERE member_id = ? AND status = 'ready' ORDER BY id`).all(member_id)
        if (!rows.length) throw err(tr("لا توجد حجوزات جاهزة لهذا العضو"))
        const many = rows.length > 1
        subject = tr("حجزكم جاهز للاستلام — {0}", [s.library_name])
        // جمل كاملة للمفرد والجمع: المطابقة في الجنس والعدد تختلف بين اللغات فلا تُركَّب من أجزاء
        body =
          (many
            ? tr("السلام عليكم {0}،\n\nيسرّنا إبلاغكم أن الكتب التي حجزتموها أصبحت متاحة في {1}:\n", [m.name, s.library_name])
            : tr("السلام عليكم {0}،\n\nيسرّنا إبلاغكم أن الكتاب الذي حجزتموه أصبح متاحًا في {1}:\n", [m.name, s.library_name])) +
          rows.map((r) => tr("• «{0}» (نحتفظ به لكم حتى {1})", [r.title, r.expires_at])).join('\n') +
          (many
            ? tr("\n\nنرجو المرور لاستلامها قبل انتهاء المهلة.\n\n{0}", [s.library_name])
            : tr("\n\nنرجو المرور لاستلامه قبل انتهاء المهلة.\n\n{0}", [s.library_name]))
      } else {
        const rows = db.prepare(`SELECT title, due_date, days_late FROM (${LOAN_SQL}) WHERE member_id = ? AND status = 'overdue' ORDER BY due_date`).all(member_id)
        if (!rows.length) throw err(tr("لا توجد كتب متأخرة لدى هذا العضو"))
        const unpaid = unpaidOf(member_id)
        const many = rows.length > 1
        subject = tr("تذكير بإرجاع الكتب — {0}", [s.library_name])
        body =
          (many
            ? tr("السلام عليكم {0}،\n\nنذكّركم بأن الكتب التالية تجاوزت موعد الإرجاع في {1}:\n", [m.name, s.library_name])
            : tr("السلام عليكم {0}،\n\nنذكّركم بأن الكتاب التالي تجاوز موعد الإرجاع في {1}:\n", [m.name, s.library_name])) +
          rows.map((r) => tr("• «{0}» (موعد الإرجاع {1}، متأخر {2} يومًا)", [r.title, r.due_date, r.days_late])).join('\n') +
          (unpaid > 0 ? tr("\n\nالغرامة المستحقة حاليًا: {0} {1}.", [unpaid, s.currency]) : '') +
          (many
            ? tr("\n\nنرجو إعادتها في أقرب وقت. شكرًا لتعاونكم.\n\n{0}", [s.library_name])
            : tr("\n\nنرجو إعادته في أقرب وقت. شكرًا لتعاونكم.\n\n{0}", [s.library_name]))
      }
      return { member: m, subject, text: body }
    },

    /* ================= الطباعة ================= */
    labelsPending() {
      return db
        .prepare(
          `SELECT c.id, c.barcode, b.title, b.author, b.shelf FROM copies c JOIN books b ON b.id = c.book_id
           WHERE c.label_printed_at IS NULL AND c.status != 'lost' AND b.archived_at IS NULL ORDER BY c.id LIMIT 5000`
        )
        .all()
    },

    labelsForBook(id) {
      return db
        .prepare(
          `SELECT c.id, c.barcode, b.title, b.author, b.shelf FROM copies c JOIN books b ON b.id = c.book_id
           WHERE c.book_id = ? AND c.status != 'lost' ORDER BY c.id`
        )
        .all(id)
    },

    markLabelsPrinted(ids) {
      if (!Array.isArray(ids) || ids.some((i) => !Number.isInteger(i))) throw err(tr("معرّفات غير صالحة"))
      const up = db.prepare("UPDATE copies SET label_printed_at = date('now','localtime') WHERE id = ?")
      db.transaction(() => ids.forEach((i) => up.run(i)))()
      return ids.length
    },

    cardsFor(ids) {
      if (Array.isArray(ids)) {
        const get = db.prepare('SELECT id, name, card_no FROM members WHERE id = ? AND archived_at IS NULL')
        return ids.map((i) => get.get(i)).filter(Boolean)
      }
      return db.prepare('SELECT id, name, card_no FROM members WHERE archived_at IS NULL ORDER BY name').all()
    },

    allOverdue() {
      return db.prepare(`SELECT * FROM (${LOAN_SQL}) WHERE status = 'overdue' ORDER BY days_late DESC, member_name`).all()
    },

    /* ================= الإحصائيات ================= */
    stats() {
      housekeeping()
      const one = (sql) => db.prepare(sql).get()
      const t = one(`SELECT COUNT(*) c, COALESCE(SUM(copies),0) s, COALESCE(SUM(available),0) a FROM (${BOOK_SQL}) WHERE archived_at IS NULL`)
      const members = one('SELECT COUNT(*) c FROM members WHERE archived_at IS NULL').c
      const active = one('SELECT COUNT(*) c FROM loans WHERE return_date IS NULL').c
      const overdue = one("SELECT COUNT(*) c FROM loans WHERE return_date IS NULL AND due_date < date('now','localtime')").c
      const categories = db
        .prepare(
          `SELECT COALESCE(NULLIF(category,''),'غير مصنّف') AS name, COUNT(*) AS count
           FROM books WHERE archived_at IS NULL GROUP BY name ORDER BY count DESC LIMIT 10`
        )
        .all()
      return {
        titles: t.c,
        copies: t.s,
        available: t.a,
        members,
        active,
        overdue,
        categories,
        unpaidFines: one('SELECT COALESCE(SUM(amount),0) s FROM fines WHERE paid_at IS NULL AND waived_at IS NULL').s,
        readyList: api.readyReservations().slice(0, 5),
        overdueList: queryLoans({ status: 'overdue', limit: 5, offset: 0 }).rows,
        recent: queryLoans({ limit: 6, offset: 0 }).rows,
      }
    },

    /* ================= التقارير ================= */
    reports({ days = 90 } = {}) {
      housekeeping()
      const all = days === null || days === 'all'
      const d = all ? null : Math.min(Math.max(parseInt(days) || 90, 1), 3650)
      const one = (sql, p = {}) => db.prepare(sql).get(p)
      const today = one("SELECT date('now','localtime') d").d
      const from = all ? '0000-00-00' : one("SELECT date('now','localtime', ?) d", [`-${d} days`]).d
      const p = { from, all: all ? 1 : 0 }

      const loans = one('SELECT COUNT(*) c FROM loans WHERE loan_date >= @from', p).c
      const ret = one('SELECT COUNT(*) c FROM loans WHERE return_date IS NOT NULL AND return_date >= @from', p).c
      const late = one('SELECT COUNT(*) c FROM loans WHERE return_date IS NOT NULL AND return_date >= @from AND return_date > due_date', p).c
      const avg = one(
        'SELECT AVG(julianday(return_date) - julianday(loan_date)) a FROM loans WHERE return_date IS NOT NULL AND return_date >= @from', p
      ).a
      const sumFines = (col) =>
        one(`SELECT COALESCE(SUM(amount),0) s FROM fines WHERE ${col} IS NOT NULL AND ${col} >= @from`, p).s

      // آخر 12 شهرًا (مع الأشهر الصفرية) بصرف النظر عن الفترة المختارة
      const [y0, m0] = today.split('-').map(Number)
      const months = []
      for (let i = 11; i >= 0; i--) {
        const t = y0 * 12 + (m0 - 1) - i
        months.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`)
      }
      const counts = Object.fromEntries(
        db.prepare("SELECT strftime('%Y-%m', loan_date) m, COUNT(*) n FROM loans WHERE loan_date >= @start GROUP BY m").all({ start: `${months[0]}-01` })
          .map((r) => [r.m, r.n])
      )

      const idleWhere = `b.archived_at IS NULL AND (@all = 1 OR b.created_at < @from)
        AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.id AND l.loan_date >= @from)`
      return {
        days: d,
        summary: {
          loans,
          returns: ret,
          avgLoanDays: avg == null ? 0 : Math.round(avg * 10) / 10,
          lateRate: ret ? Math.round((late / ret) * 100) : 0,
          overdueNow: one("SELECT COUNT(*) c FROM loans WHERE return_date IS NULL AND due_date < date('now','localtime')").c,
          finesCharged: sumFines('created_at'),
          finesCollected: sumFines('paid_at'),
          finesWaived: sumFines('waived_at'),
        },
        monthly: months.map((m) => ({ month: m, n: counts[m] || 0 })),
        topBooks: db
          .prepare(
            `SELECT b.id, b.title, b.author, COUNT(*) n FROM loans l JOIN books b ON b.id = l.book_id
             WHERE l.loan_date >= @from GROUP BY b.id ORDER BY n DESC, b.title LIMIT 10`
          )
          .all(p),
        topMembers: db
          .prepare(
            `SELECT m.id, m.name, COUNT(*) n FROM loans l JOIN members m ON m.id = l.member_id
             WHERE l.loan_date >= @from GROUP BY m.id ORDER BY n DESC, m.name LIMIT 10`
          )
          .all(p),
        byCategory: db
          .prepare(
            `SELECT COALESCE(NULLIF(b.category,''),'غير مصنّف') name, COUNT(*) n FROM loans l JOIN books b ON b.id = l.book_id
             WHERE l.loan_date >= @from GROUP BY name ORDER BY n DESC, name LIMIT 8`
          )
          .all(p),
        idle: {
          count: one(`SELECT COUNT(*) c FROM books b WHERE ${idleWhere}`, p).c,
          sample: db.prepare(`SELECT b.id, b.title, b.author FROM books b WHERE ${idleWhere} ORDER BY b.created_at, b.title LIMIT 8`).all(p),
        },
      }
    },

    /* ================= وضع القارئ ================= */
    /* لا يعيد أي بيانات شخصية: عنوان ومؤلف وتصنيف ورفّ وتوفر فقط */
    kioskSearch(q) {
      if (arnorm(q).length < 2) return []
      return db
        .prepare(
          `SELECT bk.id, bk.title, bk.author, bk.category, bk.shelf, bk.year, bk.available, bk.copies
           FROM (${BOOK_SQL}) bk WHERE bk.archived_at IS NULL AND ${BOOK_SEARCH} ORDER BY bk.title LIMIT 30`
        )
        .all(P(q))
    },

    /* ================= الاستيراد والتصدير ================= */
    allBooks: () => db.prepare(`SELECT * FROM (${BOOK_SQL}) WHERE archived_at IS NULL ORDER BY id`).all(),
    allMembers: () => db.prepare(`SELECT * FROM (${MEMBER_SQL}) WHERE archived_at IS NULL ORDER BY id`).all(),
    allLoans: () => db.prepare(`SELECT * FROM (${LOAN_SQL}) ORDER BY id`).all(),

    previewBooks(rows) {
      const seen = new Set()
      return rows.map((raw, i) => {
        const item = { row: raw._row ?? i + 2, status: 'new', error: null, data: null }
        try {
          item.data = cleanBook(raw)
          const isbn = item.data.isbn
          if (isbn) {
            if (findByIsbn(isbn) || seen.has(isbn)) item.status = 'duplicate'
            seen.add(isbn)
          }
        } catch (e) {
          item.status = 'invalid'
          item.error = e.message
        }
        return item
      })
    },

    /** mode: 'skip' يتجاهل المكرر، 'copies' يضيف نسخًا للكتاب الموجود */
    importBooks(rows, mode = 'skip') {
      return db.transaction(() => {
        const r = { created: 0, copiesAdded: 0, skipped: 0, invalid: 0 }
        for (const raw of rows) {
          let row
          try { row = cleanBook(raw) } catch { r.invalid++; continue }
          const existing = row.isbn ? findByIsbn(row.isbn) : null
          if (existing) {
            if (mode === 'copies') {
              const n = Math.max(1, row.copies)
              for (let i = 0; i < n; i++) addCopyRow(existing.id)
              promote(existing.id)
              r.copiesAdded += n
            } else r.skipped++
            continue
          }
          createBook(row)
          r.created++
        }
        return r
      })()
    },

    previewMembers(rows) {
      const seen = new Set()
      return rows.map((raw, i) => {
        const item = { row: raw._row ?? i + 2, status: 'new', error: null, data: null }
        try {
          const d = cleanMember(raw)
          item.data = d
          const key = `${arnorm(d.name)}|${d.phone || ''}`
          const dupCard = d.card_no && db.prepare('SELECT 1 FROM members WHERE upper(card_no) = ?').get(d.card_no)
          const dupName = db.prepare("SELECT 1 FROM members WHERE archived_at IS NULL AND arnorm(name) = ? AND COALESCE(phone,'') = ?").get(arnorm(d.name), d.phone || '')
          if (dupCard || dupName || seen.has(key)) item.status = 'duplicate'
          seen.add(key)
        } catch (e) {
          item.status = 'invalid'
          item.error = e.message
        }
        return item
      })
    },

    importMembers(rows) {
      const items = api.previewMembers(rows)
      return db.transaction(() => {
        const r = { created: 0, skipped: 0, invalid: 0 }
        for (const it of items) {
          if (it.status === 'invalid') r.invalid++
          else if (it.status === 'duplicate') r.skipped++
          else { createMember(it.data); r.created++ }
        }
        return r
      })()
    },

    /* ================= سجل العمليات ================= */
    audit({ user, action, summary }) {
      db.prepare('INSERT INTO audit_log (user_id, username, action, summary) VALUES (?, ?, ?, ?)').run(
        user?.id ?? null, user?.username ?? null, String(action), String(summary).slice(0, 400)
      )
    },

    listAudit({ search = '', username = '', page = 1, pageSize = 50 } = {}) {
      const { limit, offset } = paging(page, pageSize)
      const p = { ...P(search), u: String(username || '') }
      const where = `(@u = '' OR username = @u)
        AND (@s = '' OR arnorm(summary) LIKE @like ESCAPE '\\' OR arnorm(COALESCE(username,'')) LIKE @like ESCAPE '\\')`
      const total = db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE ${where}`).get(p).c
      const rows = db
        .prepare(`SELECT id, at, username, action, summary FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
        .all({ ...p, limit, offset })
      return { rows, total }
    },

    auditUsers() {
      return db.prepare("SELECT DISTINCT username FROM audit_log WHERE username IS NOT NULL ORDER BY username").all().map((r) => r.username)
    },

    /* ================= رمز الاسترداد ================= */
    createRecoveryCode() {
      const code = genRecoveryCode()
      const { salt, hash } = hashPw(normCode(code))
      const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      db.transaction(() => {
        up.run('recovery_salt', salt)
        up.run('recovery_hash', hash)
        up.run('recovery_at', db.prepare("SELECT date('now','localtime') d").get().d)
      })()
      return code
    },

    verifyRecoveryCode(code) {
      const get = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value
      const salt = get('recovery_salt')
      const hash = get('recovery_hash')
      if (!salt || !hash) { checkPw(normCode(code), DUMMY.salt, DUMMY.hash); return false }
      return checkPw(normCode(code), salt, hash)
    },

    recoveryInfo() {
      const at = db.prepare("SELECT value FROM settings WHERE key = 'recovery_at'").get()?.value
      return { exists: !!at, created_at: at || null }
    },

    /* ================= المستخدمون ================= */
    hasUsers() {
      return !!db.prepare('SELECT 1 FROM users LIMIT 1').get()
    },

    getUser(id) {
      return db.prepare('SELECT id, username, display_name, role, active FROM users WHERE id = ?').get(id)
    },

    listUsers() {
      return db.prepare('SELECT id, username, display_name, role, active, created_at FROM users ORDER BY id').all()
    },

    createUser({ username, display_name, role, password }) {
      const u = clean(username)
      const name = clean(display_name)
      if (!u || !/^[\p{L}\p{N}_.-]{3,32}$/u.test(u)) throw err(tr("اسم المستخدم من 3 إلى 32 حرفًا (أحرف وأرقام و _ . - فقط)"))
      if (!name) throw err(tr("الاسم الكامل مطلوب"))
      if (!ROLES.includes(role)) throw err(tr("الصلاحية غير صالحة"))
      validatePassword(password)
      if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(u)) throw err(tr("اسم المستخدم مستعمل"))
      const { salt, hash } = hashPw(password)
      return Number(
        db
          .prepare('INSERT INTO users (username, display_name, role, pw_salt, pw_hash) VALUES (?, ?, ?, ?, ?)')
          .run(u, name, role, salt, hash).lastInsertRowid
      )
    },

    authenticate(username, password) {
      const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(clean(username) || '')
      if (!row) {
        checkPw(String(password), DUMMY.salt, DUMMY.hash) // تقليل الفارق الزمني
        return null
      }
      if (!row.active || !checkPw(String(password), row.pw_salt, row.pw_hash)) return null
      return { id: row.id, username: row.username, display_name: row.display_name, role: row.role }
    },

    updateUser({ id, display_name, role, active }) {
      const name = clean(display_name)
      if (!name) throw err(tr("الاسم الكامل مطلوب"))
      if (!ROLES.includes(role)) throw err(tr("الصلاحية غير صالحة"))
      const target = db.prepare('SELECT role, active FROM users WHERE id = ?').get(id)
      if (!target) throw err(tr("المستخدم غير موجود"))
      const willBeActiveAdmin = role === 'admin' && !!active
      if (target.role === 'admin' && target.active && !willBeActiveAdmin) {
        const others = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1 AND id <> ?").get(id).c
        if (others === 0) throw err(tr("يجب أن يبقى مدير نشط واحد على الأقل"))
      }
      db.prepare('UPDATE users SET display_name=?, role=?, active=? WHERE id=?').run(name, role, active ? 1 : 0, id)
      return true
    },

    resetPassword(id, password) {
      validatePassword(password)
      const { salt, hash } = hashPw(password)
      const r = db.prepare('UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?').run(salt, hash, id)
      if (r.changes === 0) throw err(tr("المستخدم غير موجود"))
      return true
    },

    changePassword(id, oldPassword, newPassword) {
      const row = db.prepare('SELECT pw_salt, pw_hash FROM users WHERE id = ?').get(id)
      if (!row || !checkPw(String(oldPassword), row.pw_salt, row.pw_hash)) throw err(tr("كلمة المرور الحالية غير صحيحة"))
      return api.resetPassword(id, newPassword)
    },
  }
  return api
}

module.exports = { createDb, SCHEMA_VERSION, SETTINGS_DEFAULTS, isbnValid, arnorm }
