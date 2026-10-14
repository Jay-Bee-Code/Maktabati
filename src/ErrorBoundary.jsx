import { Component } from 'react'
import { tr } from './i18n.js'

/** خطأ أثناء الرسم يُظهر نصه ويتيح إعادة التحميل بدل شاشة فارغة صامتة */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[renderer] render error', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="mx-auto max-w-3xl p-12">
        <h1 className="font-display text-3xl font-bold">{tr("حدث خطأ غير متوقع في الواجهة")}</h1>
        <p className="mt-3 leading-8 text-muted">{tr("وقع الخطأ أثناء رسم الواجهة ولا يرتبط بقاعدة البيانات. أعد التحميل، وإن تكرر فأرسل النص التالي إلى المطوّر.")}</p>
        <pre dir="ltr" className="mt-4 max-h-80 overflow-auto rounded-lg bg-mist p-4 text-start text-xs">{String(error?.stack || error)}</pre>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 cursor-pointer rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-deep">
          {tr("إعادة التحميل")}
        </button>
      </div>
    )
  }
}
