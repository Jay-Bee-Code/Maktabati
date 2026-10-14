/**
 * يشغّل كل الاختبارات.
 * better-sqlite3 يُبنى لـ Electron عند التثبيت، والاختبارات تعمل على Node العادي،
 * لذلك نعيد بناءه لـ Node مؤقتًا ثم نعيده لـ Electron دائمًا في النهاية.
 */
const { spawnSync } = require('child_process')
const run = (cmd) => spawnSync(cmd, { stdio: 'inherit', shell: true }).status

let code = 1
try {
  if (run('npm rebuild better-sqlite3') === 0) {
    code = run('node --test tests/db.test.js tests/features.test.js tests/phase3.test.js tests/phase4.test.js tests/phase5.test.js tests/phase6.test.js tests/i18n.test.js tests/theme.test.js tests/ipc.test.js tests/main.smoke.test.js') || run('npx vitest run')
  }
} finally {
  run('npx electron-builder install-app-deps')
}
process.exit(code)
