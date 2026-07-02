import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Safe stringification helper to avoid circular reference crashes
const safeStringify = (obj) => {
  try {
    if (typeof obj === 'string') return obj;
    return JSON.stringify(obj);
  } catch (err) {
    try {
      // Fallback: extract main properties for common objects
      if (obj && obj.message) return `[Error: ${obj.message}]`;
      if (obj && obj.target) return `[DOM Event: ${obj.type || 'unknown'}]`;
      return `[Unserializable: ${err.message}]`;
    } catch (e) {
      return '[Unserializable Object]';
    }
  }
};

// Remote logger setup: only redirect console.error and uncaught errors to prevent network congestion from console.log spam
const origLog = console.log;
// Keep standard console.log intact without network requests

const origError = console.error;
console.error = (...args) => {
  origError(...args);
  const msg = "[ERROR] " + args.map(safeStringify).join(' ');
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg })
  }).catch(() => {});
};

window.addEventListener('error', (event) => {
  const msg = `[UNCAUGHT CLIENT ERROR] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg })
  }).catch(() => {});
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = `[UNCAUGHT CLIENT REJECTION] ${event.reason}`;
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg })
  }).catch(() => {});
});

// ─── Prevent browser page-zoom ───────────────────────────────────────────────
// Ctrl+Scroll would normally zoom the whole page. We intercept it here at the
// capture phase (before the chart library sees it) and call preventDefault()
// so the browser never changes the page zoom level.
// The LightweightCharts instance has handleScale.mouseWheel=true so it will
// still zoom the chart correctly via its own internal handler.
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
  }
}, { passive: false, capture: true });

// Block Ctrl +/−/0 keyboard shortcuts that zoom the browser
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (
    e.key === '+' || e.key === '-' || e.key === '=' ||
    e.key === '_' || e.key === '0' ||
    e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0'
  )) {
    e.preventDefault();
  }
}, { capture: true });
// ─────────────────────────────────────────────────────────────────────────────

console.log("Client-side logger initialized. Redirecting logs to server...");

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
