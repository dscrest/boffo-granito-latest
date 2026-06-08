/* Shared UI primitives — global window-scoped */
const { useState, useMemo, useEffect, useRef } = React;

/* ---------- Icons (Lucide-style strokes, tiny inline SVG) ---------- */
function Icon({ name, size = 14, className = '', strokeWidth = 1.75, style }) {
  const s = size;
  const sw = strokeWidth;
  const common = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round', className, style };
  switch (name) {
    case 'dashboard': return <svg {...common}><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>;
    case 'kanban': return <svg {...common}><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="11" rx="1"/><rect x="17" y="3" width="5" height="14" rx="1"/></svg>;
    case 'orders': return <svg {...common}><path d="M3 7h18M3 12h18M3 17h18"/></svg>;
    case 'truck': return <svg {...common}><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>;
    case 'package': return <svg {...common}><path d="M12 3 21 7v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>;
    case 'factory': return <svg {...common}><path d="M3 21V10l5 3V10l5 3V6h8v15z"/><path d="M9 21v-4M13 21v-4M17 21v-4"/></svg>;
    case 'palette': return <svg {...common}><path d="M3 21h6l11-11a3 3 0 0 0-4-4L5 17z"/></svg>;
    case 'docs': return <svg {...common}><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/></svg>;
    case 'search': return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m21 21-3.5-3.5"/></svg>;
    case 'plus': return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case 'filter': return <svg {...common}><path d="M3 5h18l-7 9v6l-4-2v-4z"/></svg>;
    case 'bell': return <svg {...common}><path d="M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>;
    case 'settings': return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8L4.2 7a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
    case 'arrow-r': return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
    case 'arrow-up': return <svg {...common}><path d="M12 19V5M5 12l7-7 7 7"/></svg>;
    case 'arrow-down': return <svg {...common}><path d="M12 5v14M5 12l7 7 7-7"/></svg>;
    case 'chev-r': return <svg {...common}><path d="m9 6 6 6-6 6"/></svg>;
    case 'check': return <svg {...common}><path d="M5 13l4 4L19 7"/></svg>;
    case 'alert': return <svg {...common}><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>;
    case 'clock': return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case 'calendar': return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>;
    case 'pin': return <svg {...common}><path d="M12 21v-7M7 4h10l-1 7H8z"/></svg>;
    case 'download': return <svg {...common}><path d="M12 4v12M6 12l6 6 6-6M4 20h16"/></svg>;
    case 'invoice': return <svg {...common}><path d="M5 3h11l3 3v15H5z"/><path d="M8 8h7M8 12h8M8 16h5"/></svg>;
    case 'tile': return <svg {...common}><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/></svg>;
    case 'flag': return <svg {...common}><path d="M4 21V4h13l-2 4 2 4H4"/></svg>;
    case 'more': return <svg {...common}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
    case 'sparkline': return <svg {...common} viewBox="0 0 60 20" width={60} height={20}><polyline points="0,15 10,12 20,14 30,8 40,10 50,5 60,7"/></svg>;
    default: return null;
  }
}

/* ---------- helper formatters ---------- */
const fmt = n => new Intl.NumberFormat('en-US').format(Math.round(n || 0));
const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;

function finishClass(f) {
  const m = { 'Glossy': 'glossy', 'Matt': 'matt', 'Carving': 'carving', 'High Glossy': 'hgloss', 'Hard Matt': 'matt' };
  return m[f] || '';
}

function StageBadge({ stage }) {
  const s = STAGES.find(x => x.id === stage);
  return <span className={`stage ${s.color}`}><span className={`dot ${s.color}`}/>{s.short}</span>;
}

function ProgressBar({ value, max, color = 'accent', height = 4 }) {
  const w = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="bar" style={{ height }}>
      <i style={{ width: `${w}%`, background: color === 'accent' ? 'var(--accent)' : color }}/>
    </div>
  );
}

function SplitBar({ produced, palletized, loaded, total }) {
  const p1 = pct(loaded, total);          // green
  const p2 = pct(palletized - loaded, total); // violet
  const p3 = pct(produced - palletized, total); // blue
  return (
    <div className="bar tall" style={{ background: 'var(--panel-2)', position: 'relative' }}>
      <i style={{ width: `${p1}%`, background: 'var(--c-green)', left: 0 }}/>
      <i style={{ width: `${p2}%`, background: 'var(--c-violet)', left: `${p1}%` }}/>
      <i style={{ width: `${p3}%`, background: 'var(--c-blue)', left: `${p1 + p2}%` }}/>
    </div>
  );
}

/* ---------- Sparkline ---------- */
function Spark({ points, color = 'var(--accent)', w = 70, h = 22 }) {
  const max = Math.max(...points), min = Math.min(...points);
  const span = Math.max(1, max - min);
  const pts = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / span) * (h - 3) - 1}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <polyline points={pts} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.95"/>
    </svg>
  );
}

Object.assign(window, { Icon, fmt, pct, finishClass, StageBadge, ProgressBar, SplitBar, Spark });
