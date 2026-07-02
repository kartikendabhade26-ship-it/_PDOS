import React, { useState, useEffect } from 'react';
import { X, Check, XOctagon, HelpCircle } from 'lucide-react';

const CONCEPT_NAMES = {
  fvg: 'Fair Value Gap (FVG)',
  ifvg: 'Inverted Fair Value Gap (IFVG)',
  ob: 'Order Block (OB)',
  liquidity: 'Liquidity Pool',
  swing: 'Swing Point',
  strong_swing: 'Strong Swing Point',
  premium_discount: 'Premium/Discount Zone',
  protected_high_low: 'Protected High/Low',
  volume_imbalance: 'Volume Imbalance',
  liquidity_void: 'Liquidity Void',
  session: 'ICT Session Open',
  macro: 'ICT Macro Window',
  amd: 'AMD Cycle',
  mss: 'Market Structure Shift',
  bos: 'Break of Structure'
};

export default function CandidateExplorer({
  selectedAlgoCandidate,
  setSelectedAlgoCandidate,
  onSaveValidation
}) {
  const [notes, setNotes] = useState('');

  // Sync notes when selected candidate changes
  useEffect(() => {
    if (selectedAlgoCandidate?.validation) {
      setNotes(selectedAlgoCandidate.validation.notes || '');
    } else {
      setNotes('');
    }
  }, [selectedAlgoCandidate]);

  if (!selectedAlgoCandidate) return null;

  const cand = selectedAlgoCandidate;
  const isMitigated = cand.isMitigated || cand.properties?.mitigated;
  const validationStatus = cand.validation?.status;

  const handleValidate = (status) => {
    onSaveValidation(status, notes);
  };

  const getConceptLabel = () => {
    const name = CONCEPT_NAMES[cand.type] || cand.type;
    const direction = cand.direction ? ` (${cand.direction.toUpperCase()})` : '';
    return `${name}${direction}`;
  };

  const formatEpoch = (epoch) => {
    if (!epoch) return 'N/A';
    return new Date(epoch * 1000).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }) + ' EST';
  };

  return (
    <div 
      style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        zIndex: 1000,
        background: 'rgba(28, 32, 48, 0.92)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '20px',
        width: '360px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        color: '#ffffff',
        boxSizing: 'border-box',
        transition: 'all 0.3s ease'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '0.5px', color: '#fff' }}>
            Zone Inspector
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted, #787b86)' }}>
            Database Event Details
          </span>
        </div>
        <button 
          onClick={() => setSelectedAlgoCandidate(null)}
          style={{ 
            background: 'rgba(255, 255, 255, 0.05)', 
            border: 'none', 
            borderRadius: '50%', 
            width: '28px', 
            height: '28px', 
            color: '#b2b5be', 
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
        >
          <X size={16} />
        </button>
      </div>

      {/* Main Parameters Grid */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '10px', 
        background: 'rgba(0,0,0,0.2)', 
        padding: '12px', 
        borderRadius: '8px', 
        border: '1px solid rgba(255, 255, 255, 0.04)' 
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
          <span style={{ color: '#b2b5be' }}>Type:</span>
          <strong style={{ color: cand.direction === 'bullish' ? '#26a69a' : '#ef5350' }}>{getConceptLabel()}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
          <span style={{ color: '#b2b5be' }}>Timeframe:</span>
          <strong>{cand.timeframe < 60 ? `${cand.timeframe}m` : cand.timeframe < 1440 ? `${cand.timeframe/60}H` : '1D'}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
          <span style={{ color: '#b2b5be' }}>Start Time:</span>
          <span style={{ fontFamily: 'monospace' }}>{formatEpoch(cand.timeStart || cand.time)}</span>
        </div>
        {cand.timeEnd && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#b2b5be' }}>End Time:</span>
            <span style={{ fontFamily: 'monospace' }}>{formatEpoch(cand.timeEnd)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
          <span style={{ color: '#b2b5be' }}>Price Range:</span>
          <span style={{ fontFamily: 'monospace' }}>{cand.priceHigh.toFixed(2)} - {cand.priceLow.toFixed(2)}</span>
        </div>
      </div>

      {/* Outcome / Mitigation Status */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '8px', 
        background: 'rgba(255, 255, 255, 0.02)', 
        padding: '12px', 
        borderRadius: '8px', 
        border: '1px solid rgba(255, 255, 255, 0.04)' 
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
          <span style={{ color: '#b2b5be' }}>Status:</span>
          <span style={{ 
            fontWeight: 600, 
            color: isMitigated ? '#ffb300' : '#26a69a',
            background: isMitigated ? 'rgba(255,179,0,0.1)' : 'rgba(38,166,154,0.1)',
            padding: '2px 8px',
            borderRadius: '4px',
            textTransform: 'uppercase',
            fontSize: '10px'
          }}>
            {isMitigated ? 'Mitigated' : 'Active'}
          </span>
        </div>
        {isMitigated && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#b2b5be' }}>Mitigated At:</span>
              <span style={{ fontFamily: 'monospace' }}>{formatEpoch(cand.mitigationTime)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#b2b5be' }}>Mitigated Price:</span>
              <span style={{ fontFamily: 'monospace' }}>{cand.mitigationPrice?.toFixed(2)}</span>
            </div>
          </>
        )}
        {cand.mfe !== undefined && cand.mfe !== null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#b2b5be' }}>Max Favorable Excursion (MFE):</span>
            <span style={{ fontFamily: 'monospace', color: '#26a69a' }}>+{cand.mfe.toFixed(2)}</span>
          </div>
        )}
        {cand.mae !== undefined && cand.mae !== null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#b2b5be' }}>Max Adverse Excursion (MAE):</span>
            <span style={{ fontFamily: 'monospace', color: '#ef5350' }}>-{cand.mae.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Market Context Snapshot */}
      {cand.context && (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '12px', 
          background: 'rgba(0,0,0,0.2)', 
          padding: '12px', 
          borderRadius: '8px', 
          border: '1px solid rgba(255, 255, 255, 0.04)',
          maxHeight: '260px',
          overflowY: 'auto'
        }}>
          <span style={{ fontSize: '11px', color: '#b2b5be', fontWeight: 600 }}>Market Context Snapshot</span>

          {/* Time Context */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#b2b5be' }}>Session:</span>
            <strong>{cand.context.time_session || 'N/A'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#b2b5be' }}>Premium / Discount:</span>
            <span style={{ 
              fontWeight: 600, 
              color: cand.context.price_premium_discount_status > 0.5 ? '#ef5350' : '#26a69a' 
            }}>
              {cand.context.price_premium_discount_status !== null 
                ? `${(cand.context.price_premium_discount_status * 100).toFixed(0)}% (${cand.context.price_premium_discount_status > 0.5 ? 'Premium' : 'Discount'})`
                : 'N/A'}
            </span>
          </div>

          {/* Timeframe Biases */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
            <span style={{ color: '#b2b5be', fontSize: '11px' }}>MTF Bias (SMA 50):</span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {['1m', '5m', '15m', '1h', '4h', 'daily'].map((tf) => {
                const val = cand.context[`structure_bias_${tf}`];
                const bg = val === 1 ? 'rgba(38,166,154,0.15)' : val === -1 ? 'rgba(239,83,80,0.15)' : 'rgba(255,255,255,0.05)';
                const fg = val === 1 ? '#26a69a' : val === -1 ? '#ef5350' : '#787b86';
                return (
                  <span key={tf} style={{ 
                    fontSize: '9px', 
                    fontWeight: 'bold', 
                    background: bg, 
                    color: fg, 
                    padding: '2px 6px', 
                    borderRadius: '4px',
                    border: `1px solid ${val === 1 ? 'rgba(38,166,154,0.3)' : val === -1 ? 'rgba(239,83,80,0.3)' : 'rgba(255,255,255,0.08)'}`
                  }}>
                    {tf.toUpperCase()}: {val === 1 ? 'BULL' : val === -1 ? 'BEAR' : 'NEUT'}
                  </span>
                );
              })}
            </div>
          </div>

          {/* HTF / LTF Nesting & Structure */}
          {cand.context.htf_structure_event_id && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
              <span style={{ color: '#b2b5be' }}>HTF Structure Event:</span>
              <span style={{ fontSize: '10px', color: '#ff9800', fontFamily: 'monospace' }}>
                {cand.context.htf_structure_event_id.split('_')[0].toUpperCase()}
              </span>
            </div>
          )}
          {cand.context.ltf_structure_event_id && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
              <span style={{ color: '#b2b5be' }}>LTF Structure Event:</span>
              <span style={{ fontSize: '10px', color: '#2962ff', fontFamily: 'monospace' }}>
                {cand.context.ltf_structure_event_id.split('_')[0].toUpperCase()}
              </span>
            </div>
          )}

          {/* Nearest Extremes */}
          {(cand.context.nearest_htf_high !== null || cand.context.nearest_htf_low !== null) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ color: '#b2b5be', fontSize: '10px', fontWeight: 600 }}>Nearest HTF Swing Points:</span>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', paddingLeft: '8px' }}>
                <span style={{ color: '#787b86' }}>HTF High:</span>
                <span style={{ fontFamily: 'monospace' }}>{cand.context.nearest_htf_high?.toFixed(2) || 'N/A'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', paddingLeft: '8px' }}>
                <span style={{ color: '#787b86' }}>HTF Low:</span>
                <span style={{ fontFamily: 'monospace' }}>{cand.context.nearest_htf_low?.toFixed(2) || 'N/A'}</span>
              </div>
            </div>
          )}

          {/* Nearest Active Liquidity & Imbalances */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ color: '#b2b5be', fontSize: '10px', fontWeight: 600 }}>Nearest Target Levels:</span>
            {cand.context.nearest_bsl_price && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', paddingLeft: '8px' }}>
                <span style={{ color: '#787b86' }}>BSL Pool:</span>
                <span style={{ fontFamily: 'monospace', color: '#26a69a' }}>{cand.context.nearest_bsl_price.toFixed(2)}</span>
              </div>
            )}
            {cand.context.nearest_ssl_price && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', paddingLeft: '8px' }}>
                <span style={{ color: '#787b86' }}>SSL Pool:</span>
                <span style={{ fontFamily: 'monospace', color: '#ef5350' }}>{cand.context.nearest_ssl_price.toFixed(2)}</span>
              </div>
            )}
            {cand.context.nearest_fvg_price && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', paddingLeft: '8px' }}>
                <span style={{ color: '#787b86' }}>Untouched FVG:</span>
                <span style={{ fontFamily: 'monospace' }}>{cand.context.nearest_fvg_price.toFixed(2)}</span>
              </div>
            )}
            {cand.context.nearest_volume_imbalance_price && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', paddingLeft: '8px' }}>
                <span style={{ color: '#787b86' }}>Volume Imbalance:</span>
                <span style={{ fontFamily: 'monospace' }}>{cand.context.nearest_volume_imbalance_price.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Human Validation Panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span style={{ fontSize: '11px', color: '#b2b5be', fontWeight: 600 }}>Human Validation</span>
        
        {/* Notes input */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Correction notes or confirmation reasons..."
          style={{
            width: '100%',
            height: '60px',
            background: '#131722',
            border: '1px solid #2a2e39',
            borderRadius: '6px',
            color: '#fff',
            padding: '8px',
            fontSize: '12px',
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
            boxSizing: 'border-box'
          }}
        />

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={() => handleValidate('approved')}
            style={{
              flex: 1,
              height: '36px',
              background: validationStatus === 'approved' ? '#089981' : 'rgba(8, 153, 129, 0.15)',
              color: validationStatus === 'approved' ? '#fff' : '#089981',
              border: `1px solid ${validationStatus === 'approved' ? '#089981' : 'rgba(8, 153, 129, 0.3)'}`,
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s'
            }}
          >
            <Check size={14} />
            Approve
          </button>
          <button 
            onClick={() => handleValidate('rejected')}
            style={{
              flex: 1,
              height: '36px',
              background: validationStatus === 'rejected' ? '#f23645' : 'rgba(242, 54, 69, 0.15)',
              color: validationStatus === 'rejected' ? '#fff' : '#f23645',
              border: `1px solid ${validationStatus === 'rejected' ? '#f23645' : 'rgba(242, 54, 69, 0.3)'}`,
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s'
            }}
          >
            <XOctagon size={14} />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
