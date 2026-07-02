import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  Cpu, 
  Database, 
  Terminal, 
  RefreshCw, 
  Play, 
  Pause, 
  Search, 
  Trash2, 
  Clock, 
  Layers, 
  AlertTriangle,
  HardDrive,
  FileText
} from 'lucide-react';

export default function DiagnosticsWorkspace({ activeSymbol }) {
  const [telemetry, setTelemetry] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logLimit, setLogLimit] = useState(100);
  const [logSearch, setLogSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const consoleEndRef = useRef(null);

  // Fetch telemetry from server
  const fetchTelemetry = async () => {
    try {
      const res = await fetch('/api/diagnostics/telemetry');
      if (!res.ok) throw new Error('Failed to fetch telemetry');
      const data = await res.json();
      if (data.success) {
        setTelemetry(data);
        setError(null);
      } else {
        setError(data.error);
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  // Fetch logs from server
  const fetchLogs = async () => {
    try {
      const res = await fetch(`/api/diagnostics/logs?limit=${logLimit}`);
      if (!res.ok) throw new Error('Failed to fetch system logs');
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRefreshAll = async () => {
    setLoading(true);
    await Promise.all([fetchTelemetry(), fetchLogs()]);
    setLoading(false);
  };

  // Periodic updates
  useEffect(() => {
    handleRefreshAll();
  }, [logLimit]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchTelemetry();
      fetchLogs();
    }, 2000);
    return () => clearInterval(interval);
  }, [autoRefresh, logLimit]);

  // Scroll to bottom of logs when logs update
  useEffect(() => {
    if (autoScrollLogs && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScrollLogs]);

  // Helper formatting functions
  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds) => {
    if (!seconds) return '0s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs}h ${mins}m ${secs}s`;
  };

  // Color code log lines
  const parseLogLine = (line) => {
    // Format is usually: [TIMESTAMP] [LEVEL] [MODULE] message
    // e.g. [2026-06-25T12:00:00.000Z] [INFO] [SERVER] Server running...
    const matches = line.match(/^\[(.*?)\]\s+\[(.*?)\]\s+\[(.*?)\]\s+(.*)$/);
    if (matches) {
      return {
        timestamp: matches[1],
        level: matches[2],
        module: matches[3],
        message: matches[4],
        raw: line
      };
    }
    return {
      timestamp: '',
      level: line.includes('WARN') ? 'WARN' : line.includes('ERROR') ? 'ERROR' : 'INFO',
      module: 'SYSTEM',
      message: line,
      raw: line
    };
  };

  const getLogLevelColor = (level) => {
    switch (level?.toUpperCase()) {
      case 'ERROR': return '#f23645'; // red
      case 'WARN': return '#ffb300'; // yellow
      case 'DEBUG': return '#787b86'; // gray
      case 'SUCCESS': return '#089981'; // green
      case 'INFO':
      default: return '#2962ff'; // blue
    }
  };

  const filteredLogs = logs.filter(line => {
    if (!logSearch) return true;
    return line.toLowerCase().includes(logSearch.toLowerCase());
  });

  // Calculate memory percentages
  const memUsed = telemetry?.memory?.heapUsed || 0;
  const memTotal = telemetry?.memory?.heapTotal || 1;
  const memRss = telemetry?.memory?.rss || 0;
  const memoryPercentage = Math.min(100, Math.round((memUsed / memTotal) * 100));

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      background: '#131722',
      color: '#d1d4dc',
      padding: '16px',
      boxSizing: 'border-box',
      gap: '16px',
      overflow: 'auto'
    }}>
      {/* Header controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity style={{ color: 'var(--accent)' }} size={20} />
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#fff' }}>
            System Diagnostics & Performance
          </h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            Auto-refresh (2s)
          </label>
          <button
            onClick={handleRefreshAll}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#1c2030',
              border: '1px solid var(--border)',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={14} />
            Force Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(242, 54, 69, 0.1)',
          border: '1px solid #f23645',
          borderRadius: '6px',
          padding: '12px',
          fontSize: '12px',
          color: '#f23645',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <AlertTriangle size={16} />
          <strong>Error connecting to telemetry service:</strong> {error}
        </div>
      )}

      {/* Resource Cards & Profiler Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', flexShrink: 0 }}>
        
        {/* Core Resource Gauges */}
        <div style={{
          background: '#1c2030',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
            <Cpu size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Runtime Engine Status</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Engine Uptime</span>
              <strong style={{ color: '#fff' }}>{telemetry ? formatUptime(telemetry.uptime) : 'N/A'}</strong>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Node V8 Heap Memory</span>
                <span style={{ color: '#fff', fontSize: '11px' }}>
                  {telemetry ? `${formatBytes(memUsed)} / ${formatBytes(memTotal)}` : 'N/A'} ({memoryPercentage}%)
                </span>
              </div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', 
                  width: `${memoryPercentage}%`, 
                  background: memoryPercentage > 85 ? '#f23645' : memoryPercentage > 60 ? '#ffb300' : '#089981',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Total Resident Set (RSS)</span>
              <strong style={{ color: '#fff' }}>{telemetry ? formatBytes(memRss) : 'N/A'}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Active Worker Sync Thread</span>
              <strong style={{ color: telemetry?.syncTelemetry ? '#ffb300' : '#089981' }}>
                {telemetry?.syncTelemetry?.inProgress ? 'RUNNING (Worker)' : 'IDLE (Awaiting Data)'}
              </strong>
            </div>
          </div>
        </div>

        {/* SQLite Database Stats */}
        <div style={{
          background: '#1c2030',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
            <Database size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Database Metadata & Volume</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Total Structure Events</span>
              <strong style={{ color: '#fff' }}>{telemetry?.dbStats?.totalEvents?.toLocaleString() || '0'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Event Relationships</span>
              <strong style={{ color: '#fff' }}>{telemetry?.dbStats?.relationships?.toLocaleString() || '0'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Human Valids / Corrections</span>
              <strong style={{ color: '#fff' }}>{telemetry?.dbStats?.validations?.toLocaleString() || '0'}</strong>
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px', marginTop: '2px' }}>
              <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Distribution by Category:</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {telemetry?.dbStats?.familyCounts && Object.keys(telemetry.dbStats.familyCounts).length > 0 ? (
                  Object.entries(telemetry.dbStats.familyCounts).map(([fam, count]) => (
                    <span 
                      key={fam}
                      style={{
                        background: '#131722',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '10px',
                        color: 'var(--text-muted)'
                      }}
                    >
                      {fam}: <strong style={{ color: '#fff' }}>{count}</strong>
                    </span>
                  ))
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '11px' }}>No events in database.</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sync Profiler Timings */}
        <div style={{
          background: '#1c2030',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
            <Layers size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Pipeline Execution Profiler</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
            {telemetry?.syncTelemetry?.stages ? (
              Object.entries(telemetry.syncTelemetry.stages).map(([stageName, stageData]) => (
                <div key={stageName} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ textTransform: 'capitalize', color: 'var(--text-muted)' }}>
                      {stageName.replace(/([A-Z])/g, ' $1')}
                    </span>
                    <strong style={{ color: '#fff', fontFamily: 'monospace' }}>
                      {stageData.durationMs?.toFixed(1) || '0.0'} ms
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                    <span>Processed: {stageData.itemsCount || 0} items</span>
                    {stageData.speedRate ? <span>{stageData.speedRate.toFixed(1)} op/ms</span> : null}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0', fontStyle: 'italic' }}>
                No sync events executed in the current session. Run a sync from the chart terminal to generate telemetry profiles.
              </div>
            )}
          </div>
        </div>

        {/* API Response Latencies */}
        <div style={{
          background: '#1c2030',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
            <Clock size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>API Endpoint Response Speeds</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', maxHeight: '150px', overflowY: 'auto' }}>
            {telemetry?.apiLatencies && telemetry.apiLatencies.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '11px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-muted)', height: '24px' }}>
                    <th>Path</th>
                    <th>Method</th>
                    <th style={{ textAlign: 'right' }}>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry.apiLatencies.slice(-5).reverse().map((lat, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', height: '24px' }}>
                      <td style={{ fontFamily: 'monospace' }}>{lat.path}</td>
                      <td>{lat.method}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: lat.duration > 200 ? '#f23645' : lat.duration > 50 ? '#ffb300' : '#089981' }}>
                        {lat.duration} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0', fontStyle: 'italic' }}>
                Waiting for API requests to generate metrics...
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Live System Logging Console Terminal */}
      <div style={{
        flex: 1,
        background: '#1c2030',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Terminal Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#131722',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Terminal size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>PDOS System Logger Console (pdos_system.log)</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Search filter */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={12} style={{ position: 'absolute', left: '8px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Filter logs..."
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                style={{
                  background: '#131722',
                  border: '1px solid var(--border)',
                  color: '#fff',
                  borderRadius: '4px',
                  padding: '4px 8px 4px 26px',
                  fontSize: '11px',
                  outline: 'none',
                  width: '160px'
                }}
              />
            </div>

            {/* Line limit */}
            <select
              value={logLimit}
              onChange={(e) => setLogLimit(Number(e.target.value))}
              style={{
                background: '#131722',
                border: '1px solid var(--border)',
                color: '#fff',
                borderRadius: '4px',
                padding: '4px',
                fontSize: '11px',
                outline: 'none'
              }}
            >
              <option value={50}>Last 50 lines</option>
              <option value={100}>Last 100 lines</option>
              <option value={250}>Last 250 lines</option>
            </select>

            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoScrollLogs}
                onChange={(e) => setAutoScrollLogs(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              Auto-scroll
            </label>

            <button
              onClick={() => setLogs([])}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px'
              }}
              title="Clear Local View"
            >
              <Trash2 size={12} />
              Clear
            </button>
          </div>
        </div>

        {/* Terminal Body Console View */}
        <div style={{
          flex: 1,
          padding: '12px 16px',
          overflowY: 'auto',
          fontFamily: '"Fira Code", monospace, "SFMono-Regular", Consolas',
          fontSize: '11px',
          lineHeight: '1.6',
          background: '#0d0f14',
          color: '#a9b2c3'
        }}>
          {filteredLogs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>
              No system log records matching filters.
            </div>
          ) : (
            filteredLogs.map((line, idx) => {
              const log = parseLogLine(line);
              const color = getLogLevelColor(log.level);

              return (
                <div key={idx} style={{
                  display: 'flex',
                  borderBottom: '1px solid rgba(255,255,255,0.01)',
                  padding: '2px 0',
                  gap: '12px',
                  alignItems: 'flex-start'
                }}>
                  {/* Timestamp */}
                  <span style={{ color: '#5c6370', flexShrink: 0, width: '135px' }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}
                  </span>

                  {/* Level label */}
                  <span style={{
                    color: color,
                    fontWeight: 'bold',
                    flexShrink: 0,
                    width: '60px',
                    textAlign: 'left'
                  }}>
                    [{log.level}]
                  </span>

                  {/* Module name */}
                  <span style={{
                    color: '#e5c07b',
                    fontWeight: 600,
                    flexShrink: 0,
                    width: '70px',
                    textAlign: 'left'
                  }}>
                    [{log.module}]
                  </span>

                  {/* Message content */}
                  <span style={{
                    color: log.level === 'ERROR' ? '#f23645' : log.level === 'WARN' ? '#e5c07b' : '#abb2bf',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}>
                    {log.message}
                  </span>
                </div>
              );
            })
          )}
          <div ref={consoleEndRef} />
        </div>
      </div>

    </div>
  );
}
