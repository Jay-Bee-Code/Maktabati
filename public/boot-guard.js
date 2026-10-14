/* حارس الإقلاع: يمنع «النافذة البيضاء الصامتة».
   ملف مستقل يعمل قبل الواجهة بلا أي اعتماد على مكتبة، ويلتقط ما لا تلتقطه React:
   فشل تحميل السكربت أو CSS، واستثناءً وقع قبل أن تبدأ الواجهة، وواجهة لم تُرسَم أصلًا.
   لا يتدخل إن كانت الواجهة قد رُسمت. النصوص ثابتة بالعربية والفرنسية (لا مكتبة ترجمة هنا). */
(function () {
  var TIMEOUT_MS = 8000
  var shown = false

  function rootEl() { return document.getElementById('root') }
  function rendered() { var r = rootEl(); return !!r && r.childElementCount > 0 }

  function show(detail) {
    if (shown || rendered()) return
    shown = true
    var box = document.createElement('div')
    box.setAttribute('role', 'alert')
    box.style.cssText = 'font:16px/1.9 system-ui,"Segoe UI",Tahoma,sans-serif;max-width:760px;margin:48px auto;padding:0 24px;color:#17262b'
    function add(tag, text, css, dir) {
      var n = document.createElement(tag)
      n.textContent = text // textContent لا innerHTML: نص الخطأ لا يُفسَّر شيفرةً أبدًا
      if (css) n.style.cssText = css
      if (dir) n.dir = dir
      box.appendChild(n)
    }
    add('h1', 'تعذّر عرض الواجهة', 'font-size:26px;margin:0 0 8px', 'rtl')
    add('p', 'Impossible d\u2019afficher l\u2019interface', 'font-size:18px;margin:0 0 16px;color:#5b6d71', 'ltr')
    add('pre', detail, 'direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-word;background:#e5eceb;padding:12px 14px;border-radius:8px;font-size:13px')
    add('p', 'افتح الطرفية التي شغّلت منها التطبيق: تُطبع الأخطاء هناك. لعرض أدوات المطوّر شغّل: npm start -- --devtools', 'margin:16px 0 0', 'rtl')
    add('p', 'Consultez le terminal d\u2019o\u00f9 l\u2019application a \u00e9t\u00e9 lanc\u00e9e. Outils de d\u00e9veloppement : npm start -- --devtools', 'margin:4px 0 0;color:#5b6d71', 'ltr')
    ;(rootEl() || document.body).appendChild(box)
  }

  // الالتقاط (capture) ليشمل فشل تحميل الموارد، فهي لا تفور إلى window
  window.addEventListener('error', function (e) {
    var t = e.target
    if (t && t !== window && (t.src || t.href)) return show('Failed to load: ' + (t.src || t.href))
    show((e.message || 'Error') + (e.filename ? '\n' + e.filename + ':' + e.lineno + ':' + e.colno : ''))
  }, true)

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason
    show('Unhandled rejection: ' + ((r && (r.stack || r.message)) || r))
  })

  setTimeout(function () { show('No UI was rendered after ' + TIMEOUT_MS / 1000 + 's') }, TIMEOUT_MS)
})()
