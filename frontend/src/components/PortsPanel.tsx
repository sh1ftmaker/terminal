// Ports & shares on the session browser screen: pending share requests from
// agent accounts (approve/deny), every listening port grouped by account
// with its service name, tunnels publishing it, the private proxy link, and
// the public share state (time left, stop). Polls while mounted.

import { useEffect, useState } from 'react';
import { openExternal } from '../lib/openExternal';
import {
  approveRequest, createShare, denyRequest, fetchOverview, remainingLabel, revokeShare, setPortLabel,
  type Overview, type PortRow, type ShareRequest,
} from '../lib/share';

const CONTEXT_COLORS: Record<string, string> = {
  admin: '#a0aec0', work: '#f6ad55', john: '#4fd1c5', untrusted: '#fc8181', tom: '#b794f4',
};
const colorOf = (ctx: string | null) => (ctx && CONTEXT_COLORS[ctx]) || '#718096';

function ago(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function durLabel(minutes: number): string {
  return minutes < 60 ? `${minutes}m` : minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function Pill({ color, children, title, onClick }: { color: string; children: React.ReactNode; title?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      onClick={onClick}
      title={title}
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap"
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}55`, cursor: onClick ? 'pointer' : undefined }}
    >
      {children}
    </Tag>
  );
}

export default function PortsPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem('terminal.portsOpen') !== '0'; } catch { return true; } });
  const [showSystem, setShowSystem] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ port: number; value: string } | null>(null);
  const [, setTick] = useState(0);

  const refresh = async () => {
    try { setData(await fetchOverview()); setError(null); } catch (e) { setError((e as Error).message); }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, open ? 5000 : 15000);
    const tick = setInterval(() => setTick((t) => t + 1), 30000);
    return () => { clearInterval(id); clearInterval(tick); };
  }, [open]);

  useEffect(() => { try { localStorage.setItem('terminal.portsOpen', open ? '1' : '0'); } catch { /* private mode */ } }, [open]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const pending = data?.requests.filter((r) => r.status === 'pending') ?? [];
  const contexts = data?.contexts ?? [];
  const ports = data?.ports ?? [];
  const isSystem = (p: PortRow) => p.context === null && (p.uid < 1000 || p.uid === -1 && !p.user);
  const groups: Array<{ key: string; title: string; color: string; rows: PortRow[] }> = [];
  for (const c of contexts) {
    const rows = ports.filter((p) => p.context === c.name);
    if (rows.length) groups.push({ key: c.name, title: c.label || c.name, color: colorOf(c.name), rows });
  }
  const otherUsers = [...new Set(ports.filter((p) => p.context === null && !isSystem(p)).map((p) => p.user || String(p.uid)))];
  for (const u of otherUsers) groups.push({ key: `u:${u}`, title: u, color: '#718096', rows: ports.filter((p) => p.context === null && !isSystem(p) && (p.user || String(p.uid)) === u) });
  const systemRows = ports.filter(isSystem);
  const socketTunnels = (data?.tunnels ?? []).filter((t) => t.port === null);
  const sharedCount = data?.shares.length ?? 0;

  const privateUrl = (port: number) => `${window.location.origin}/lp/${port}/`;

  const requestCard = (r: ShareRequest) => (
    <div key={r.id} className="rounded-lg p-3 mb-2" style={{ background: '#2a2340', border: '1px solid #f6ad5566' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <Pill color={colorOf(r.account)}>{r.account ?? 'unknown'}</Pill>
        <span className="font-mono text-white text-sm">:{r.port}</span>
        <span className="text-slate-200 text-sm truncate">{r.label || ports.find((p) => p.port === r.port)?.name || ''}</span>
        {!r.listening && <Pill color="#fc8181" title="Nothing is listening on this port right now">not listening</Pill>}
      </div>
      <div className="text-xs text-slate-400 mt-1">
        asks for {durLabel(r.minutes)} · {ago(r.createdAt)}{r.session ? ` · session ${r.session}` : ''}
      </div>
      <div className="flex gap-2 mt-2 flex-wrap">
        <button disabled={busy !== null} onClick={() => act(r.id, () => approveRequest(r.id))}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#4fd1c5] text-[#1a1a2e] hover:bg-[#38b2a8]">
          Approve {durLabel(r.minutes)}
        </button>
        {[60, 480].filter((m) => m !== r.minutes && m <= (data?.maxMinutes ?? 1440)).map((m) => (
          <button key={m} disabled={busy !== null} onClick={() => act(r.id, () => approveRequest(r.id, m))}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#2d2d4a] text-slate-200 hover:bg-[#353555]">
            {durLabel(m)}
          </button>
        ))}
        <button disabled={busy !== null} onClick={() => act(r.id, () => denyRequest(r.id))}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#2d2d4a] text-red-300 hover:bg-[#3a2d3a] ml-auto">
          Deny
        </button>
      </div>
    </div>
  );

  const row = (p: PortRow) => {
    const key = `p${p.port}`;
    const isEditing = editing?.port === p.port;
    return (
      <li key={p.port} className="px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <button
            className="font-mono text-sm text-[#4fd1c5] flex-shrink-0 hover:underline"
            title={`Open privately: ${privateUrl(p.port)}`}
            onClick={() => openExternal(privateUrl(p.port))}
          >
            :{p.port}
          </button>
          {isEditing ? (
            <input
              autoFocus value={editing.value}
              onChange={(e) => setEditing({ port: p.port, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { const v = editing.value; setEditing(null); act(key, () => setPortLabel(p.port, v)); }
                if (e.key === 'Escape') setEditing(null);
              }}
              onBlur={() => setEditing(null)}
              placeholder="name this port"
              className="flex-1 min-w-0 px-2 py-0.5 rounded bg-[#1a1a2e] border border-[#4fd1c5] text-white text-sm outline-none"
            />
          ) : (
            <button
              className="text-white text-sm truncate text-left flex-1 min-w-0"
              title={`${p.command || p.process || ''}${p.unit ? ` · ${p.unit}` : ''}${p.pid ? ` · pid ${p.pid}` : ''}\nclick to rename`}
              onClick={() => setEditing({ port: p.port, value: p.label || '' })}
            >
              {p.name}
            </button>
          )}
          {p.share ? (
            <Pill color="#68d391" title={`Public at ${p.share.url || privateUrl(p.port)} — click to copy`}
              onClick={() => { navigator.clipboard?.writeText(p.share?.url || privateUrl(p.port)).catch(() => {}); }}>
              public · {remainingLabel(p.share.expiresAt)}
            </Pill>
          ) : p.request ? (
            <Pill color="#f6ad55">requested</Pill>
          ) : null}
          {p.share ? (
            <button disabled={busy !== null} title="Stop sharing" onClick={() => act(key, () => revokeShare(p.port))}
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-red-300 bg-[#2d2d4a] hover:bg-[#3a2d3a] flex-shrink-0">stop</button>
          ) : (
            <button disabled={busy !== null} title={`Share publicly for ${data?.defaultMinutes ?? 60} min`}
              onClick={() => act(key, () => createShare(p.port, undefined, p.label || undefined))}
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-slate-300 bg-[#2d2d4a] hover:bg-[#353555] flex-shrink-0">share</button>
          )}
        </div>
        {(p.tunnels.length > 0 || p.unit || !p.loopbackOnly) && (
          <div className="flex items-center gap-1.5 flex-wrap mt-1 pl-1">
            {p.tunnels.map((t, i) => (
              <Pill key={i} color="#b794f4" title={`${t.hostname ?? 'quick tunnel'} → ${t.target}${t.config ? `\n${t.config}` : ''}`}
                onClick={t.hostname ? () => openExternal(`https://${t.hostname}`) : undefined}>
                ⇡ {t.hostname ?? 'quick tunnel'}
              </Pill>
            ))}
            {p.unit && <span className="text-[10px] text-slate-500 truncate" title="systemd unit">{p.unit}</span>}
            {!p.loopbackOnly && <span className="text-[10px] text-slate-500" title={`Bound to ${p.bind} — reachable on the LAN`}>LAN</span>}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="mt-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-1 py-1 text-left">
        <span className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
          Ports &amp; shares
          {pending.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] bg-[#f6ad55] text-[#1a1a2e]">{pending.length} request{pending.length > 1 ? 's' : ''}</span>
          )}
          {sharedCount > 0 && <span className="ml-2 text-[10px] text-[#68d391]">{sharedCount} public</span>}
        </span>
        <svg className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {!open && pending.length > 0 && <div className="mt-1">{pending.map(requestCard)}</div>}
      {open && (
        <div className="mt-1">
          {error && <div className="text-red-400 text-xs mb-2">{error}</div>}
          {pending.map(requestCard)}
          {!data ? (
            <div className="text-slate-500 text-xs px-1 py-2">Loading…</div>
          ) : (
            <div className="bg-[#252540] rounded-lg overflow-hidden border border-[#2d2d4a]">
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-bold" style={{ color: g.color, background: `${g.color}11` }}>{g.title}</div>
                  <ul className="divide-y divide-[#2d2d4a]">{g.rows.map(row)}</ul>
                </div>
              ))}
              {systemRows.length > 0 && (
                <div>
                  <button onClick={() => setShowSystem((s) => !s)} className="w-full text-left px-3 py-1.5 text-[10px] uppercase tracking-wide font-bold text-slate-500 bg-[#ffffff08]">
                    system · {systemRows.length} {showSystem ? '▾' : '▸'}
                  </button>
                  {showSystem && <ul className="divide-y divide-[#2d2d4a]">{systemRows.map(row)}</ul>}
                </div>
              )}
              {groups.length === 0 && systemRows.length === 0 && <div className="text-slate-500 text-xs px-3 py-3">No listening ports found.</div>}
              {socketTunnels.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-bold text-slate-500 bg-[#ffffff08]">tunnels to sockets</div>
                  <ul className="divide-y divide-[#2d2d4a]">
                    {socketTunnels.map((t, i) => (
                      <li key={i} className="px-3 py-2 flex items-center gap-2 text-xs">
                        <Pill color="#b794f4" onClick={t.hostname ? () => openExternal(`https://${t.hostname}`) : undefined}>⇡ {t.hostname ?? 'quick tunnel'}</Pill>
                        <span className="text-slate-400 truncate" title={t.config ?? ''}>{t.target}</span>
                        {t.context && <Pill color={colorOf(t.context)}>{t.context}</Pill>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
