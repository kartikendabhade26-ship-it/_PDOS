const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getESTOffset } = require('./utils/math/time');

// Cross-platform data directory resolution.
// Priority: PDOS_DATA_DIR env var → repo-local ./data folder → legacy Windows paths.
const SCAN_DIRS = [
  process.env.PDOS_DATA_DIR,
  path.join(__dirname, '..', 'data'),
  "D:\\nijna data\\Project 1 MNQ data",
  "D:\\nijna data"
].filter(Boolean);

// In-memory cache for parsed 1m bars
const cache = new Map();
// Precomputed daily bars cache (full 15 years of history)
const dailyCache = new Map();
// Discovered symbol files mapping: SymbolName -> FullPath
const symbolFiles = new Map();

// Helper to scan for files
function scanForSymbols() {
  symbolFiles.clear();
  for (const dirPath of SCAN_DIRS) {
    if (!fs.existsSync(dirPath)) continue;
    try {
      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) continue;

      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if ((ext === '.csv' || ext === '.txt') && !file.toLowerCase().includes('package')) {
          const symbol = path.basename(file, ext);
          const fullPath = path.join(dirPath, file);
          if (!symbolFiles.has(symbol)) {
            symbolFiles.set(symbol, fullPath);
          }
        }
      }
    } catch (e) {
      // Ignore directory scan errors
    }
  }
}

// Convert date-time string to Unix timestamp (seconds)
function parseDateTimeToEpoch(dateStr) {
  try {
    const cleanStr = dateStr.trim();
    let year, month, day, hour, minute, second = 0;

    if (cleanStr.includes('-')) {
      // Format: 2011-05-09 03:31:00
      year = parseInt(cleanStr.substring(0, 4), 10);
      month = parseInt(cleanStr.substring(5, 7), 10);
      day = parseInt(cleanStr.substring(8, 10), 10);
      hour = parseInt(cleanStr.substring(11, 13), 10);
      minute = parseInt(cleanStr.substring(14, 16), 10);
      if (cleanStr.length >= 19) {
        second = parseInt(cleanStr.substring(17, 19), 10);
      }
    } else if (cleanStr.includes(';')) {
      // Semicolon format fallback
      const parts = cleanStr.split(';');
      return parseDateTimeToEpoch(parts[0]);
    } else {
      // NinjaTrader Format: 20250312 183100
      year = parseInt(cleanStr.substring(0, 4), 10);
      month = parseInt(cleanStr.substring(4, 6), 10);
      day = parseInt(cleanStr.substring(6, 8), 10);
      hour = parseInt(cleanStr.substring(9, 11), 10);
      minute = parseInt(cleanStr.substring(11, 13), 10);
      if (cleanStr.length >= 15) {
        second = parseInt(cleanStr.substring(13, 15), 10);
      }
    }

    if (isNaN(year) || isNaN(month) || isNaN(day)) return 0;
    return Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
  } catch (err) {
    return 0;
  }
}

// Read CSV header to discover column indices and delimiter
function readHeaderInfo(filePath) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { start: 0, end: 2048 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let resolved = false;
    rl.on('line', (line) => {
      if (resolved) return;
      const trimmed = line.trim();
      if (!trimmed) return;
      
      const delim = trimmed.includes(';') ? ';' : ',';
      const parts = trimmed.split(delim);
      const firstColVal = parts[0].toLowerCase();
      const secondColVal = parts[1];
      
      let dateIdx = 0, openIdx = 1, highIdx = 2, lowIdx = 3, closeIdx = 4, volIdx = 5;
      let hasHeader = false;
      
      if (firstColVal.includes('date') || firstColVal.includes('time') || isNaN(Number(secondColVal))) {
        hasHeader = true;
        for (let i = 0; i < parts.length; i++) {
          const h = parts[i].trim().toLowerCase();
          if (h.includes('date') || h.includes('time')) dateIdx = i;
          else if (h === 'open') openIdx = i;
          else if (h === 'high') highIdx = i;
          else if (h === 'low') lowIdx = i;
          else if (h === 'close') closeIdx = i;
          else if (h === 'volume') volIdx = i;
        }
      }
      resolved = true;
      rl.close();
      resolve({ delim, dateIdx, openIdx, highIdx, lowIdx, closeIdx, volIdx, hasHeader });
    });
    rl.on('close', () => {
      if (!resolved) {
        resolve({ delim: ',', dateIdx: 0, openIdx: 1, highIdx: 2, lowIdx: 3, closeIdx: 4, volIdx: 5, hasHeader: false });
      }
    });
  });
}

