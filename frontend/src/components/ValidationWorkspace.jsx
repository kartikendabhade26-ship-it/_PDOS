import React, { useState, useEffect } from 'react';
import { Check, XOctagon, Search, RefreshCw, Calendar, FileText, Download, CheckSquare, Square, Info } from 'lucide-react';

const CHECKLIST_ITEMS = [
  { id: 'displacement', label: 'Strong Displacement (Impulse Momentum)' },
  { id: 'sweep', label: 'Liquidity Sweep (BSL/SSL Sweep Pre-condition)' },
  { id: 'mss', label: 'MSS / BOS (Market Structure Shift Confirmation)' },
  { id: 'htf', label: 'HTF Key Level Alignment (Higher Timeframe Context)' },
  { id: 'reaction', label: 'Immediate Reaction (Bounce, Hold, or Inversion)' }
];

export default function ValidationWorkspace({
  activeSymbol,
  onSelectEvent,
  onJumpToTime,
  onSwitchTab
}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pending' | 'approved' | 'rejected'
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [notes, setNotes] = useState('');
  const [validationStatus, setValidationStatus] = useState('approved');
  
  // Checklist states: { displacement: { expected: true, actual: true } }
  const [checklist, setChecklist] = useState({
    displacement: { expected: true, actual: true },
    sweep: { expected: true, actual: true },
    mss: { expected: true, actual: true },
    htf: { expected: true, actual: true },
    reaction: { expected: true, actual: true }
  });

  const fetchEvents = () => {
    setLoading(true);
    let url = `/api/research/query?symbol=${activeSymbol}&limit=250`;
    if (statusFilter === 'pending') {
      // Pending validations have no validation status in DB
      url += `&state=active,mitigated`;
    }
    
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          let rows = data.results;
          if (statusFilter === 'pending') {
            rows = rows.filter(r => !r.validation);
          } else if (statusFilter === 'approved') {
            rows = rows.filter(r => r.validation?.status === 'approved');
          } else if (statusFilter === 'rejected') {
            rows = rows.filter(r => r.validation?.status === 'rejected');
          }
          
          if (search) {
            rows = rows.filter(r => r.id.toLowerCase().includes(search.toLowerCase()) || r.type.toLowerCase().includes(search.toLowerCase()));
          }
          
          setEvents(rows);
          if (rows.length > 0 && !selectedEvent) {
            handleSelectRow(rows[0]);
          }
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEvents();
  }, [activeSymbol, statusFilter, search]);

  const handleSelectRow = (ev) => {
    setSelectedEvent(ev);
    setValidationStatus(ev.validation?.status || 'approved');
    setNotes(ev.validation?.notes || '');
    
    // Parse notes if they contain checklist metadata, or load defaults
    try {
      const parsed = JSON.parse(ev.validation?.notes || '');
      if (parsed.checklist) {
        setChecklist(parsed.checklist);
        setNotes(parsed.textNotes || '');
      } else {
        resetChecklist(ev);
      }
    } catch (e) {
      resetChecklist(ev);
    }
  };

  const resetChecklist = (ev) => {
    // Populate default checklist based on event attributes
    const hasMit = ev.isMitigated || ev.state === 'mitigated';
    const isOB = ev.type === 'ob';
    const isMSS = ev.type === 'mss' || ev.type === 'bos';
    
    setChecklist({
      displacement: { expected: isOB || isMSS, actual: isOB || isMSS },
      sweep: { expected: true, actual: true },
      mss: { expected: isMSS, actual: isMSS },
      htf: { expected: true, actual: true },
      reaction: { expected: hasMit, actual: hasMit }
    });
  };

  const handleToggleChecklist = (id, field) => {
    setChecklist(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: !prev[id][field]
      }
    }));
  };

  const handleSaveAudit = async () => {
    if (!selectedEvent) return;
    
    // Store checklist state and notes text inside JSON payload
    const notesPayload = JSON.stringify({
      checklist,
      textNotes: notes
    });

    try {
      const res = await fetch(`/api/validations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: selectedEvent.id,
          status: validationStatus,
          notes: notesPayload
        })
      });
      const data = await res.json();
      if (data.success) {
        // Update local items state
        setEvents(prev => prev.map(e => e.id === selectedEvent.id ? {
          ...e,
          validation: { status: validationStatus, notes: notesPayload }
        } : e));
        alert('Validation saved successfully!');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to save validation.');
    }
  };

  const handleJump = () => {
    if (!selectedEvent) return;
    onSelectEvent(selectedEvent);
    onJumpToTime(selectedEvent.time);
    onSwitchTab('chart');
  };

  const handleExportReport = () => {
    // Collect all audited rows
    const audited = events.filter(e => e.validation);
    if (audited.length === 0) {
      alert('No validation audits to export in the current filtered list.');
      return;
    }

    let report = `# PDOS Price Engine Validation Report\n`;
    report += `Generated on: ${new Date().toLocaleString()}\n`;
    report += `Active Symbol: ${activeSymbol.toUpperCase()}\n`;
    report += `Total Validated Events: ${audited.length}\n\n`;
    report += `| Event ID | Concept | Status | Notes |\n`;
    report += `| :--- | :--- | :--- | :--- |\n`;

    audited.forEach(e => {
      let textNotes = e.validation.notes;
      try {
        const parsed = JSON.parse(e.validation.notes);
        textNotes = parsed.textNotes || '';
      } catch (err) {}
      report += `| ${e.id} | ${e.type.toUpperCase()} | ${e.validation.status.toUpperCase()} | ${textNotes} |\n`;
    });

    // Create file download trigger
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `pdos_validation_report_${activeSymbol}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatEpoch = (epoch) => {
    if (!epoch) return 'N/A';
    return new Date(epoch * 1000).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) + ' EST';
  };

  return (
    <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 48px - 28px)', overflow: 'hidden', background: '#131722', color: '#fff' }}>
      
      {/* Left List Pane */}
      <div style={{ width: '400px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: '#1c2030' }}>
        
        {/* List Controls */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700 }}>Validation Log</h3>
            <button onClick={fetchEvents} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <RefreshCw size={14} />
            </button>
          </div>

          {/* Search bar */}
          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Search Event ID..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                height: '32px',
                background: '#131722',
                border: '1px solid #2a2e39',
                borderRadius: '4px',
                color: '#fff',
                padding: '0 10px 0 30px',
                fontSize: '12px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Status filters */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {[
              { id: 'all', label: 'All' },
              { id: 'pending', label: 'Pending' },
              { id: 'approved', label: 'Passed' },
              { id: 'rejected', label: 'Failed' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                style={{
                  flex: 1,
                  height: '24px',
                  background: statusFilter === f.id ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                  color: statusFilter === f.id ? '#fff' : 'var(--text-muted)',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* List of events */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '20px', color: 'var(--text-muted)', textAlign: 'center', fontSize: '12px' }}>Loading audits...</div>
          ) : events.length === 0 ? (
            <div style={{ padding: '20px', color: 'var(--text-muted)', textAlign: 'center', fontSize: '12px' }}>No events match filters.</div>
          ) : (
            events.map(ev => {
              const isSelected = selectedEvent?.id === ev.id;
              const hasAudit = !!ev.validation;
              const isPassed = ev.validation?.status === 'approved';

              return (
                <div
                  key={ev.id}
                  onClick={() => handleSelectRow(ev)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    background: isSelected ? 'rgba(41,98,255,0.1)' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    transition: 'background 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: isSelected ? 'var(--accent)' : '#fff' }}>
                      {ev.type.toUpperCase()}
                    </span>
                    
                    {hasAudit ? (
                      <span style={{
                        fontSize: '9px',
                        fontWeight: 'bold',
                        color: isPassed ? '#089981' : '#f23645',
                        background: isPassed ? 'rgba(8,153,129,0.1)' : 'rgba(242,54,69,0.1)',
                        padding: '1px 6px',
                        borderRadius: '4px'
                      }}>
                        {isPassed ? 'PASSED' : 'REJECTED'}
                      </span>
                    ) : (
                      <span style={{ fontSize: '9px', color: '#ffb300', background: 'rgba(255,179,0,0.1)', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                        PENDING
                      </span>
                    )}
                  </div>
                  
                  <span style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {ev.id}
                  </span>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    <span>{formatEpoch(ev.timeStart || ev.time)}</span>
                    <span style={{ fontFamily: 'monospace' }}>{ev.priceHigh?.toFixed(2)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Expected vs Actual Audit Form */}
      <div style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
        
        {selectedEvent ? (
          <>
            {/* Header details */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Validation Audit Panel</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  <span>Event: <strong>{selectedEvent.id}</strong></span>
                  <span>•</span>
                  <span>Timeframe: <strong>{selectedEvent.timeframe}m</strong></span>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleJump} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--accent)', color: '#fff', border: 'none', height: '32px', padding: '0 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  <Calendar size={14} />
                  Jump to Chart
                </button>
                <button onClick={handleExportReport} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', height: '32px', padding: '0 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  <Download size={14} />
                  Export report
                </button>
              </div>
            </div>

            {/* Checklist table */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckSquare size={16} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Expected vs Actual Checklist</span>
              </div>
              
              <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#1c2030', borderBottom: '1px solid var(--border)', height: '32px', color: 'var(--text-muted)' }}>
                      <th style={{ textAlign: 'left', paddingLeft: '16px' }}>Validation Criteria</th>
                      <th style={{ width: '120px', textAlign: 'center' }}>Expected (TV)</th>
                      <th style={{ width: '120px', textAlign: 'center' }}>Actual (PDOS)</th>
                      <th style={{ width: '120px', textAlign: 'center' }}>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CHECKLIST_ITEMS.map(item => {
                      const expectVal = checklist[item.id]?.expected;
                      const actualVal = checklist[item.id]?.actual;
                      const isMatch = expectVal === actualVal;

                      return (
                        <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', height: '40px' }}>
                          <td style={{ paddingLeft: '16px', fontWeight: 500 }}>{item.label}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button onClick={() => handleToggleChecklist(item.id, 'expected')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: expectVal ? '#089981' : 'var(--text-muted)' }}>
                              {expectVal ? <CheckSquare size={16} /> : <Square size={16} />}
                            </button>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button onClick={() => handleToggleChecklist(item.id, 'actual')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: actualVal ? '#089981' : 'var(--text-muted)' }}>
                              {actualVal ? <CheckSquare size={16} /> : <Square size={16} />}
                            </button>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{ 
                              fontSize: '10px', 
                              fontWeight: 'bold', 
                              color: isMatch ? '#089981' : '#f23645',
                              background: isMatch ? 'rgba(8,153,129,0.1)' : 'rgba(242,54,69,0.1)',
                              padding: '2px 8px',
                              borderRadius: '4px'
                            }}>
                              {isMatch ? 'MATCH' : 'MISMATCH'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Note taking & audit approval */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Audit Correction Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Describe details of validation differences, expected behavior in TV, or why this candidate was approved/rejected..."
                  style={{
                    width: '100%',
                    height: '110px',
                    background: '#1c2030',
                    border: '1px solid #2a2e39',
                    borderRadius: '8px',
                    color: '#fff',
                    padding: '12px',
                    fontSize: '12px',
                    outline: 'none',
                    resize: 'none',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Audit Decision</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#1c2030', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)', flex: 1, justifySpace: 'center' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setValidationStatus('approved')}
                      style={{
                        flex: 1,
                        height: '36px',
                        background: validationStatus === 'approved' ? '#089981' : 'transparent',
                        color: validationStatus === 'approved' ? '#fff' : '#089981',
                        border: '1px solid #089981',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px'
                      }}
                    >
                      <Check size={14} />
                      Pass
                    </button>
                    <button
                      onClick={() => setValidationStatus('rejected')}
                      style={{
                        flex: 1,
                        height: '36px',
                        background: validationStatus === 'rejected' ? '#f23645' : 'transparent',
                        color: validationStatus === 'rejected' ? '#fff' : '#f23645',
                        border: '1px solid #f23645',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px'
                      }}
                    >
                      <XOctagon size={14} />
                      Fail
                    </button>
                  </div>

                  <button
                    onClick={handleSaveAudit}
                    style={{
                      width: '100%',
                      height: '34px',
                      background: 'var(--accent)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                      marginTop: '8px'
                    }}
                  >
                    Save Validation Log
                  </button>
                </div>
              </div>
            </div>

            {/* Validation tip info */}
            <div style={{ display: 'flex', gap: '10px', background: 'rgba(41,98,255,0.06)', border: '1px solid rgba(41,98,255,0.15)', padding: '12px', borderRadius: '8px', alignItems: 'flex-start', marginTop: '10px' }}>
              <Info size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} />
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                <strong>Validation Process Guidelines:</strong> Verify that the swing bounds match high/low wick boundaries on TradingView chart. Ensure equal high/low levels conform to horizontal zones. Any validation state saved here updates the candidate's database outcome, making it instantly observable inside the Price Engine graph overlay.
              </p>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <span>Select an event from the log list to begin validation auditing.</span>
          </div>
        )}
      </div>
    </div>
  );
}
