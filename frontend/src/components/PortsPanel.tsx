// Ports & shares pane of the home screen.
//
// One card per PROCESS (grouped by pid, else by cgroup unit), under its
// account. The card's heading is the service name; its ports are the rows
// beneath, each tagged with how reachable it is:
//   local   loopback-bound, reachable only through the private proxy
//   LAN     bound to a non-loopback address
//   tunnel  published by a cloudflared tunnel (any account's — "via tom"
//           marks a tunnel run by a different account than the port's)
//   public  a time-limited share grant on share.<domain>
// Pending share requests from agent accounts sit on top with approve/deny
// (and are repeated on the Sessions pane, so they are never a tab away).

import { useCallback, useEffect, useState } from 'react';
import { pendingRequests, type OverviewState } from '../lib/useOverview';
import { ArrowUpRight, ChevronDown, CloudUpload, Globe, Square } from 'lucide-react';
import { openExternal } from '../lib/openExternal';
import { localProxyPath } from '../lib/base';
import { contextTone } from '../lib/sessions';
import {
  approveRequest, createShare, denyRequest, remainingLabel, revokeShare, setPortLabel, stopPort,
  type Overview, type PortRow, type TunnelInfo,
} from '../lib/share';
import ConfirmSheet from './ui/ConfirmSheet';
import { toast } from './ui/toast';

const TONE = { local: 'var(--ink-3)', lan: 'var(--warn)', tunnel: 'var(--violet)', public: 'var(--ok)', danger: 'var(--danger)' };

/** Inline style setting a chip's / dot's colour token. */
const tone = (name: string, value: string) => ({ [name]: value }) as React.CSSProperties;

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

interface Group {
  key: string;
  account: string;          // context name or user
  context: string | null;
  title: string;
  subtitle: string | null;
  pid: number | null;
  unit: string | null;
  ports: PortRow[];
}

// Same process (pid) or same unit → one card. Ghost rows (shares/requests
// for ports nothing listens on) stand alone.
function groupPorts(ports: PortRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of ports) {
    const account = p.context || p.user || (p.uid >= 0 ? `uid ${p.uid}` : 'unknown');
    const key = p.pid ? `pid:${p.uid}:${p.pid}` : p.cgroup ? `cg:${p.uid}:${p.cgroup}` : `port:${p.port}`;
    let g = map.get(key);
    if (!g) {
      // A real .service unit names the service; a .scope (tmux pane, app
      // launcher) is just where the process happens to run.
      const serviceUnit = p.cgroup?.endsWith('.service') ? p.unit : null;
      const title = p.label || serviceUnit || p.command || p.process || p.unit || (p.pid ? `pid ${p.pid}` : `port ${p.port}`);
      const sub = [p.command && p.command !== title ? p.command : null, p.unit && p.unit !== title ? p.unit : null, p.pid ? `pid ${p.pid}` : null].filter(Boolean).join(' · ') || null;
      g = { key, account, context: p.context, title, subtitle: sub, pid: p.pid, unit: p.unit, ports: [] };
      map.set(key, g);
    } else if (p.label && !g.ports.some((x) => x.label)) {
      g.title = p.label;
    }
    g.ports.push(p);
  }
  return [...map.values()].map((g) => ({ ...g, ports: g.ports.sort((a, b) => a.port - b.port) }));
}

function useActions(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }, [refresh]);
  return { busy, error, act };
}

// --- Pending share requests ----------------------------------------------------

