import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { MotionGlobalConfig } from 'framer-motion'

MotionGlobalConfig.skipAnimations = true // الحركات فورية في الاختبار
afterEach(cleanup)
window.print = () => {}

// jsdom لا يوفر matchMedia ولا offsetParent
window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
Object.defineProperty(HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode } })
Element.prototype.scrollIntoView ??= () => {}

window.print ??= () => {}
