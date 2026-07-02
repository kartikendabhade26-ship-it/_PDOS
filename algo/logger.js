const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'results', 'pdos_system.log');
const logListeners = new Set();

function writeLog(level, category, message, meta = null) {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` | Meta: ${JSON.stringify(meta)}` : '';
  const logLine = `[${timestamp}] [${level}] [${category}] ${message}${metaStr}\n`;

  if (level === 'ERROR') {
    console.error(logLine.trim());
  } else if (level === 'WARN') {
    console.warn(logLine.trim());
  } else {
    console.log(logLine.trim());
  }

  // Trigger dynamic run logging listeners
  for (const listener of logListeners) {
    try {
      listener(category, `${level}: ${message}`, meta);
    } catch (err) {}
  }

  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, logLine, 'utf8');
  } catch (err) {
    console.error(`[LOGGER ERROR] Failed to write to log file: ${err.message}`);
  }
}

module.exports = {
  info: (category, message, meta) => writeLog('INFO', category, message, meta),
  warn: (category, message, meta) => writeLog('WARN', category, message, meta),
  error: (category, message, err, meta) => {
    const errMeta = {
      errorMessage: err?.message,
      errorStack: err?.stack,
      ...meta
    };
    writeLog('ERROR', category, message, errMeta);
  },
  debug: (category, message, meta) => writeLog('DEBUG', category, message, meta),
  onLog: (fn) => logListeners.add(fn),
  offLog: (fn) => logListeners.delete(fn)
};
