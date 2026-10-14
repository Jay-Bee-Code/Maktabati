const { contextBridge, ipcRenderer } = require('electron')

// يُسمح فقط بالقنوات المعروفة: مجال:إجراء
const ALLOWED = /^(auth|audit|stats|reports|kiosk|settings|search|books|copies|members|loans|fines|reservations|reminders|labels|cards|overdue|print|app|users|excel|backup):[a-zA-Z]+$/

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, payload) => {
    if (!ALLOWED.test(channel)) return Promise.reject(new Error('قناة غير مسموحة')) // i18n-ignore: preload معزول (sandbox) ولا يحمّل وحدات محلية، والرسالة لا يراها المستخدم
    return ipcRenderer.invoke(channel, payload)
  },
})
