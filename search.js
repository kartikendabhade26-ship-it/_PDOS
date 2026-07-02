const fs = require('fs');
const content = fs.readFileSync('frontend/src/App.jsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('trainingSession') || line.includes('activeView') || line.includes('conceptLabels') || line.includes('explorerVersion')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