function precomputeDailyHighLows(bars) {
  const dailyData = new Map(); // dayKey -> { high, low }

  // Step 1: Calculate daily high and low for each EST calendar day key (integer)
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const dayKey = Math.floor((bar.time + getESTOffset(bar.time)) / 86400);

    let day = dailyData.get(dayKey);
    if (!day) {
      day = { high: bar.high, low: bar.low };
      dailyData.set(dayKey, day);
    } else {
      day.high = Math.max(day.high, bar.high);
      day.low = Math.min(day.low, bar.low);
    }
  }

  // Step 2: Sort day keys chronologically to find previous trading day
  const sortedDays = Array.from(dailyData.keys()).sort((a, b) => a - b);
  const prevDayMap = new Map(); // dayKey -> { dailyHigh, dailyLow }
  for (let i = 1; i < sortedDays.length; i++) {
    const prevDayKey = sortedDays[i - 1];
    const prevDayData = dailyData.get(prevDayKey);
    prevDayMap.set(sortedDays[i], {
      dailyHigh: prevDayData.high,
      dailyLow: prevDayData.low
    });
  }

  // Step 3: Attach values to each bar
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const dayKey = Math.floor((bar.time + getESTOffset(bar.time)) / 86400);
    const dayVal = dailyData.get(dayKey);
    const prevVal = prevDayMap.get(dayKey);

    bar.currHigh = dayVal ? dayVal.high : bar.high;
    bar.currLow  = dayVal ? dayVal.low  : bar.low;
    
    bar.dailyHigh = prevVal ? prevVal.dailyHigh : bar.high;
    bar.dailyLow  = prevVal ? prevVal.dailyLow  : bar.low;
  }
}

// Parse CSV file tail-first (only loads last 350k bars to avoid out-of-memory heap crash)
const parsePromises = new Map();

// Parse CSV file tail-first (only loads last 350k bars to avoid out-of-memory heap crash)
async function parseCsvFile(filePath, forceFull = false, limitBars = null) {
  const cacheKey = `${filePath}_${forceFull}_${limitBars || 'none'}`;
  if (parsePromises.has(cacheKey)) {
    console.log(`[parseCsvFile] Re-using existing parsing promise for ${cacheKey}`);
    return parsePromises.get(cacheKey);
  }

  const promise = _parseCsvFileInner(filePath, forceFull, limitBars);
  parsePromises.set(cacheKey, promise);

  try {
    const bars = await promise;
    return bars;
  } finally {
    parsePromises.delete(cacheKey);
  }
}

async function _parseCsvFileInner(filePath, forceFull = false, limitBars = null) {
  const header = await readHeaderInfo(filePath);
  const { delim, dateIdx, openIdx, highIdx, lowIdx, closeIdx, volIdx } = header;

  return new Promise((resolve, reject) => {
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    
    // Support configurable dataset sizes for Interactive Mode using byte seek approximations
    let startByte = 0;
    if (!forceFull) {
      if (limitBars) {
        startByte = Math.max(0, fileSize - limitBars * 75);
      } else {
        startByte = Math.max(0, fileSize - 35000000);
      }
    }
    const bars = [];
    console.log(`[parseCsvFile] Started reading ${filePath} from byte ${startByte}. File size: ${fileSize}`);
    
    const fileStream = fs.createReadStream(filePath, { start: startByte });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let skipLine = startByte > 0; // Skip first line if we seeked because it might be truncated
    let lineCount = 0;

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (skipLine) {
        skipLine = false;
        return;
      }

      lineCount++;
      if (lineCount % 100000 === 0) {
        console.log(`[parseCsvFile] Parsed ${lineCount} lines...`);
      }

      const parts = line.split(delim);
      if (parts.length < 5) return;

      const t = parseDateTimeToEpoch(parts[dateIdx]);
      if (t === 0) return;

      const o = parseFloat(parts[openIdx]);
      const h = parseFloat(parts[highIdx]);
      const l = parseFloat(parts[lowIdx]);
      const c = parseFloat(parts[closeIdx]);
      const v = parts[volIdx] ? parseFloat(parts[volIdx]) : 0;

      if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) return;

      bars.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
    });

    rl.on('close', () => {
      console.log(`[parseCsvFile] Finished reading ${lineCount} lines. Sorting ${bars.length} bars...`);
      // Sort bars chronologically
      bars.sort((a, b) => a.time - b.time);
      console.log(`[parseCsvFile] Sorting complete. Precomputing daily highs/lows...`);
      precomputeDailyHighLows(bars);
      console.log(`[parseCsvFile] Precomputation complete. Resolving bars...`);
      resolve(bars);
    });

    rl.on('error', (err) => {
      console.error(`[parseCsvFile] Stream error:`, err);
      reject(err);
    });
  });
}

