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

console.log("Client-side logger initialized. Redirecting logs to server...");

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
