import React, { useState, useEffect } from 'react';
import { Search, Download, ChevronLeft, ChevronRight, RefreshCw, Calendar, Eye, Filter } from 'lucide-react';

const TIMEFRAMES = [
  { id: 1, label: '1m' },
  { id: 3, label: '3m' },
  { id: 5, label: '5m' },
  { id: 15, label: '15m' },
  { id: 30, label: '30m' },
  { id: 60, label: '1H' },
  { id: 240, label: '4H' },
  { id: 1440, label: '1D' }
];

const SESSIONS = [
  { id: 'asia', label: 'Asia Open' },
  { id: 'london', label: 'London Session' },
  { id: 'ny_am', label: 'NY AM Session' },
  { id: 'ny_pm', label: 'NY PM Session' }
];

const STATES = [
  { id: 'active', label: 'Active' },
  { id: 'mitigated', label: 'Mitigated' },
  { id: 'failed', label: 'Failed' },
  { id: 'inverted', label: 'Inverted' }
];

const FAMILIES = [
  { id: 'Swings', label: 'Fractal Swings' },
  { id: 'Liquidity', label: 'Liquidity Pools' },
  { id: 'Imbalances', label: 'Price Gaps / FVGs' },
  { id: 'Structure Breaks', label: 'Structure Shift (BOS/MSS)' },
  { id: 'Order Flow', label: 'Order Blocks (OB)' },
  { id: 'Time', label: 'Time Opens/Macros' }
];