// In-memory file byte-offset indices mapping: SymbolName -> SortedArray of { time, offset }
const symbolIndices = new Map();

function buildSymbolIndex(symbol, filePath) {
  if (symbolIndices.has(symbol)) {
    return Promise.resolve(symbolIndices.get(symbol));
  }

  return new Promise(async (resolve, reject) => {
    try {
      const header = await readHeaderInfo(filePath);
      const { delim, dateIdx } = header;

      const index = []; // Array of { time: epoch, offset: number }
      const stream = fs.createReadStream(filePath);
      let offset = 0;
      let buffer = '';
      let lastDateStr = '';
      let isHeader = header.hasHeader;
      
      stream.on('data', (chunk) => {
        const str = chunk.toString('utf8');
        let startIdx = 0;
        for (let i = 0; i < str.length; i++) {
          if (str[i] === '\n') {
            const line = buffer + str.substring(startIdx, i);
            const trimmed = line.trim();
            if (trimmed) {
              if (isHeader) {
                isHeader = false;
              } else {
                let rawDateStr = '';
                if (dateIdx === 0) {
                  const firstDelim = trimmed.indexOf(delim);
                  rawDateStr = firstDelim !== -1 ? trimmed.substring(0, firstDelim) : trimmed;
                } else {
                  const parts = trimmed.split(delim);
                  rawDateStr = parts[dateIdx] ? parts[dateIdx].trim() : '';
                }

                let dateStr = '';
                if (rawDateStr.includes('-')) {
                  dateStr = rawDateStr.substring(0, 10);
                } else {
                  dateStr = rawDateStr.substring(0, 8);
                }
                
                if (dateStr && dateStr !== lastDateStr) {
                  const t = parseDateTimeToEpoch(rawDateStr);
                  if (t > 0) {
                    index.push({
                      time: t,
                      offset: offset + startIdx
                    });
                    lastDateStr = dateStr;
                  }
                }
              }
            }
            buffer = '';
            startIdx = i + 1;
          }
        }
        buffer = str.substring(startIdx);
        offset += chunk.length;
      });

      stream.on('end', () => {
        index.sort((a, b) => a.time - b.time);
        symbolIndices.set(symbol, index);
        resolve(index);
      });

      stream.on('error', (err) => {
        reject(err);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function findOffsetForTime(index, targetTime) {
  if (!index || index.length === 0) return 0;
  
  let low = 0;
  let high = index.length - 1;
  let resultOffset = index[0].offset;
  
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const entry = index[mid];
    
    if (entry.time <= targetTime) {
      resultOffset = entry.offset;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  
  return resultOffset;
}

function parseCsvFromOffset(filePath, startOffset, startSec, endSec, limit, headerInfo) {
  const { delim, dateIdx, openIdx, highIdx, lowIdx, closeIdx, volIdx } = headerInfo;
  
  return new Promise((resolve, reject) => {
    const bars = [];
    const stream = fs.createReadStream(filePath, { start: startOffset });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    
    let isHeader = startOffset === 0 && headerInfo.hasHeader;
    
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      if (isHeader) {
        isHeader = false;
        return;
      }
      
      const parts = line.split(delim);
      if (parts.length < 5) return;
      
      const t = parseDateTimeToEpoch(parts[dateIdx]);
      if (t === 0) return;
      
      if (t > endSec) {
        rl.close();
        return;
      }
      
      if (t >= startSec) {
        const o = parseFloat(parts[openIdx]);
        const h = parseFloat(parts[highIdx]);
        const l = parseFloat(parts[lowIdx]);
        const c = parseFloat(parts[closeIdx]);
        const v = parts[volIdx] ? parseFloat(parts[volIdx]) : 0;
        
        if (!isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(c)) {
          bars.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
        }
        
        if (limit > 0 && bars.length >= limit) {
          rl.close();
          return;
        }
      }
    });
    
    rl.on('close', () => {
      bars.sort((a, b) => a.time - b.time);
      precomputeDailyHighLows(bars);
      resolve(bars);
    });
    
    rl.on('error', (err) => {
      reject(err);
    });
  });
}

// Precompute and cache daily bars from the full CSV file (15 years of data)
function buildDailyCache(symbol, filePath) {
  return new Promise(async (resolve, reject) => {
    try {
      const header = await readHeaderInfo(filePath);
      const { delim, dateIdx, openIdx, highIdx, lowIdx, closeIdx, volIdx } = header;

      const dailyBars = [];
      const stream = fs.createReadStream(filePath);
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      let isHeader = true;
      let currentDayStr = '';
      let currentBar = null;

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        if (isHeader) {
          isHeader = false;
          return;
        }

        const parts = line.split(delim);
        if (parts.length < 5) return;

        const rawDate = parts[dateIdx].trim();
        let dayStr = '';
        if (rawDate.includes('-')) {
          dayStr = rawDate.substring(0, 10);
        } else {
          dayStr = rawDate.substring(0, 8);
          dayStr = `${dayStr.substring(0, 4)}-${dayStr.substring(4, 6)}-${dayStr.substring(6, 8)}`;
        }

        const o = parseFloat(parts[openIdx]);
        const h = parseFloat(parts[highIdx]);
        const l = parseFloat(parts[lowIdx]);
        const c = parseFloat(parts[closeIdx]);
        const v = parts[volIdx] ? parseFloat(parts[volIdx]) : 0;

        if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) return;

        if (dayStr !== currentDayStr) {
          if (currentBar) {
            dailyBars.push(currentBar);
          }
          currentDayStr = dayStr;
          
          const epoch = Date.UTC(
            parseInt(dayStr.substring(0, 4), 10),
            parseInt(dayStr.substring(5, 7), 10) - 1,
            parseInt(dayStr.substring(8, 10), 10),
            0, 0, 0
          ) / 1000;

          currentBar = {
            time: epoch,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: v
          };
        } else {
          currentBar.high = Math.max(currentBar.high, h);
          currentBar.low = Math.min(currentBar.low, l);
          currentBar.close = c;
          currentBar.volume += v;
        }
      });

      rl.on('close', () => {
        if (currentBar) {
          dailyBars.push(currentBar);
        }
        dailyCache.set(symbol, dailyBars);
        resolve(dailyBars);
      });

      rl.on('error', (err) => reject(err));
    } catch (e) {
      reject(e);
    }
  });
}

// Timeframe Aggregation
function aggregate(rawBars, tfMinutes) {
  if (tfMinutes <= 1) return rawBars;

  const stepSeconds = tfMinutes * 60;
  const aggregated = [];
  
  if (rawBars.length === 0) return aggregated;

  let currentAgg = null;
  let currentBucket = -1;

  for (let i = 0; i < rawBars.length; i++) {
    const bar = rawBars[i];
    const bucket = Math.floor(bar.time / stepSeconds) * stepSeconds;

    if (bucket !== currentBucket) {
      if (currentAgg) {
        aggregated.push(currentAgg);
      }
      currentBucket = bucket;
      currentAgg = {
        time: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      };
    } else {
      currentAgg.high = Math.max(currentAgg.high, bar.high);
      currentAgg.low = Math.min(currentAgg.low, bar.low);
      currentAgg.close = bar.close;
      currentAgg.volume += bar.volume;
    }
  }

  if (currentAgg) {
    aggregated.push(currentAgg);
  }

  return aggregated;
}

module.exports = {
  parseDateTimeToEpoch,
  readHeaderInfo,
  precomputeDailyHighLows,
  parseCsvFile,
  buildSymbolIndex,
  findOffsetForTime,
  parseCsvFromOffset,
  aggregate,
  buildDailyCache,
  scanForSymbols,
  symbolFiles,
  cache,
  dailyCache
};
