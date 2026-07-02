import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, HelpCircle, Trash2, Bot, User, CornerDownLeft } from 'lucide-react';

const API = 'http://localhost:8080';

const SUGGESTIONS = [
  "Find bullish FVGs in NY AM session",
  "Show London session Order Blocks",
  "Tuesday NFP week setups",
  "Show me setups that swept PDH/PDL",
  "Find HOD/LOD bearish Order Blocks"
];

const OUTCOME_LABELS = {
  no_touch:     'No Touch',
  bounce_edge:  'Bounce at Edge',
  bounce_50pct: 'Bounce at 50%',
  mitigated:    'Fully Mitigated',
  sweep_reverse:'Sweep & Reverse',
};

export default function ChatAssistant({ activeSymbol, drawings, setDrawings }) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([
    {
      sender: 'ai',
      text: "👋 Hello! I am your MNQ Trading Assistant. You can ask me to scan the historical Nasdaq chart for specific patterns and highlight them directly on your chart.\n\nTry typing: *\"Find bullish FVGs in NY AM session\"*"
    }
  ]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (textToSend) => {
    const userInput = textToSend || query;
    if (!userInput.trim()) return;

    // Add User Message
    setMessages(prev => [...prev, { sender: 'user', text: userInput }]);
    if (!textToSend) setQuery('');
    setLoading(true);

    try {
      // 1. Parser Logic (Natural Language -> Context Filters)
      const lower = userInput.toLowerCase();
      
      // Determine Concept
      let concept = 'fvg_bullish';
      if (lower.includes('bearish fvg') || (lower.includes('fvg') && lower.includes('bear'))) {
        concept = 'fvg_bearish';
      } else if (lower.includes('bullish fvg') || lower.includes('fvg')) {
        concept = 'fvg_bullish';
      } else if (lower.includes('bearish ob') || lower.includes('bearish order block') || (lower.includes('ob') && lower.includes('bear'))) {
        concept = 'ob_bearish';
      } else if (lower.includes('bullish ob') || lower.includes('bullish order block') || lower.includes('ob')) {
        concept = 'ob_bullish';
      } else if (lower.includes('bsl') || lower.includes('buy side liquidity') || lower.includes('equal highs')) {
        concept = 'liquidity_bsl';
      } else if (lower.includes('ssl') || lower.includes('sell side liquidity') || lower.includes('equal lows')) {
        concept = 'liquidity_ssl';
      }

      // Determine Session
      let session = null; // 0=Asia, 1=London, 2=NY AM, 3=NY PM
      if (lower.includes('london')) session = 1;
      else if (lower.includes('ny am') || lower.includes('ny-am') || lower.includes('morning')) session = 2;
      else if (lower.includes('ny pm') || lower.includes('ny-pm') || lower.includes('afternoon')) session = 3;
      else if (lower.includes('asia') || lower.includes('overnight')) session = 0;

      // Determine Day of Week
      let dayOfWeek = null; // 0=Sun, 1=Mon, ..., 5=Fri
      if (lower.includes('sunday')) dayOfWeek = 0;
      else if (lower.includes('monday')) dayOfWeek = 1;
      else if (lower.includes('tuesday')) dayOfWeek = 2;
      else if (lower.includes('wednesday')) dayOfWeek = 3;
      else if (lower.includes('thursday')) dayOfWeek = 4;
      else if (lower.includes('friday')) dayOfWeek = 5;

      // Other flags
      const nfpWeek = lower.includes('nfp week') || lower.includes('non-farm payroll');
      const dayBeforeNFP = lower.includes('day before nfp') || lower.includes('pre-nfp');
      const sweptPDHL = lower.includes('swept pdh') || lower.includes('swept pdl') || lower.includes('pdh sweep') || lower.includes('pdl sweep');
      const hod = lower.includes('hod') || lower.includes('high of the day') || lower.includes('high of day');
      const lod = lower.includes('lod') || lower.includes('low of the day') || lower.includes('low of day');

      // 2. Fetch all candidates and reaction results from backend scan
      const res = await fetch(`${API}/api/algo/scan?symbol=${activeSymbol}&concept=${concept}&lookahead=50&limit=5000`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      
      const rawResults = data.results || [];

      // 3. Filter using parsed criteria
      const filtered = rawResults.filter(r => {
        if (session !== null && r.session !== session) return false;
        if (dayOfWeek !== null && r.dayOfWeek !== dayOfWeek) return false;
        if (nfpWeek && !r.isNFPWeek) return false;
        if (dayBeforeNFP && !r.isDayBeforeNFP) return false;
        if (sweptPDHL && !r.sweptPDH && !r.sweptPDL) return false;
        if (hod && !r.isHOD) return false;
        if (lod && !r.isLOD) return false;
        return true;
      });

      if (filtered.length === 0) {
        setMessages(prev => [...prev, {
          sender: 'ai',
          text: `🤖 Checked **${rawResults.length}** historical setups for **${concept.toUpperCase()}**, but found **0** matches matching your specific filters. Try widening your criteria!`
        }]);
        setLoading(false);
        return;
      }

      // 4. Highlight matching zones on the chart (Max 15 to prevent overload)
      const highlightCount = Math.min(15, filtered.length);
      const recentSetups = filtered.slice(0, highlightCount);

      // Remove previous AI highlights first
      const nonAI = drawings.filter(d => !d.isAIHighlight);

      const conceptLabels = {
        fvg_bullish: 'Bullish FVG',
        fvg_bearish: 'Bearish FVG',
        ob_bullish: 'Bullish OB',
        ob_bearish: 'Bearish OB',
        liquidity_bsl: 'BSL Sweep',
        liquidity_ssl: 'SSL Sweep'
      };

      const conceptColors = {
        fvg_bullish: '#26a69a',
        fvg_bearish: '#ef5350',
        ob_bullish: '#00bcd4',
        ob_bearish: '#ff9800',
        liquidity_bsl: '#aa00ff',
        liquidity_ssl: '#f44336'
      };

      const newHighlights = recentSetups.map((setup, idx) => {
        const timeStart = setup.time;
        // Extend rectangle 30 bars (1800s) to the right for visibility
        const timeEnd = setup.time + 30 * 60;
        
        return {
          id: `ai_draw_${Date.now()}_${idx}`,
          type: 'rectangle',
          points: [
            { time: timeStart, price: setup.priceHigh },
            { time: timeEnd, price: setup.priceLow }
          ],
          color: conceptColors[concept] || '#2962ff',
          width: 1.5,
          opacity: 0.18,
          lineStyle: 'solid',
          isAIHighlight: true,
          locked: true,
          text: `🤖 AI: ${conceptLabels[concept]} (${OUTCOME_LABELS[setup.outcome] || setup.outcome})`
        };
      });

      setDrawings([...nonAI, ...newHighlights]);

      // 5. Calculate statistics for the filtered subset
      const touched = filtered.filter(r => r.touchedZone);
      const hit50 = filtered.filter(r => r.touched50Pct);
      const touchRate = ((touched.length / filtered.length) * 100).toFixed(1);
      const hit50Rate = ((hit50.length / filtered.length) * 100).toFixed(1);
      const avgMove = touched.length
        ? (touched.reduce((sum, r) => sum + r.maxFavorablePts, 0) / touched.length).toFixed(1)
        : '0';

      const sessionNames = ['Asia', 'London', 'NY AM', 'NY PM'];
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      const summaryText = `🤖 Found **${filtered.length}** matching setups in the database! I have highlighted the **${highlightCount}** most recent on your chart.

**💡 Reaction Probability Metrics:**
- **Touch Rate:** \`${touchRate}%\` (${touched.length}/${filtered.length} zones)
- **50% Midline Reach:** \`${hit50Rate}%\`
- **Avg Favorable Move:** \`+${avgMove} pts\` (after first touch)

${session !== null ? `*Filtered to:* **${sessionNames[session]}** session` : ''}
${dayOfWeek !== null ? `*Filtered to:* **${dayNames[dayOfWeek]}**` : ''}
${nfpWeek ? `*Filtered to:* **NFP Week**` : ''}
${sweptPDHL ? `*Filtered to:* **PDH/PDL swept**` : ''}
${hod || lod ? `*Filtered to:* **HOD/LOD setups**` : ''}`;

      setMessages(prev => [...prev, { sender: 'ai', text: summaryText }]);
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { sender: 'ai', text: `⚠️ Error scanning database: ${e.message}` }]);
    }

    setLoading(false);
  };

  const handleClearAI = () => {
    setDrawings(prev => prev.filter(d => !d.isAIHighlight));
    setMessages(prev => [...prev, { sender: 'ai', text: "🗑️ Cleared all AI highlighted zones from your chart viewport." }]);
  };

  return (
    <div className="watchlist-list" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 0 }}>
      {/* Messages Scroll Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex',
            gap: '8px',
            alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%'
          }}>
            {m.sender === 'ai' && (
              <div style={{
                width: '26px', height: '26px', borderRadius: '50%',
                background: 'rgba(41,98,255,0.12)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px'
              }}>
                <Bot size={13} style={{ color: '#2962ff' }} />
              </div>
            )}
            <div style={{
              background: m.sender === 'user' ? '#2962ff' : '#1c2030',
              color: m.sender === 'user' ? '#ffffff' : '#e0e3eb',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap',
              border: m.sender === 'ai' ? '1px solid #2a2e39' : 'none'
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: '8px', alignSelf: 'flex-start' }}>
            <div style={{
              width: '26px', height: '26px', borderRadius: '50%',
              background: 'rgba(41,98,255,0.12)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
              <Bot size={13} style={{ color: '#2962ff' }} />
            </div>
            <div style={{
              background: '#1c2030', color: 'var(--text-muted)',
              padding: '8px 12px', borderRadius: '8px', fontSize: '11px',
              border: '1px solid #2a2e39'
            }}>
              Scanning database and computing probabilities...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested chips */}
      {messages.length === 1 && !loading && (
        <div style={{ padding: '0 14px', display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>Suggested Scans:</span>
          {SUGGESTIONS.map((s, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(s)}
              className="algo-preset-btn"
              style={{
                textAlign: 'left', padding: '6px 8px', fontSize: '11px',
                borderRadius: '4px', background: '#1c2030', color: 'var(--text)',
                border: '1px solid #2a2e39', cursor: 'pointer', transition: 'all 0.15s ease'
              }}
            >
              🚀 {s}
            </button>
          ))}
        </div>
      )}

      {/* Footer controls & Input */}
      <div style={{ padding: '10px 14px', background: '#131722', borderTop: '1px solid #2a2e39' }}>
        {/* Helper Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <button
            onClick={handleClearAI}
            className="algo-small-btn results"
            style={{
              background: 'transparent', border: '1px solid #ef5350', color: '#ef5350',
              padding: '4px 8px', height: '22px', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            <Trash2 size={10} /> Clear Highlights
          </button>
        </div>

        {/* Input box */}
        <div style={{
          display: 'flex', alignItems: 'center', background: '#1c2030',
          border: '1px solid #2a2e39', borderRadius: '6px', padding: '4px 6px'
        }}>
          <input
            type="text"
            placeholder="Ask AI (e.g. Find Bullish FVG in London)..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              outline: 'none', color: '#ffffff', fontSize: '12px', padding: '6px'
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!query.trim()}
            style={{
              background: query.trim() ? '#2962ff' : 'transparent',
              color: query.trim() ? '#ffffff' : 'var(--text-muted)',
              border: 'none', borderRadius: '4px', width: '26px', height: '26px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: query.trim() ? 'pointer' : 'default', transition: 'all 0.15s'
            }}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