export function RequestCards({ data, refresh }: { data: Overview | null; refresh: () => Promise<void> }) {
  const { busy, error, act } = useActions(refresh);
  const pending = pendingRequests(data);
  if (pending.length === 0) return null;
  const ports = data?.ports ?? [];
  return (
    <div className="flex flex-col gap-2 mb-3">
      {error && <div className="text-danger text-[13px] px-1">{error}</div>}
      {pending.map((r) => (
        <div
          key={r.id}
          className="rounded-2xl p-3.5 anim-rise"
          style={{ background: 'var(--accent-soft)', boxShadow: 'inset 0 0 0 1px var(--accent-line)' }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="chip chip-solid" style={tone('--chip', contextTone(r.account))}>{r.account ?? 'unknown'}</span>
            <span className="text-[15px] font-semibold truncate">{r.label || ports.find((p) => p.port === r.port)?.name || `port ${r.port}`}</span>
            <span className="font-mono text-ink-2 text-[13px]">:{r.port}</span>
            {!r.listening && <span className="chip" style={tone('--chip', TONE.danger)} title="Nothing is listening on this port right now">not listening</span>}
          </div>
          <div className="text-[13px] text-ink-2 mt-1">
            Wants it public for {durLabel(r.minutes)} · {ago(r.createdAt)}{r.session ? ` · from session ${r.session}` : ''}
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <button disabled={busy !== null} onClick={() => act(r.id, () => approveRequest(r.id))} className="btn btn-sm btn-primary">
              Approve {durLabel(r.minutes)}
            </button>
            {[60, 480].filter((m) => m !== r.minutes && m <= (data?.maxMinutes ?? 1440)).map((m) => (
              <button key={m} disabled={busy !== null} onClick={() => act(r.id, () => approveRequest(r.id, m))} className="btn btn-sm">
                {durLabel(m)}
              </button>
            ))}
            <button disabled={busy !== null} onClick={() => act(r.id, () => denyRequest(r.id))} className="btn btn-sm btn-danger ml-auto">
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- The pane ---------------------------------------------------------------------

export default function PortsPanel({ data, error: loadError, refresh }: OverviewState) {
  const { busy, error: actionError, act } = useActions(refresh);
  const [showSystem, setShowSystem] = useState(false);
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [stopTarget, setStopTarget] = useState<Group | null>(null);
  const [, setTick] = useState(0);

  // Keep "42m left" labels moving between polls.
  useEffect(() => {
    const tick = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(tick);
  }, []);

  const error = actionError || loadError;
  const contexts = data?.contexts ?? [];
  const ports = data?.ports ?? [];
  const isSystem = (p: PortRow) => p.context === null && p.uid >= 0 && p.uid < 1000;
  const groups = groupPorts(ports);
  const sections: Array<{ key: string; title: string; color: string; groups: Group[] }> = [];
  for (const c of contexts) {
    const gs = groups.filter((g) => g.context === c.name);
    if (gs.length) sections.push({ key: c.name, title: c.label || c.name, color: contextTone(c.name), groups: gs });
  }
  const otherAccounts = [...new Set(groups.filter((g) => g.context === null && !g.ports.some(isSystem)).map((g) => g.account))];
  for (const a of otherAccounts) sections.push({ key: `u:${a}`, title: a, color: 'var(--ink-2)', groups: groups.filter((g) => g.context === null && g.account === a && !g.ports.some(isSystem)) });
  const systemGroups = groups.filter((g) => g.ports.some(isSystem));
  const socketTunnels = (data?.tunnels ?? []).filter((t) => t.port === null);
  const privateUrl = (port: number) => `${window.location.origin}${localProxyPath(port)}`;
  const reserved = new Set(data?.reservedPorts ?? []);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => toast('Public link copied')).catch(() => {});
  };

  const tunnelChip = (t: TunnelInfo, p: PortRow | null, i: number) => {
    const foreign = p ? (t.context ?? t.user) !== (p.context ?? p.user) : false;
    const via = foreign ? ` via ${t.context ?? t.user ?? `uid ${t.uid}`}` : '';
    const title = `${t.hostname ?? 'quick tunnel'} → ${t.target}${t.config ? `\n${t.config}` : ''}${foreign ? `\ntunnel runs as ${t.user ?? t.uid}` : ''}`;
    const content = <><CloudUpload size={12} className="flex-shrink-0" /> <span className="truncate">{t.hostname ?? 'quick tunnel'}{via}</span></>;
    return t.hostname
      ? <button key={i} className="chip max-w-full" style={tone('--chip', TONE.tunnel)} title={title} onClick={() => openExternal(`https://${t.hostname}`)}>{content}</button>
      : <span key={i} className="chip max-w-full" style={tone('--chip', TONE.tunnel)} title={title}>{content}</span>;
  };

  const portLine = (p: PortRow, g: Group) => {
    const key = `p${p.port}`;
    const shareUrl = p.share?.url || privateUrl(p.port);
    return (
      <div key={p.port} className="flex items-center gap-2 min-h-[46px] py-1.5 min-w-0">
        <button
          className="font-mono text-[14px] font-medium text-accent flex-shrink-0 w-[58px] text-left h-9 rounded-md active:bg-press"
          title={`Open privately (login required): ${privateUrl(p.port)}`}
          onClick={() => openExternal(privateUrl(p.port))}
        >
          :{p.port}
        </button>
        <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
          {p.share ? (
            <button className="chip chip-solid" style={tone('--chip', TONE.public)} title={`Public at ${shareUrl} — tap to copy`} onClick={() => copy(shareUrl)}>
              <Globe size={12} /> public · {remainingLabel(p.share.expiresAt)}
            </button>
          ) : p.request ? (
            <span className="chip" style={tone('--chip', 'var(--accent)')} title="A share request is pending above">share requested</span>
          ) : null}
          {p.tunnels.map((t, i) => tunnelChip(t, p, i))}
          {p.uid >= 0 && (p.loopbackOnly
            ? <button className="chip" style={tone('--chip', TONE.local)} title={`Bound to loopback — open through the private proxy: ${privateUrl(p.port)}`} onClick={() => openExternal(privateUrl(p.port))}>local <ArrowUpRight size={12} /></button>
            : <button className="chip" style={tone('--chip', TONE.lan)} title={`Bound to ${p.bind} (reachable on the LAN) — open through the private proxy: ${privateUrl(p.port)}`} onClick={() => openExternal(privateUrl(p.port))}>LAN <ArrowUpRight size={12} /></button>)}
          {p.uid < 0 && <span className="chip" style={tone('--chip', TONE.danger)} title="Nothing is listening on this port">not listening</span>}
          {g.ports.length > 1 && p.label && <span className="text-[12px] text-ink-2 truncate">{p.label}</span>}
        </div>
        {p.share ? (
          <button className="btn btn-sm btn-danger flex-shrink-0" title="Stop sharing publicly" disabled={busy !== null} onClick={() => act(key, () => revokeShare(p.port))}>
            Unshare
          </button>
        ) : p.uid >= 0 && !reserved.has(p.port) ? (
          <button
            className="btn btn-sm flex-shrink-0"
            title={`Share publicly for ${data?.defaultMinutes ?? 60} min`}
            disabled={busy !== null}
            onClick={() => act(key, () => createShare(p.port, undefined, p.label || g.title))}
          >
            Share
          </button>
        ) : null}
      </div>
    );
  };

  const processCard = (g: Group) => {
    const isEditing = editing?.key === g.key;
    const stoppable = g.ports.some((p) => p.uid >= 1000 && (p.pid || p.unit)) && !g.ports.some((p) => reserved.has(p.port));
    return (
      <div key={g.key} className="card">
        <div className="flex items-start gap-2 pl-4 pr-1.5 pt-2">
          <div className="min-w-0 flex-1 py-1.5">
            {isEditing ? (
              <input
                autoFocus value={editing.value}
                onChange={(e) => setEditing({ key: g.key, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { const v = editing.value; setEditing(null); act(g.key, () => Promise.all(g.ports.map((p) => setPortLabel(p.port, v)))); }
                  if (e.key === 'Escape') setEditing(null);
                }}
                onBlur={() => setEditing(null)}
                placeholder="Name this service"
                enterKeyHint="done"
                className="field !min-h-[38px] !py-1.5"
              />
            ) : (
              <button
                className="block text-[15px] font-semibold truncate text-left w-full leading-tight"
                title={`${g.subtitle ?? ''}\nTap to rename`}
                onClick={() => setEditing({ key: g.key, value: g.ports[0]?.label || '' })}
              >
                {g.title}
              </button>
            )}
            {g.subtitle && <div className="font-mono text-[11.5px] text-ink-3 truncate mt-1">{g.subtitle}</div>}
          </div>
          {stoppable && (
            <button
              className="icon-btn icon-btn-sm mt-0.5"
              style={{ color: 'var(--danger)' }}
              title={`Stop ${g.title}${g.pid ? ` (pid ${g.pid})` : ''}`}
              aria-label={`Stop ${g.title}`}
              disabled={busy !== null}
              onClick={() => setStopTarget(g)}
            >
              <Square size={15} fill="currentColor" strokeWidth={0} />
            </button>
          )}
        </div>
        <div className="pl-4 pr-2.5 pb-1.5 divide-y divide-line">
          {g.ports.map((p) => portLine(p, g))}
        </div>
      </div>
    );
  };

  const sectionHeader = (title: string, color: string, count: number, extra?: React.ReactNode) => (
    <div className="flex items-center gap-2 px-1 pt-4 pb-2">
      <span className="status-dot" style={tone('--tone', color)} />
      <span className="eyebrow" style={{ color }}>{title}</span>
      <span className="text-[12px] text-ink-3">{count} service{count === 1 ? '' : 's'}</span>
      {extra}
    </div>
  );

  return (
    <div>
      {error && <div className="text-danger text-[13px] mb-2 px-1">{error}</div>}
      <RequestCards data={data} refresh={refresh} />
      {!data ? (
        <div className="flex flex-col gap-2 pt-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-[88px] !rounded-2xl" />)}
        </div>
      ) : (
        <>
          {sections.map((s) => (
            <div key={s.key}>
              {sectionHeader(s.title, s.color, s.groups.length)}
              <div className="grid gap-2 sm:grid-cols-2 items-start">
                {s.groups.map((g) => processCard(g))}
              </div>
            </div>
          ))}
          {systemGroups.length > 0 && (
            <div>
              <button onClick={() => setShowSystem((v) => !v)} className="w-full text-left" aria-expanded={showSystem}>
                {sectionHeader('system', 'var(--ink-3)', systemGroups.length,
                  <ChevronDown size={16} className={`ml-auto text-ink-3 transition-transform ${showSystem ? 'rotate-180' : ''}`} />)}
              </button>
              {showSystem && <div className="grid gap-2 sm:grid-cols-2 items-start">{systemGroups.map((g) => processCard(g))}</div>}
            </div>
          )}
          {sections.length === 0 && systemGroups.length === 0 && <div className="text-ink-3 text-[14px] text-center py-10">No listening ports found.</div>}
          {socketTunnels.length > 0 && (
            <div>
              {sectionHeader('tunnels to unix sockets', TONE.tunnel, socketTunnels.length)}
              <div className="card divide-y divide-line">
                {socketTunnels.map((t, i) => (
                  <div key={i} className="px-3.5 py-2.5 flex items-center gap-2 min-w-0 flex-wrap">
                    {tunnelChip(t, null, i)}
                    <span className="text-ink-3 truncate font-mono text-[11.5px] min-w-0 flex-1" title={t.config ?? ''}>{t.target}</span>
                    {(t.context || t.user) && <span className="chip" style={tone('--chip', contextTone(t.context))}>{t.context ?? t.user}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 pt-5 text-[12px] text-ink-3">
            <span className="inline-flex items-center gap-1.5"><span className="status-dot" style={tone('--tone', TONE.local)} />local: private proxy only</span>
            <span className="inline-flex items-center gap-1.5"><span className="status-dot" style={tone('--tone', TONE.lan)} />LAN</span>
            <span className="inline-flex items-center gap-1.5"><span className="status-dot" style={tone('--tone', TONE.tunnel)} />cloudflared tunnel</span>
            <span className="inline-flex items-center gap-1.5"><span className="status-dot" style={tone('--tone', TONE.public)} />public share</span>
          </div>
        </>
      )}

      <ConfirmSheet
        open={stopTarget !== null}
        title={stopTarget ? `Stop ${stopTarget.title}?` : ''}
        confirmLabel="Stop service"
        danger
        onCancel={() => setStopTarget(null)}
        onConfirm={() => {
          const g = stopTarget;
          setStopTarget(null);
          if (g) act(g.key, () => stopPort(g.ports[0].port));
        }}
      >
        {stopTarget && (
          <>
            {stopTarget.pid ? `Process ${stopTarget.pid} will be stopped. ` : ''}
            Port{stopTarget.ports.length > 1 ? 's' : ''} {stopTarget.ports.map((p) => p.port).join(', ')} will go down.
          </>
        )}
      </ConfirmSheet>
    </div>
  );
}
