// Home: the session list, with Ports & shares as a second pane.
//
// In coordinator mode (several contexts, each a Linux account with its own
// tmux server) a context switcher sits under the header. It filters both
// panes and decides where "New session" creates one.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ellipsis, LayoutDashboard, Plus, Settings2, SquareTerminal, Trash2, UserRound, WifiOff } from 'lucide-react';
import { API } from '../lib/base';
import {
  STATUS, backgroundDetail, contextTone, sanitizeSessionName, shortAgo, statusLabel, statusOf,
  type ContextInfo, type Session,
} from '../lib/sessions';
import { useContexts } from '../lib/contexts';
import { store } from '../lib/storage';
import { pendingRequests, useOverview } from '../lib/useOverview';
import PortsPanel, { RequestCards } from './PortsPanel';
import SettingsSheet from './SettingsSheet';
import { NotificationBell } from './NotificationToggle';
import Sheet from './ui/Sheet';
import ConfirmSheet from './ui/ConfirmSheet';
import StatusTile from './ui/StatusTile';
import { toast } from './ui/toast';
import { useLongPress } from './ui/useLongPress';

interface SessionListProps {
  onSelectSession: (name: string, context?: string) => void;
  onSwitchView?: (view: 'list' | 'canvas') => void;
}

type Pane = 'sessions' | 'ports';
const PANE_KEY = 'terminal.homePane';

const chipTone = (value: string) => ({ ['--chip']: value }) as React.CSSProperties;
const toneVar = (value: string) => ({ ['--tone']: value }) as React.CSSProperties;

function SessionRow({ session, onOpen, onActions }: { session: Session; onOpen: () => void; onActions: () => void }) {
  const status = statusOf(session.meta);
  const task = session.meta?.task;
  const { handlers, consumeClick } = useLongPress(onActions);
  return (
    <li className="flex items-stretch">
      <button
        className="row-press flex-1 min-w-0 flex items-center gap-3 pl-3.5 pr-1 py-3 text-left select-none [-webkit-touch-callout:none]"
        onClick={() => { if (!consumeClick()) onOpen(); }}
        onContextMenu={(e) => { e.preventDefault(); onActions(); }}
        {...handlers}
      >
        <StatusTile status={status} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[15px] font-semibold truncate">{session.name}</span>
            {session.meta?.preview_url && <span className="chip flex-shrink-0" style={chipTone('var(--info)')} title={session.meta.preview_url}>preview</span>}
          </span>
          <span className="block text-[13px] leading-snug text-ink-2 mt-0.5 line-clamp-2">
            {status && <span className="font-medium" style={{ color: STATUS[status].tone }} title={backgroundDetail(session.meta) || undefined}>{statusLabel(session.meta, status)}</span>}
            {status && task ? <span className="text-ink-3"> · </span> : null}
            {task}
            {!status && !task && <span className="text-ink-3">Shell</span>}
          </span>
        </span>
        <span className="text-[12px] text-ink-3 tabular flex-shrink-0 self-start pt-1" title={`Last active ${new Date(session.lastAccess).toLocaleString()}`}>
          {shortAgo(session.lastAccess)}
        </span>
      </button>
      <button className="icon-btn self-center mr-1" aria-label={`Actions for ${session.name}`} onClick={onActions}>
        <Ellipsis size={20} />
      </button>
    </li>
  );
}

// "Runs as agent-work" / "Runs as you": who owns the shells in a context.
function runsAs(c: ContextInfo | undefined): string {
  if (!c) return '';
  return c.user ? `Runs as ${c.user}` : 'Runs as the server account';
}

