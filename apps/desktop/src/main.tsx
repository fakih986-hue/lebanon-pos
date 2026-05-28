import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, ThemeProvider } from '@lebanonpos/shared'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
)
