import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// سياسة أمان المحتوى (CSP) في النسخة المبنية فقط، حتى لا تعطّل HMR أثناء التطوير
const csp = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'" />`
    ),
}

// حارس الإقلاع (public/boot-guard.js) يُحقن في أول <head> ليسبق سكربت الواجهة، فيلتقط حتى فشل تحميله.
// الحقن بإضافة لا بوسم في index.html: الوسم الصريح يُرتَّب بعد سكربت الوحدات ويُنتج تحذير Vite.
const bootGuard = {
  name: 'boot-guard',
  transformIndexHtml: () => [{ tag: 'script', attrs: { src: './boot-guard.js' }, injectTo: 'head-prepend' }],
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), csp, bootGuard],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
})
