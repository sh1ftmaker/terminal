import { lazy, Suspense, useState, useCallback, useEffect } from 'react';
import { ChevronLeft, Ellipsis, Folder, Globe, SquareTerminal, Trash2 } from 'lucide-react';
import TerminalPane from './TerminalPane';
import FileBrowser from './FileBrowser';
import SettingsSheet from './SettingsSheet';
import ConfirmSheet from './ui/ConfirmSheet';
import Segmented, { type SegmentedOption } from './ui/Segmented';
import { toast } from './ui/toast';
import { resolveFrameSrc } from '../lib/frameSrc';
import { API } from '../lib/base';
import { STATUS, contextTone, statusOf, type SessionMeta } from '../lib/sessions';

// Not reachable from the tab bar at the moment; kept out of the main bundle.
const ChatView = lazy(() => import('./ChatView.tsx'));

interface TerminalViewProps {
  sessionName: string;
  context?: string;
  onBack: () => void;
}

type Tab = 'terminal' | 'files' | 'chat' | 'preview';

export default function TerminalView({ sessionName, context, onBack }: TerminalViewProps) {
  const [selectedTab, setActiveTab] = useState<Tab>('terminal');
  const [filesVisited, setFilesVisited] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [meta, setMeta] = useState<SessionMeta>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);

  // Poll session metadata every 2s while this view is open.
  useEffect(() => {
    let cancelled = false;
    const fetchMeta = async () => {
      try {
        const metaUrl = `${API}/api/sessions/${encodeURIComponent(sessionName)}/meta${context ? `?context=${encodeURIComponent(context)}` : ''}`;
        const res = await fetch(metaUrl);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setMeta(data || {});
      } catch { /* offline: keep the last known state */ }
    };
    fetchMeta();
    const id = setInterval(fetchMeta, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionName, context]);

  useEffect(() => {
    document.title = `${sessionName} · Terminal`;
    return () => { document.title = 'Terminal'; };
  }, [sessionName]);

  const selectTab = (tab: Tab) => {
    if (tab === 'files') setFilesVisited(true);   // mounted on first visit, then kept
    setActiveTab(tab);
  };

  const handleConnectionChange = useCallback((conn: boolean, conning: boolean) => {
    setConnected(conn);
    setConnecting(conning);
  }, []);

  const handleKill = async () => {
    setConfirmKill(false);
    setMenuOpen(false);
    // Leave first: an attached terminal would reconnect and re-create the
    // session the moment it disappears.
    onBack();
    try {
      const qs = context ? `?context=${encodeURIComponent(context)}` : '';
      const res = await fetch(`${API}/api/sessions/${encodeURIComponent(sessionName)}${qs}`, { method: 'DELETE' });
      toast(res.ok ? `Killed ${sessionName}` : `Could not kill ${sessionName}`);
    } catch {
      toast(`Could not kill ${sessionName}`);
    }
  };

  const status = statusOf(meta);
  const showPreview = Boolean(meta.preview_url);
  // On the Preview tab when the preview URL disappears: fall back to Terminal.
  const activeTab: Tab = selectedTab === 'preview' && !showPreview ? 'terminal' : selectedTab;

  const tabs: SegmentedOption<Tab>[] = [
    { value: 'terminal', title: 'Terminal', label: <><SquareTerminal size={17} /><span className="hidden sm:inline">Terminal</span></> },
    { value: 'files', title: 'Files', label: <><Folder size={17} /><span className="hidden sm:inline">Files</span></> },
    ...(showPreview ? [{ value: 'preview' as Tab, title: 'Preview', label: <><Globe size={17} /><span className="hidden sm:inline">Preview</span></> }] : []),
  ];

  // One status line: the connection when it needs attention, else the agent.
  let dotClass = 'status-dot status-connected';
  let dotTone: string | undefined;
  let statusText = 'Connected';
  let statusColor: string | undefined;
  if (!connected) {
    dotClass = `status-dot ${connecting ? 'status-connecting' : 'status-disconnected'}`;
    statusText = connecting ? 'Connecting…' : 'Reconnecting…';
  } else if (status) {
    dotClass = `status-dot ${status === 'working' ? 'anim-breathe' : ''}`;
    dotTone = STATUS[status].tone;
    statusText = STATUS[status].label;
    statusColor = status === 'idle' ? undefined : STATUS[status].tone;
  }

  return (
    <div className="screen anim-fade">
      <div className="statusbar-pad on-bar" />
      <header className="appbar appbar-collapsible">
        <button onClick={onBack} className="icon-btn" aria-label="Back to sessions">
          <ChevronLeft size={24} strokeWidth={2} />
        </button>

        <div className="min-w-0 flex-1 pr-2">
          <div className="font-mono text-[15px] font-semibold leading-5 truncate" title={sessionName}>{sessionName}</div>
          <div className="flex items-center gap-1.5 text-[11.5px] leading-4 text-ink-2 min-w-0" title={meta.task ? `${statusText}: ${meta.task}` : statusText}>
            <span className={dotClass} style={{ width: 7, height: 7, ...(dotTone ? { ['--tone' as string]: dotTone } : {}) }} />
            <span className="truncate font-medium" style={statusColor ? { color: statusColor } : undefined}>{statusText}</span>
            {context && <span className="truncate" style={{ color: contextTone(context) }}>· {context}</span>}
          </div>
        </div>

        <Segmented<Tab> label="View" value={activeTab} onChange={selectTab} options={tabs} className="flex-shrink-0 [&_.seg-item]:!px-2.5 sm:[&_.seg-item]:!px-3" />

        <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Session menu and settings">
          <Ellipsis size={21} />
        </button>
      </header>

      {/* Main content. The terminal stays mounted (and attached) behind the
          other tabs, so coming back to it is instant. */}
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0" hidden={activeTab !== 'terminal'}>
          <TerminalPane
            sessionName={sessionName}
            context={context}
            onConnectionChange={handleConnectionChange}
            active={activeTab === 'terminal'}
          />
        </div>
        {filesVisited && (
          <div className="absolute inset-0" hidden={activeTab !== 'files'}>
            <FileBrowser sessionCwd={meta.cwd} context={context} />
          </div>
        )}
        {activeTab === 'chat' && (
          <div className="absolute inset-0">
            <Suspense fallback={null}><ChatView sessionName={sessionName} /></Suspense>
          </div>
        )}
        {activeTab === 'preview' && meta.preview_url && (
          <iframe
            src={resolveFrameSrc(meta.preview_url)}
            title={`Preview for ${sessionName}`}
            className="absolute inset-0 w-full h-full border-0 bg-white"
            allow="fullscreen; clipboard-read; clipboard-write"
          />
        )}
      </div>

      <SettingsSheet open={menuOpen} onClose={() => setMenuOpen(false)}>
        <section className="mt-1">
          <h3 className="eyebrow m-0 mb-1">This session</h3>
          <div className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[15px] font-medium truncate">{sessionName}</div>
              <div className="text-[13px] text-ink-2 mt-0.5 truncate">{meta.cwd || (context ? `Context: ${context}` : 'tmux session')}</div>
            </div>
            <button className="btn btn-sm btn-danger" onClick={() => setConfirmKill(true)}>
              <Trash2 size={15} /> Kill
            </button>
          </div>
        </section>
      </SettingsSheet>

      <ConfirmSheet
        open={confirmKill}
        title={`Kill ${sessionName}?`}
        confirmLabel="Kill session"
        danger
        onCancel={() => setConfirmKill(false)}
        onConfirm={handleKill}
      >
        This ends the tmux session and everything running inside it. It cannot be undone.
      </ConfirmSheet>
    </div>
  );
}