export default function SessionList({ onSelectSession, onSwitchView }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const contexts = useContexts();
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [pane, setPane] = useState<Pane>(() => (store.get(PANE_KEY) === 'ports' ? 'ports' : 'sessions'));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<Session | null>(null);
  const [killTarget, setKillTarget] = useState<Session | null>(null);
  const [killing, setKilling] = useState(false);

  // New-session sheet
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContext, setNewContext] = useState('');
  const [newError, setNewError] = useState('');
  const [creating, setCreating] = useState(false);

  const overview = useOverview(pane === 'ports');
  const pendingCount = pendingRequests(overview.data).length;
  const multiContext = contexts.length > 0;
  // The hub always shows every context (grouped); there is no per-user filter.
  const activeContext = '';
  const activeInfo = undefined as ContextInfo | undefined;
  const failures = useRef(0);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSessions(await res.json());
      failures.current = 0;
      setOffline(false);
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
      if (++failures.current >= 2) setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const id = setInterval(fetchSessions, 3000);
    // Coming back to the app: refresh now rather than on the next tick.
    const onVisible = () => { if (document.visibilityState === 'visible') fetchSessions(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchSessions]);

  useEffect(() => { store.set(PANE_KEY, pane); }, [pane]);

  useEffect(() => { document.title = 'Terminal'; }, []);

  // Opens the sheet aimed at a context: the given one, else the one being
  // viewed, else the first (admin).
  const openNew = (context?: string) => {
    setNewName('');
    setNewError('');
    setNewContext(context || activeContext || contexts[0]?.name || '');
    setShowNew(true);
  };

  const cleanName = sanitizeSessionName(newName.trim());
  const handleCreate = async () => {
    if (creating) return;
    if (!cleanName) { setNewError('Enter a name using letters, numbers, - or _'); return; }
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName, ...(multiContext ? { context: newContext } : {}) }),
      });
      if (res.ok) {
        const { name, context } = await res.json();
        setShowNew(false);
        onSelectSession(name, context);
      } else {
        const { error } = await res.json().catch(() => ({ error: '' }));
        setNewError(error || 'Failed to create session');
      }
    } catch {
      setNewError('Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  const handleKill = async () => {
    const s = killTarget;
    if (!s || killing) return;
    setKilling(true);
    try {
      const qs = s.context ? `?context=${encodeURIComponent(s.context)}` : '';
      const res = await fetch(`${API}/api/sessions/${encodeURIComponent(s.name)}${qs}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast(`Killed ${s.name}`);
      await fetchSessions();
    } catch {
      toast(`Could not kill ${s.name}`);
    } finally {
      setKilling(false);
      setKillTarget(null);
    }
  };

  // Sessions grouped per context (coordinator mode), in the contexts' order.
  // "All" lists every context that has sessions; a selected context lists
  // just that one (even when empty, so it can offer to start the first).
  const groups = useMemo(() => {
    if (!multiContext) return [{ key: 'all', info: undefined as ContextInfo | undefined, label: '', color: '', sessions }];
    const shown = activeContext ? contexts.filter((c) => c.name === activeContext) : contexts;
    const out = shown
      .map((c) => ({ key: c.name, info: c as ContextInfo | undefined, label: c.label || c.name, color: contextTone(c.name), sessions: sessions.filter((s) => s.context === c.name) }))
      .filter((g) => activeContext || g.sessions.length > 0);
    if (!activeContext) {
      const known = new Set(contexts.map((c) => c.name));
      const rest = sessions.filter((s) => !s.context || !known.has(s.context));
      if (rest.length) out.push({ key: '?', info: undefined, label: 'Other', color: 'var(--ink-3)', sessions: rest });
    }
    return out;
  }, [sessions, contexts, multiContext, activeContext]);

  const visible = activeContext ? sessions.filter((s) => s.context === activeContext) : sessions;
  const waiting = visible.filter((s) => s.meta?.status === 'waiting').length;
  const working = visible.filter((s) => s.meta?.status === 'working').length;
  const labelOf = (name?: string) => contexts.find((c) => c.name === name)?.label || name || '';
  const newInfo = contexts.find((c) => c.name === newContext);

  const gutter = { paddingLeft: 'calc(16px + var(--safe-l))', paddingRight: 'calc(16px + var(--safe-r))' };

  return (
    <div className="screen">
      <div className="statusbar-pad" />

      {/* The large title is the pane switcher: two headings, one lit. */}
      <header className="flex-shrink-0 w-full max-w-3xl mx-auto pt-2 pb-3">
        <div className="flex items-center" style={{ paddingLeft: 'calc(16px + var(--safe-l))', paddingRight: 'calc(8px + var(--safe-r))' }}>
          <div className="flex items-baseline gap-4 flex-1 min-w-0" role="tablist" aria-label="Home sections">
            {([['sessions', 'Sessions'], ['ports', 'Ports']] as const).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={pane === value}
                onClick={() => setPane(value)}
                className={`relative h-11 text-[25px] font-semibold tracking-[-0.025em] transition-colors duration-200 ${pane === value ? 'text-ink' : 'text-ink-3'}`}
              >
                {label}
                {value === 'ports' && pendingCount > 0 && (
                  <span className="count-badge absolute -right-5 top-1" aria-label={`${pendingCount} pending share request${pendingCount === 1 ? '' : 's'}`}>{pendingCount}</span>
                )}
              </button>
            ))}
          </div>
          {onSwitchView && (
            <button className="icon-btn" onClick={() => onSwitchView('canvas')} aria-label="Canvas view" title="Canvas view">
              <LayoutDashboard size={20} strokeWidth={1.9} />
            </button>
          )}
          <NotificationBell />
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
            <Settings2 size={20} strokeWidth={1.9} />
          </button>
        </div>
        <p className="m-0 text-[13.5px] text-ink-2 min-h-5 truncate" style={gutter}>
          {pane === 'ports' ? (
            activeInfo ? `Services of ${activeInfo.label || activeInfo.name}, and who can reach them` : 'Listening services, and who can reach them'
          ) : loading ? (
            ' '
          ) : (
            <>
              {visible.length} session{visible.length === 1 ? '' : 's'}
              {activeInfo && <> in {activeInfo.label || activeInfo.name}</>}
              {waiting > 0 && <> · <span className="text-accent font-medium">{waiting} waiting for you</span></>}
              {working > 0 && <> · {working} working</>}
            </>
          )}
        </p>

      </header>

      <main className="scroll-y flex-1 min-h-0">
        <div className="w-full max-w-3xl mx-auto pt-1" style={{ ...gutter, paddingBottom: 'calc(24px + var(--safe-b))' }}>
          {offline && (
            <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 mb-3 text-[13.5px] bg-danger-soft text-danger" role="status">
              <WifiOff size={16} className="flex-shrink-0" /> Can't reach the server. Retrying…
            </div>
          )}

          {pane === 'ports' ? (
            <div key="ports" className="anim-fade">
              <PortsPanel {...overview} contextFilter={activeContext || undefined} />
            </div>
          ) : (
            <div key="sessions" className="anim-fade">
              <RequestCards data={overview.data} refresh={overview.refresh} />
              {loading ? (
                <div className="card divide-y divide-line">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-3.5 py-3.5">
                      <div className="skeleton w-[38px] h-[38px] !rounded-[11px]" />
                      <div className="flex-1"><div className="skeleton h-3.5 w-32" /><div className="skeleton h-3 w-48 mt-2" /></div>
                    </div>
                  ))}
                </div>
              ) : visible.length === 0 ? (
                <div className="flex flex-col items-center text-center px-6 pt-14 pb-8 anim-rise">
                  <span className="status-tile !w-14 !h-14 !rounded-2xl" style={activeInfo ? toneVar(contextTone(activeInfo.name)) : undefined}>
                    <SquareTerminal size={26} strokeWidth={1.7} />
                  </span>
                  <h2 className="m-0 mt-4 text-[17px] font-semibold">
                    {activeInfo ? `No sessions in ${activeInfo.label || activeInfo.name}` : 'No sessions yet'}
                  </h2>
                  <p className="m-0 mt-1 text-[14px] text-ink-2 max-w-64">
                    {activeInfo
                      ? `${runsAs(activeInfo)}. A session is a tmux shell that keeps running when you close the app.`
                      : 'A session is a tmux shell that keeps running when you close the app.'}
                  </p>
                  <button className="btn btn-primary mt-5" onClick={() => openNew()}>
                    <Plus size={18} strokeWidth={2.25} /> New session{activeInfo ? ` in ${activeInfo.label || activeInfo.name}` : ''}
                  </button>
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.key} className="mb-4">
                    {g.label && (
                      <div className="flex items-center gap-2 pl-1 min-h-9">
                        <span className="status-dot" style={toneVar(g.color)} />
                        <span className="eyebrow" style={{ color: g.color }}>{g.label}</span>
                        <span className="text-[12px] text-ink-3 truncate">
                          {g.sessions.length}{g.info?.user ? ` · ${g.info.user}` : ''}
                        </span>
                        {g.info && (
                          <button
                            className="icon-btn icon-btn-sm ml-auto"
                            aria-label={`New session in ${g.label}`}
                            title={`New session in ${g.label}`}
                            onClick={() => openNew(g.info!.name)}
                          >
                            <Plus size={18} />
                          </button>
                        )}
                      </div>
                    )}
                    <ul className="card divide-y divide-line m-0 p-0 list-none">
                      {g.sessions.map((s) => (
                        <SessionRow
                          key={`${s.context || 'default'}:${s.name}`}
                          session={s}
                          onOpen={() => onSelectSession(s.name, s.context)}
                          onActions={() => setActionsFor(s)}
                        />
                      ))}
                    </ul>
                  </section>
                )).concat(
                  <button
                    key="new-session"
                    className="btn btn-primary w-full !min-h-[48px] mt-1"
                    onClick={() => openNew()}
                  >
                    <Plus size={19} strokeWidth={2.25} /> New session
                  </button>,
                )
              )}
            </div>
          )}
        </div>
      </main>

      {/* New session */}
      <Sheet
        open={showNew}
        onClose={() => setShowNew(false)}
        title="New session"
        footer={
          <button className="btn btn-primary w-full" disabled={creating || !cleanName} onClick={handleCreate}>
            {creating ? 'Creating…' : multiContext && newInfo ? `Create in ${newInfo.label || newInfo.name}` : 'Create and open'}
          </button>
        }
      >
        {multiContext && (
          <div className="mb-4">
            <div className="eyebrow mb-2">Context</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Context for the new session">
              {contexts.map((c) => (
                <button
                  key={c.name}
                  role="radio"
                  aria-checked={c.name === newContext}
                  // Keep the keyboard on the name field while picking.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setNewContext(c.name)}
                  className="ctx-chip"
                  style={toneVar(contextTone(c.name))}
                >
                  <span className="status-dot" />
                  {c.label || c.name}
                </button>
              ))}
            </div>
            <p className="m-0 mt-2 flex items-center gap-1.5 text-[13px] text-ink-2">
              <UserRound size={14} className="flex-shrink-0" /> {runsAs(newInfo)}
            </p>
          </div>
        )}
        <label className="eyebrow block mb-2" htmlFor="new-session-name">Name</label>
        <input
          id="new-session-name"
          // Mounted (and focused) by the opening tap, so the soft keyboard
          // comes up together with the sheet.
          autoFocus
          type="text"
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setNewError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          placeholder="api-server"
          className="field font-mono"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={80}
        />
        <p className={`m-0 mt-2 text-[13px] min-h-5 ${newError ? 'text-danger' : 'text-ink-3'}`} role={newError ? 'alert' : undefined}>
          {newError
            || (newName.trim() && cleanName !== newName.trim()
              ? <>Will be created as <span className="font-mono text-ink-2">{cleanName || '…'}</span></>
              : 'Letters, numbers, - and _')}
        </p>
      </Sheet>

      {/* Per-session actions */}
      <Sheet
        open={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        bare
        title={actionsFor ? <span className="font-mono">{actionsFor.name}</span> : ''}
        subtitle={actionsFor?.context && multiContext
          ? <span style={{ color: contextTone(actionsFor.context) }}>{labelOf(actionsFor.context)}</span>
          : undefined}
      >
        {actionsFor && (
          <div className="flex flex-col gap-2 pt-1">
            <button className="btn justify-start" onClick={() => { const s = actionsFor; setActionsFor(null); onSelectSession(s.name, s.context); }}>
              <SquareTerminal size={18} /> Open terminal
            </button>
            <button className="btn btn-danger justify-start" onClick={() => { setKillTarget(actionsFor); setActionsFor(null); }}>
              <Trash2 size={18} /> Kill session
            </button>
            <button className="btn btn-ghost" onClick={() => setActionsFor(null)}>Cancel</button>
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={killTarget !== null}
        title={killTarget ? `Kill ${killTarget.name}?` : ''}
        confirmLabel={killing ? 'Killing…' : 'Kill session'}
        danger
        busy={killing}
        onCancel={() => setKillTarget(null)}
        onConfirm={handleKill}
      >
        This ends the tmux session{killTarget?.context && multiContext ? ` in ${labelOf(killTarget.context)}` : ''} and everything running inside it. It cannot be undone.
      </ConfirmSheet>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
