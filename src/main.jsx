import React from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/amiri/400.css'
import '@fontsource/amiri/700.css'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { ToastProvider } from './ui.jsx'
import { AuthProvider } from './auth.jsx'
import { applyTheme, getMode } from './theme.js'

applyTheme(getMode()) // قبل أول رسم لتجنب وميض الخلفية

createRoot(document.getElementById('root')).render(
  <MotionConfig reducedMotion="user">
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  </MotionConfig>
)
