import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Tooltips } from './Tooltips'
import { completeSignInFromUrl } from './bungie'

// Finish a Bungie sign-in first if this load is the redirect back from bungie.net.
completeSignInFromUrl().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      <Tooltips />
    </StrictMode>,
  )
})
