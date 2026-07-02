# How to Add Your Own CSV Data

## Quick Start (3 steps)

1. **Drop your CSV file** into the `data/` folder:
   ```
   _PDOS/data/
     NQ_Historical_Data.csv   ← replace this with your file
     ES_1min.csv              ← or add multiple files
     YM_5min.csv
   ```

2. **Start the server:**
   ```bash
   cd _PDOS
   npm install          # only needed first time
   PORT=3000 node server.js
   ```

3. **Open the chart:**
   Open `http://localhost:3000/` in your browser.

That's it! The backend automatically:
- Discovers your CSV file
- Detects if the data changed (by file modification time)
- Clears old data from the database
- Runs the full PDOS pipeline (swing detection, FVG, OB, liquidity)
- Your data appears in the chart with all annotations

## CSV Format

Your CSV needs 6 columns in this order: **date, open, high, low, close, volume**

### Format A — Standard (with header row):
```csv
date,open,high,low,close,volume
2025-05-05 13:30:00,20000.00,20000.66,19998.99,19999.50,3232
2025-05-05 13:31:00,19999.50,20000.50,19998.49,19999.38,1028
```

### Format B — NinjaTrader (no header, compact date):
```csv
20250312 133000,20000.00,20000.66,19998.99,19999.50,3232
20250312 133100,19999.50,20000.50,19998.49,19999.38,1028
```

### Format C — Semicolon-delimited:
```csv
2025-05-05 13:30:00;20000.00;20000.66;19998.99;19999.50;3232
```

## Important Notes

- **1-minute bars work best.** The pipeline aggregates to 5m/15m/1h/4h/1D automatically.
- **The filename becomes the symbol name.** `ES_1min.csv` → symbol "ES_1min" in the dropdown.
- **Multiple files = multiple symbols.** Drop 5 CSVs, get 5 symbols.
- **Changing the CSV auto-triggers re-sync.** Just replace the file and restart the server.
- **To force a clean re-sync:** delete `_PDOS/market_research_v2.db` before starting.

## Troubleshooting

**"I don't see my data"**
- Make sure the CSV is in `_PDOS/data/` folder
- Check the filename doesn't have spaces or special characters
- Check the server console — it should say "Discovered symbols: - YourFileName"
- If the CSV has a different column order, add a header row with: date,open,high,low,close,volume

**"The numbers look wrong / mixed up"**
- Delete `_PDOS/market_research_v2.db` and restart the server
- This clears ALL old data and re-runs the pipeline fresh

**"Pipeline is slow"**
- For large files (>100k bars), the pipeline takes 5-10 seconds
- Watch the server console for progress: "[PIPELINE] Sync progress: 5000 / N events processed."

## File Structure

```
_PDOS/
  data/                    ← PUT YOUR CSV FILES HERE
    NQ_Historical_Data.csv
  algo/                    ← Backend engine (don't modify)
  frontend/                ← React frontend (don't modify)
  server.js                ← Backend server
  market_research_v2.db    ← Auto-generated database (delete to reset)
  HOW_TO_ADD_YOUR_DATA.md  ← This file
```