export default function ResearchWorkspace({
  activeSymbol,
  onSelectEvent,
  onJumpToTime,
  onSwitchTab
}) {
  const [results, setResults] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Filter states
  const [search, setSearch] = useState('');
  const [checkedTfs, setCheckedTfs] = useState([]);
  const [checkedSessions, setCheckedSessions] = useState([]);
  const [checkedStates, setCheckedStates] = useState([]);
  const [checkedFamilies, setCheckedFamilies] = useState([]);

  // Sorting & Pagination
  const [sortBy, setSortBy] = useState('time_start');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [limit, setLimit] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchResults = (isExport = false) => {
    if (!isExport) setLoading(true);
    
    // Construct query parameters
    let url = `http://localhost:8080/api/research/query?symbol=${activeSymbol}`;
    
    if (checkedTfs.length > 0) url += `&timeframe=${checkedTfs.join(',')}`;
    if (checkedSessions.length > 0) url += `&session=${checkedSessions.join(',')}`;
    if (checkedStates.length > 0) url += `&state=${checkedStates.join(',')}`;
    if (checkedFamilies.length > 0) url += `&concept_family=${checkedFamilies.join(',')}`;
    if (search) url += `&search=${search}`;
    
    url += `&sortBy=${sortBy}&sortOrder=${sortOrder}`;
    
    if (isExport) {
      // Pull max records for export
      url += `&limit=50000&offset=0`;
      return fetch(url).then(res => res.json());
    } else {
      const offset = (currentPage - 1) * limit;
      url += `&limit=${limit}&offset=${offset}`;
      
      fetch(url)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setResults(data.results);
            setTotalCount(data.total);
          }
        })
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
  };

  useEffect(() => {
    setCurrentPage(1); // Reset page on filter changes
  }, [activeSymbol, checkedTfs, checkedSessions, checkedStates, checkedFamilies, search, limit, sortBy, sortOrder]);

  useEffect(() => {
    fetchResults();
  }, [activeSymbol, checkedTfs, checkedSessions, checkedStates, checkedFamilies, search, limit, sortBy, sortOrder, currentPage]);

  const handleToggleFilter = (id, type) => {
    const setters = {
      tf: [checkedTfs, setCheckedTfs],
      session: [checkedSessions, setCheckedSessions],
      state: [checkedStates, setCheckedStates],
      family: [checkedFamilies, setCheckedFamilies]
    };
    const [list, setList] = setters[type];
    if (list.includes(id)) {
      setList(list.filter(item => item !== id));
    } else {
      setList([...list, id]);
    }
  };

  const handleResetFilters = () => {
    setCheckedTfs([]);
    setCheckedSessions([]);
    setCheckedStates([]);
    setCheckedFamilies([]);
    setSearch('');
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(field);
      setSortOrder('DESC');
    }
  };

  const handleRowClick = (item) => {
    onSelectEvent(item);
    onJumpToTime(item.time);
    onSwitchTab('chart');
  };

  const handleExportCSV = async () => {
    try {
      const data = await fetchResults(true);
      if (!data.success || data.results.length === 0) {
        alert('No records available to export.');
        return;
      }
      
      const csvRows = [];
      const headers = ['Event ID', 'Concept Type', 'Timeframe', 'Direction', 'State', 'Start Time', 'Price High', 'Price Low', 'MFE', 'MAE', 'Validation'];
      csvRows.push(headers.join(','));

      data.results.forEach(r => {
        const row = [
          r.id,
          r.type.toUpperCase(),
          r.timeframe,
          r.direction,
          r.state,
          new Date(r.timeStart * 1000).toISOString(),
          r.priceHigh,
          r.priceLow,
          r.mfe || 0,
          r.mae || 0,
          r.validation ? r.validation.status : 'PENDING'
        ];
        csvRows.push(row.map(val => `"${val}"`).join(','));
      });

      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `pdos_research_${activeSymbol}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(err);
      alert('CSV export failed.');
    }
  };

  const totalPages = Math.ceil(totalCount / limit) || 1;

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
      
      {/* Filters Sidebar */}
      <div style={{ width: '280px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: '#1c2030', flexShrink: 0 }}>
        
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={14} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontSize: '13px', fontWeight: 700 }}>Query Filters</h3>
          </div>
          <button onClick={handleResetFilters} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
            Reset All
          </button>
        </div>

        {/* Scrollable Filters List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Timeframe */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Timeframes</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {TIMEFRAMES.map(tf => {
                const checked = checkedTfs.includes(tf.id);
                return (
                  <button
                    key={tf.id}
                    onClick={() => handleToggleFilter(tf.id, 'tf')}
                    style={{
                      height: '26px',
                      background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.03)',
                      color: checked ? '#fff' : 'var(--text)',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'background 0.2s'
                    }}
                  >
                    {tf.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Concept Families */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Concept Group</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {FAMILIES.map(f => {
                const checked = checkedFamilies.includes(f.id);
                return (
                  <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', cursor: 'pointer', padding: '4px 0' }}>
                    <input 
                      type="checkbox" 
                      checked={checked} 
                      onChange={() => handleToggleFilter(f.id, 'family')}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} 
                    />
                    <span style={{ color: checked ? '#fff' : 'var(--text)' }}>{f.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* States */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Lifecycle State</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {STATES.map(s => {
                const checked = checkedStates.includes(s.id);
                return (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', cursor: 'pointer', padding: '4px 0' }}>
                    <input 
                      type="checkbox" 
                      checked={checked} 
                      onChange={() => handleToggleFilter(s.id, 'state')}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} 
                    />
                    <span style={{ color: checked ? '#fff' : 'var(--text)' }}>{s.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Sessions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Trading Session</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {SESSIONS.map(se => {
                const checked = checkedSessions.includes(se.id);
                return (
                  <label key={se.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', cursor: 'pointer', padding: '4px 0' }}>
                    <input 
                      type="checkbox" 
                      checked={checked} 
                      onChange={() => handleToggleFilter(se.id, 'session')}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} 
                    />
                    <span style={{ color: checked ? '#fff' : 'var(--text)' }}>{se.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main Table Panel */}
      <div style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
        
        {/* Table Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Market Research Console</h2>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
              {totalCount.toLocaleString()} events matching
            </span>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {/* Search Input */}
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="text" 
                placeholder="Find Event ID..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  height: '32px',
                  background: '#1c2030',
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
            
            <button onClick={handleExportCSV} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--accent)', color: '#fff', border: 'none', height: '32px', padding: '0 14px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
              <Download size={14} />
              Export CSV
            </button>
          </div>
        </div>

        {/* Query Results Table Grid */}
        <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: '8px', background: '#1c2030' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#131722', borderBottom: '1px solid var(--border)', height: '36px', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0 16px', cursor: 'pointer' }} onClick={() => handleSort('event_id')}>Event ID</th>
                <th style={{ padding: '0 16px', cursor: 'pointer' }} onClick={() => handleSort('concept_type')}>Type</th>
                <th style={{ padding: '0 16px', cursor: 'pointer' }} onClick={() => handleSort('timeframe')}>TF</th>
                <th style={{ padding: '0 16px', cursor: 'pointer' }} onClick={() => handleSort('concept_state')}>State</th>
                <th style={{ padding: '0 16px', cursor: 'pointer' }} onClick={() => handleSort('time_start')}>Created (EST)</th>
                <th style={{ padding: '0 16px', cursor: 'pointer' }} onClick={() => handleSort('price_high')}>Price Range</th>
                <th style={{ padding: '0 16px', cursor: 'pointer' }} onClick={() => handleSort('mfe')}>MFE</th>
                <th style={{ padding: '0 16px', cursor: 'pointer' }} onClick={() => handleSort('mae')}>MAE</th>
                <th style={{ padding: '0 16px', cursor: 'pointer' }} onClick={() => handleSort('validation_status')}>Validation</th>
                <th style={{ width: '60px', textAlign: 'center' }}>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <RefreshCw className="animate-spin" size={18} style={{ display: 'inline', marginRight: '8px' }} />
                    Running SQLite Query...
                  </td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No historical events match the specified query filters.
                  </td>
                </tr>
              ) : (
                results.map((item) => {
                  const isBullish = item.direction === 'bullish' || item.direction === 'bsl' || item.direction === 'eqh' || item.direction === 'reqh';
                  const validation = item.validation?.status;

                  return (
                    <tr 
                      key={item.id} 
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', height: '36px' }}
                      className="research-table-row"
                    >
                      <td style={{ padding: '0 16px', fontFamily: 'monospace', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '160px' }} title={item.id}>
                        {item.id}
                      </td>
                      <td style={{ padding: '0 16px', fontWeight: 600 }}>
                        <span style={{ color: isBullish ? '#089981' : '#f23645', marginRight: '4px' }}>
                          {isBullish ? '▲' : '▼'}
                        </span>
                        {item.type.toUpperCase()}
                      </td>
                      <td style={{ padding: '0 16px' }}>{item.timeframe}m</td>
                      <td style={{ padding: '0 16px' }}>
                        <span style={{ 
                          fontSize: '10px', 
                          fontWeight: 600,
                          color: item.state === 'active' ? '#089981' : item.state === 'mitigated' ? '#ffb300' : item.state === 'failed' ? '#f23645' : '#2962ff'
                        }}>
                          {item.state.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '0 16px' }}>{formatEpoch(item.timeStart)}</td>
                      <td style={{ padding: '0 16px', fontFamily: 'monospace' }}>
                        {item.priceHigh.toFixed(2)} - {item.priceLow.toFixed(2)}
                      </td>
                      <td style={{ padding: '0 16px', color: '#089981', fontFamily: 'monospace' }}>
                        +{item.mfe?.toFixed(2) || '0.00'}
                      </td>
                      <td style={{ padding: '0 16px', color: '#f23645', fontFamily: 'monospace' }}>
                        -{item.mae?.toFixed(2) || '0.00'}
                      </td>
                      <td style={{ padding: '0 16px' }}>
                        {validation ? (
                          <span style={{ 
                            fontSize: '9px', 
                            fontWeight: 'bold', 
                            color: validation === 'approved' ? '#089981' : '#f23645',
                            background: validation === 'approved' ? 'rgba(8,153,129,0.1)' : 'rgba(242,54,69,0.1)',
                            padding: '1px 6px',
                            borderRadius: '4px'
                          }}>
                            {validation.toUpperCase()}
                          </span>
                        ) : (
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>PENDING</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button 
                          onClick={() => handleRowClick(item)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                          title="Open on Chart & Inspector"
                        >
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
          <div>
            <span>Show: </span>
            <select 
              value={limit} 
              onChange={(e) => setLimit(Number(e.target.value))}
              style={{ background: '#1c2030', border: '1px solid #2a2e39', color: '#fff', borderRadius: '4px', padding: '2px 6px', outline: 'none' }}
            >
              <option value={25}>25 rows</option>
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <span>Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong></span>
            
            <div style={{ display: 'flex', gap: '4px' }}>
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} 
                disabled={currentPage === 1}
                style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', height: '26px', width: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', color: '#fff', opacity: currentPage === 1 ? 0.3 : 1 }}
              >
                <ChevronLeft size={14} />
              </button>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} 
                disabled={currentPage === totalPages}
                style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', height: '26px', width: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', color: '#fff', opacity: currentPage === totalPages ? 0.3 : 1 }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
