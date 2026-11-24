import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { ArrowDown, ArrowUp, LoaderCircle, RotateCw } from 'lucide-react';
import { copyText } from '../lib/clipboard';
import { MultilineUrlProvider } from '../lib/multilineLinks';
import { unwrapSelection, sourceLinesFromText, type SourceLine } from '../lib/unwrap';
import { openExternal } from '../lib/openExternal';
import { API, wsUrl } from '../lib/base';
import { getSettings, useSettings } from '../lib/settings';
import { terminalMinContrast, terminalTheme, useThemeKey } from '../lib/theme';
import { store } from '../lib/storage';

export interface TerminalHandle {
  /** Send raw bytes to the pty. */
  sendInput: (data: string) => void;
  /** Paste text, honouring bracketed-paste mode. */
  paste: (text: string) => void;
  focus: () => void;
  blur: () => void;
  copySelection: () => Promise<boolean>;
  hasSelection: () => boolean;
  enterSelectMode: () => void;
  scrollToCursor: () => void;
  reconnect: () => void;
}

interface TerminalProps {
  sessionName: string;
  context?: string;
  onReady: (handle: TerminalHandle) => void;
  onConnectionChange?: (connected: boolean, connecting: boolean) => void;
  /** Rewrites text typed on the keyboard before it is sent (sticky modifiers). */
  transformInput?: (data: string) => string;
  /** False while the terminal is mounted but not on screen (another tab). */
  active?: boolean;
}

const TERMINAL_ROWS = 200; // Tall terminal for scrollback history
const MIN_COLS = 20;
const FONT_FAMILY = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
// Must match the .xterm padding in index.css.
const PAD_X = 16;
const PAD_TOP = 6;
// Rows kept visible below the cursor when following it: TUIs (Claude Code)
// draw their hints and status lines underneath the input.
const FOLLOW_MARGIN_ROWS = 4;
// A backgrounded tab's socket can die without a close event (iOS suspends
// them). After this long hidden, reattach instead of trusting it.
const STALE_AFTER_MS = 30_000;

// xterm answers the app's queries (focus in/out, device attributes, cursor
// position) through the same channel as keystrokes. Those are not the user
// typing, so they must not pull the view back to the prompt.
// eslint-disable-next-line no-control-regex
const TERMINAL_REPORT = /^\x1b(?:\[[?>]?[\d;]*\$?[IOcRnty]$|\]|P)/;

// Copies re-join lines the TUI wrapped to the pane width (long URLs/commands
// come out as one line). Persisted; toggled from the select overlay's bar
// and from Settings.
const UNWRAP_COPY_KEY = 'terminal.unwrapCopy';
const UNWRAP_COPY_EVENT = 'terminal:unwrap-copy';
function loadUnwrapCopy(): boolean {
  return store.get(UNWRAP_COPY_KEY) !== '0';
}

// xterm's measured cell box. There is no public accessor; the fallbacks
// below cover an xterm upgrade moving it.
function cellSize(terminal: XTerm): { w: number; h: number } | null {
  type Core = { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } };
  const cell = (terminal as unknown as { _core?: Core })._core?._renderService?.dimensions?.css?.cell;
  return cell && cell.width > 0 && cell.height > 0 ? { w: cell.width, h: cell.height } : null;
}

function rowHeightOf(container: HTMLElement, terminal: XTerm): number {
  const cell = cellSize(terminal);
  if (cell) return cell.h;
  const screen = container.querySelector<HTMLElement>('.xterm-screen');
  const measured = screen && terminal.rows > 0 ? screen.offsetHeight / terminal.rows : 0;
  return measured > 0 ? measured : (terminal.options.fontSize ?? 14) * 1.3;
}

// Right-edge column of a buffer row: index just past the last non-blank cell.
function rowEdge(terminal: XTerm, row: number): number {
  const line = terminal.buffer.active.getLine(row);
  if (!line) return 0;
  const cell = terminal.buffer.active.getNullCell();
  for (let col = line.length - 1; col >= 0; col--) {
    const c = line.getCell(col, cell);
    if (!c) continue;
    const chars = c.getChars();
    if (chars && chars.trim()) return col + Math.max(1, c.getWidth());
  }
  return 0;
}

// xterm's selection text with wrapped fragments re-joined. Falls back to the
// raw selection when the buffer range can't be mapped onto it.
function getSelectionUnwrapped(terminal: XTerm): string {
  const raw = terminal.getSelection();
  const pieces = raw.split('\n');
  const pos = terminal.getSelectionPosition();
  if (pieces.length < 2 || !pos) return raw;
  const buffer = terminal.buffer.active;
  const lines: SourceLine[] = [];
  let row = pos.start.y;
  while (lines.length < pieces.length && row < buffer.length) {
    // One logical line: xterm joins soft-wrapped rows in getSelection() too.
    let text = '';
    let edge = 0;
    for (;;) {
      const line = buffer.getLine(row);
      if (!line) break;
      text += line.translateToString(true);
      edge = rowEdge(terminal, row);
      row++;
      const next = buffer.getLine(row);
      if (!next || !next.isWrapped) break;
    }
    lines.push({ text: text.trimEnd(), edge });
  }
  return unwrapSelection(pieces, lines, terminal.cols);
}

type CursorPlace = 'visible' | 'above' | 'below';

// Where the cursor row sits relative to the scroller's visible window.
function cursorPlace(container: HTMLElement, terminal: XTerm): CursorPlace {
  const rowH = rowHeightOf(container, terminal);
  const top = PAD_TOP + (terminal.buffer.active.baseY + terminal.buffer.active.cursorY) * rowH;
  if (top < container.scrollTop) return 'above';
  if (top + rowH > container.scrollTop + container.clientHeight) return 'below';
  return 'visible';
}

// Scroll the outer container so the cursor row is on screen, with a few rows
// of room underneath. With `force` it always re-centres on that position;
// otherwise it only moves when the cursor is hidden or under the margin.
function revealCursor(container: HTMLElement, terminal: XTerm, force: boolean) {
  const rowH = rowHeightOf(container, terminal);
  const top = PAD_TOP + (terminal.buffer.active.baseY + terminal.buffer.active.cursorY) * rowH;
  const height = container.clientHeight;
  const max = Math.max(0, container.scrollHeight - height);
  // A fifth of the window, at most FOLLOW_MARGIN_ROWS: with eight rows left
  // above a landscape keyboard, history matters more than the footer.
  const marginRows = Math.max(1, Math.min(FOLLOW_MARGIN_ROWS, Math.floor(height / rowH / 5)));
  const margin = Math.min(marginRows * rowH, Math.max(0, height - rowH * 2));
  const anchored = Math.min(max, Math.max(0, top + rowH + margin - height));

  if (force) {
    container.scrollTop = anchored;
    return;
  }
  if (top < container.scrollTop) {
    // Cursor went above the window (clear, redraw): show it near the top.
    container.scrollTop = Math.max(0, top - rowH);
  } else if (top + rowH + margin > container.scrollTop + height && anchored > container.scrollTop) {
    container.scrollTop = anchored;
  }
}

export default function Terminal({ sessionName, context, onReady, onConnectionChange, transformInput, active = true }: TerminalProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const isUnmountedRef = useRef(false);
  const sentColsRef = useRef(0);
  // Following: keep the cursor on screen as output arrives. Dropped when the
  // user scrolls it out of view, restored when they scroll back to it.
  const followRef = useRef(true);
  const followTimerRef = useRef(0);
  const followDeadlineRef = useRef(0);
  const [cursorAway, setCursorAway] = useState<CursorPlace>('visible');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [everConnected, setEverConnected] = useState(false);
  const [slow, setSlow] = useState(false);
  const [selectText, setSelectText] = useState<string | null>(null);
  const selectTextRef = useRef<string | null>(null);
  selectTextRef.current = selectText;
  const [copiedAll, setCopiedAll] = useState(false);
  const overlayScrollRef = useRef<HTMLDivElement>(null);
  const [unwrapCopy, setUnwrapCopy] = useState<boolean>(loadUnwrapCopy);
  const unwrapCopyRef = useRef(unwrapCopy);
  unwrapCopyRef.current = unwrapCopy;
  const transformRef = useRef(transformInput);
  transformRef.current = transformInput;
  const activeRef = useRef(active);
  activeRef.current = active;

  const settings = useSettings();
  const themeKey = useThemeKey();

  const toggleUnwrapCopy = useCallback(() => {
    setUnwrapCopy((v) => {
      store.set(UNWRAP_COPY_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  // Settings can flip the same preference.
  useEffect(() => {
    const sync = () => setUnwrapCopy(loadUnwrapCopy());
    window.addEventListener(UNWRAP_COPY_EVENT, sync);
    return () => window.removeEventListener(UNWRAP_COPY_EVENT, sync);
  }, []);

  // Text of the native selection inside the select overlay, unwrapped when
  // enabled. Null when the selection isn't inside the overlay.
  const getOverlaySelection = useCallback((): string | null => {
    const pre = overlayScrollRef.current?.querySelector('pre');
    const sel = window.getSelection();
    const all = selectTextRef.current;
    if (!pre || !sel || sel.rangeCount === 0 || sel.isCollapsed || all === null) return null;
    const range = sel.getRangeAt(0);
    if (!pre.contains(range.commonAncestorContainer)) return null;
    const raw = sel.toString();
    if (!unwrapCopyRef.current) return raw;
    const pieces = raw.split('\n');
    if (pieces.length < 2) return raw;
    // Locate the selection start within the overlay text to find its line
    const before = range.cloneRange();
    before.selectNodeContents(pre);
    before.setEnd(range.startContainer, range.startOffset);
    const startIdx = before.toString().length;
    const allLines = all.split('\n');
    let lineIdx = 0;
    for (let consumed = 0; lineIdx < allLines.length - 1; lineIdx++) {
      consumed += allLines[lineIdx].length + 1;
      if (consumed > startIdx) break;
    }
    const lines = sourceLinesFromText(allLines.slice(lineIdx, lineIdx + pieces.length));
    return unwrapSelection(pieces, lines, terminalRef.current?.cols ?? 80);
  }, []);

  // Notify parent of connection state changes
  useEffect(() => {
    onConnectionChange?.(connected, connecting);
  }, [connected, connecting, onConnectionChange]);

  // A first connection that takes a while gets a "Connecting…" notice.
  useEffect(() => {
    if (connected) { setSlow(false); return; }
    const id = window.setTimeout(() => setSlow(true), 700);
    return () => window.clearTimeout(id);
  }, [connected]);

  const updatePlace = useCallback(() => {
    const container = scrollContainerRef.current;
    const term = terminalRef.current;
    if (!container || !term || container.clientHeight === 0) return;
    const place = cursorPlace(container, term);
    followRef.current = place === 'visible';
    setCursorAway(place);
  }, []);

  // Bring the cursor back on screen if we are following it. Coalesced: a TUI
  // repaint parks the cursor in odd places mid-frame, and chasing each of
  // those would make the view jitter.
  const followSoon = useCallback(() => {
    const now = performance.now();
    if (!followDeadlineRef.current) followDeadlineRef.current = now + 220;
    window.clearTimeout(followTimerRef.current);
    const run = () => {
      followDeadlineRef.current = 0;
      const container = scrollContainerRef.current;
      const term = terminalRef.current;
      if (!container || !term || container.clientHeight === 0) return;
      if (followRef.current) revealCursor(container, term, false);
      const place = cursorPlace(container, term);
      if (place === 'visible') followRef.current = true;
      setCursorAway(place);
    };
    followTimerRef.current = window.setTimeout(run, Math.max(0, Math.min(40, followDeadlineRef.current - now)));
  }, []);

  const scrollToCursor = useCallback(() => {
    const container = scrollContainerRef.current;
    const term = terminalRef.current;
    if (!container || !term) return;
    followRef.current = true;
    revealCursor(container, term, true);
    setCursorAway('visible');
  }, []);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
      // Typing means "take me to the prompt".
      if (!followRef.current) scrollToCursor();
    }
  }, [scrollToCursor]);

  const paste = useCallback((text: string) => {
    // terminal.paste() respects bracketed paste mode, so multi-line pastes
    // arrive as one block instead of executing line by line
    terminalRef.current?.paste(text);
  }, []);

  const focus = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  const blur = useCallback(() => {
    terminalRef.current?.blur();
  }, []);

  const copySelection = useCallback(async () => {
    const term = terminalRef.current;
    const selection = term ? (unwrapCopyRef.current ? getSelectionUnwrapped(term) : term.getSelection()) : '';
    if (!selection) return false;
    const ok = await copyText(selection);
    if (!ok) console.error('Failed to copy selection');
    return ok;
  }, []);

  const hasSelection = useCallback(() => {
    return terminalRef.current?.hasSelection() || false;
  }, []);

  // Select mode: snapshot the buffer as plain text in an overlay where native
  // browser selection (long-press on mobile, drag on desktop) just works —
  // xterm's constant re-rendering can't clobber it.
  const enterSelectMode = useCallback(() => {
    const term = terminalRef.current;
    if (!term) return;
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    setSelectText(lines.join('\n'));
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectText(null);
    setCopiedAll(false);
    window.getSelection()?.removeAllRanges();
    // Back to typing on desktop. On touch, focusing would pop the keyboard
    // open over the text the user just came to read.
    if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) terminalRef.current?.focus();
  }, []);

  const handleCopyAll = useCallback(async () => {
    if (!selectText) return;
    let text = selectText;
    if (unwrapCopy) {
      const lines = selectText.split('\n');
      text = unwrapSelection(lines, sourceLinesFromText(lines), terminalRef.current?.cols ?? 80);
    }
    if (await copyText(text)) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    }
  }, [selectText, unwrapCopy]);

  // Mirror the terminal's scroll position when the overlay opens
  useEffect(() => {
    if (selectText !== null && overlayScrollRef.current && scrollContainerRef.current) {
      overlayScrollRef.current.scrollTop = scrollContainerRef.current.scrollTop;
    }
  }, [selectText]);

  // Columns that fit the container at the current font. Returns the count,
  // or 0 when the terminal isn't laid out (hidden tab).
  const fitCols = useCallback((): number => {
    const term = terminalRef.current;
    const inner = containerRef.current;
    if (!term || !inner || inner.clientWidth === 0) return 0;
    const cellW = cellSize(term)?.w ?? (term.options.fontSize ?? 14) * 0.6;
    const cols = Math.max(MIN_COLS, Math.floor((inner.clientWidth - PAD_X) / cellW));
    if (cols !== term.cols) term.resize(cols, TERMINAL_ROWS);
    return cols;
  }, []);

  // Fit, and tell the server when the width changed (or `force`: new socket).
  const syncSize = useCallback((force = false) => {
    const cols = fitCols();
    const ws = wsRef.current;
    if (!cols || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (force || cols !== sentColsRef.current) {
      sentColsRef.current = cols;
      ws.send(JSON.stringify({ type: 'resize', cols, rows: TERMINAL_ROWS }));
    }
  }, [fitCols]);

  const connectWebSocket = useCallback(() => {
    if (isUnmountedRef.current) return;

    setConnecting(true);
    const ws = new WebSocket(wsUrl(`/ws/terminal?session=${encodeURIComponent(sessionName)}${context ? `&context=${encodeURIComponent(context)}` : ''}`));
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      setConnected(true);
      setConnecting(false);
      setEverConnected(true);
      followRef.current = true;
      syncSize(true);
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      terminalRef.current?.write(event.data);
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      setConnected(false);
      setConnecting(false);
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      setConnected(false);
      setConnecting(false);

      if (isUnmountedRef.current) return;

      // Flat 2-second reconnect (simpler, more responsive for local server)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        if (!isUnmountedRef.current) {
          connectWebSocket();
        }
      }, 2000);
    };
  }, [sessionName, context, syncSize]);

  // Drop whatever socket we have and attach again, now.
  const reconnect = useCallback(() => {
    if (isUnmountedRef.current) return;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    const old = wsRef.current;
    wsRef.current = null;
    if (old) {
      old.onopen = old.onmessage = old.onerror = old.onclose = null;
      try { old.close(); } catch { /* already closed */ }
    }
    setConnected(false);
    connectWebSocket();
  }, [connectWebSocket]);

  // Coming back to the foreground / network: don't sit out the retry timer,
  // and don't trust a socket that sat suspended for a long time.
  useEffect(() => {
    let hiddenAt = 0;
    const wake = (stale: boolean) => {
      const ws = wsRef.current;
      const alive = ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
      if (!alive || stale) reconnect();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      const stale = hiddenAt > 0 && Date.now() - hiddenAt > STALE_AFTER_MS;
      hiddenAt = 0;
      wake(stale);
    };
    const onOnline = () => wake(false);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [reconnect]);

  useEffect(() => {
    if (!containerRef.current) return;
    isUnmountedRef.current = false;

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: getSettings().fontSize,
      fontFamily: FONT_FAMILY,
      rows: TERMINAL_ROWS,
      cols: 80,
      scrollback: 0, // Disable internal scrollback since we're using container scroll
      theme: terminalTheme(),
      minimumContrastRatio: terminalMinContrast(),
      // Bold is a weight, not a colour shift: "bold black on blue" (the tmux
      // status badge) must stay black. The contrast floor above covers the
      // old habit of using bold black as a dim grey on the background.
      drawBoldTextInBrightColors: false,
      allowProposedApi: true,
    });

    terminalRef.current = terminal;

    // TUIs like Claude Code (and tmux with mouse on) enable terminal mouse
    // tracking, which makes xterm forward drags to the app instead of
    // selecting locally — "selections" then land in tmux's paste buffer
    // ("paste with prefix + ]") and never reach the system clipboard. Swallow
    // the tracking-enable sequences so dragging always selects locally.
    // Scrolling is unaffected (the outer container owns wheel/touch scroll).
    const MOUSE_TRACKING_MODES = new Set([9, 1000, 1001, 1002, 1003, 1005, 1006, 1015, 1016]);
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      const flat: number[] = [];
      for (const p of params) {
        if (Array.isArray(p)) flat.push(...p);
        else flat.push(p);
      }
      return flat.length > 0 && flat.every((p) => MOUSE_TRACKING_MODES.has(p));
    });

    // Linkify URLs, joining URLs hard-wrapped across lines (Claude Code
    // indents and wraps long ones) into a single clickable link
    terminal.registerLinkProvider(
      new MultilineUrlProvider(terminal, openExternal)
    );

    // Open terminal in container
    terminal.open(containerRef.current);

    // Ctrl/Cmd+C copies an active selection instead of sending SIGINT (no
    // selection: ^C still interrupts). Ctrl/Cmd+V is left entirely to the
    // browser so the native paste event fires — otherwise xterm sends ^V to
    // the shell, which Claude Code interprets as "paste image from host
    // clipboard" and text paste never happens.
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyV') return false;
      if (mod && e.code === 'KeyC') {
        if (terminal.hasSelection()) {
          copyText(unwrapCopyRef.current ? getSelectionUnwrapped(terminal) : terminal.getSelection());
          terminal.clearSelection();
          return false;
        }
        if (e.shiftKey) return false;
      }
      return true;
    });

    // Let wheel/scroll events pass through to the outer scroll container
    // instead of being intercepted by xterm (which converts them to arrow keys)
    terminal.attachCustomWheelEventHandler(() => false);

    // The custom wheel handler above isn't enough when the app inside tmux
    // enables mouse reporting (Claude Code does): xterm binds its own wheel
    // listener that unconditionally preventDefaults, killing trackpad/wheel
    // scrolling on desktop. Stop wheel events in the capture phase so they
    // never reach xterm and the container scrolls natively.
    const scrollContainer = scrollContainerRef.current;
    const handleWheelCapture = (e: WheelEvent) => {
      e.stopPropagation();
    };
    scrollContainer?.addEventListener('wheel', handleWheelCapture, {
      capture: true,
      passive: true,
    });

    // The user scrolling decides whether we keep following the cursor; our
    // own scrolls land with the cursor visible, so they read as "following".
    const handleScroll = () => updatePlace();
    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true });

    // WebGL disabled — causes glyph corruption on this system (Playwright Chrome install may have broken GPU context)
    // Using xterm.js DOM renderer instead

    requestAnimationFrame(() => syncSize());

    // xterm measured its cell with whatever font was available at open(). Once
    // the bundled mono has loaded, measure again: the fallback's advance width
    // differs, and the column count is derived from it.
    let fontsCancelled = false;
    const remeasure = () => {
      if (fontsCancelled || terminalRef.current !== terminal) return;
      const family = terminal.options.fontFamily;
      terminal.options.fontFamily = `${family}, monospace`;
      terminal.options.fontFamily = family;
      syncSize();
      followSoon();
    };
    const size = getSettings().fontSize;
    Promise.all([
      document.fonts?.load(`${size}px 'JetBrains Mono'`),
      document.fonts?.load(`bold ${size}px 'JetBrains Mono'`),
    ]).then(remeasure, () => {});

    // Connect WebSocket
    connectWebSocket();

    // Handle terminal input
    terminal.onData((data) => {
      const out = transformRef.current ? transformRef.current(data) : data;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data: out }));
        if (!followRef.current && !TERMINAL_REPORT.test(data)) scrollToCursor();
      }
    });

    terminal.onWriteParsed(() => followSoon());

    // Inputs that manage their own clipboard (rich-text box, etc.) — the
    // document-level handlers below must leave those alone.
    const isForeignTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.closest?.('.select-overlay')) return true;
      return (
        (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') &&
        !el.classList.contains('xterm-helper-textarea')
      );
    };

    const uploadPastedImage = async (file: File) => {
      try {
        const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        const form = new FormData();
        form.append('file', file, `pasted-image.${ext}`);
        const res = await fetch(`${API}/api/paste-image`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(`upload failed: ${res.status}`);
        const { path } = await res.json();
        terminal.paste(path);
      } catch (err) {
        console.error('Failed to paste image:', err);
      }
    };

    // Document-level paste: works no matter where focus ended up (buttons,
    // body, xterm's hidden textarea). Images are uploaded to the server and
    // their path typed into the terminal for CLI tools to read.
    const handlePasteEvent = (e: ClipboardEvent) => {
      if (!activeRef.current) return;
      if (isForeignTarget(e.target)) return;
      if (!e.clipboardData) return;
      e.preventDefault();
      e.stopPropagation(); // keep xterm's own paste handler from double-pasting
      const imageItem = Array.from(e.clipboardData.items).find(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );
      const imageFile = imageItem?.getAsFile();
      if (imageFile) {
        uploadPastedImage(imageFile);
        return;
      }
      const text = e.clipboardData.getData('text/plain');
      if (text) terminal.paste(text);
    };

    // Document-level copy: covers Edit-menu / context-menu copy while an
    // xterm selection is active (there's no DOM selection to copy natively)
    const handleCopyEvent = (e: ClipboardEvent) => {
      if (!activeRef.current) return;
      if (!e.clipboardData) return;
      // Native selection inside the select overlay (mobile long-press flow)
      const overlayText = getOverlaySelection();
      if (overlayText !== null) {
        e.clipboardData.setData('text/plain', overlayText);
        e.preventDefault();
        return;
      }
      if (isForeignTarget(e.target)) return;
      if (terminal.hasSelection()) {
        const text = unwrapCopyRef.current ? getSelectionUnwrapped(terminal) : terminal.getSelection();
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
      }
    };

    document.addEventListener('paste', handlePasteEvent, true);
    document.addEventListener('copy', handleCopyEvent, true);

    // iOS/touch: long-press opens the native-selection overlay, since touch
    // can't drive xterm's mouse-based selection model
    let touchTimer: number | null = null;
    let touchStartX = 0;
    let touchStartY = 0;
    const clearTouchTimer = () => {
      if (touchTimer !== null) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
    };
    const handleTouchStart = (e: TouchEvent) => {
      clearTouchTimer();
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchTimer = window.setTimeout(() => {
        touchTimer = null;
        enterSelectMode();
      }, 500);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (touchTimer === null) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - touchStartX) > 10 || Math.abs(t.clientY - touchStartY) > 10) {
        clearTouchTimer();
      }
    };
    const scrollEl = scrollContainerRef.current;
    scrollEl?.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollEl?.addEventListener('touchmove', handleTouchMove, { passive: true });
    scrollEl?.addEventListener('touchend', clearTouchTimer, { passive: true });
    scrollEl?.addEventListener('touchcancel', clearTouchTimer, { passive: true });

    // Container resized (rotation, keyboard, window): refit the columns, tell
    // the server, and keep the cursor in view if we were following it.
    const resizeObserver = new ResizeObserver(() => {
      syncSize();
      followSoon();
    });
    if (scrollContainerRef.current) {
      resizeObserver.observe(scrollContainerRef.current);
    }

    // Expose methods to parent
    onReady({ sendInput, paste, focus, blur, copySelection, hasSelection, enterSelectMode, scrollToCursor, reconnect });

    return () => {
      isUnmountedRef.current = true;
      fontsCancelled = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      window.clearTimeout(followTimerRef.current);
      document.removeEventListener('paste', handlePasteEvent, true);
      document.removeEventListener('copy', handleCopyEvent, true);
      clearTouchTimer();
      scrollEl?.removeEventListener('touchstart', handleTouchStart);
      scrollEl?.removeEventListener('touchmove', handleTouchMove);
      scrollEl?.removeEventListener('touchend', clearTouchTimer);
      scrollEl?.removeEventListener('touchcancel', clearTouchTimer);
      scrollContainer?.removeEventListener('wheel', handleWheelCapture, true);
      scrollContainer?.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [sessionName, onReady, connectWebSocket, reconnect, sendInput, paste, focus, blur, copySelection, hasSelection, enterSelectMode, scrollToCursor, getOverlaySelection, syncSize, followSoon, updatePlace]);

  // Live settings: text size and palette apply to the open terminal.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || term.options.fontSize === settings.fontSize) return;
    term.options.fontSize = settings.fontSize;
    syncSize();
    followSoon();
  }, [settings.fontSize, syncSize, followSoon]);

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.theme = terminalTheme();
    term.options.minimumContrastRatio = terminalMinContrast();
  }, [themeKey]);

  // Shown again after being hidden: the size may have changed meanwhile.
  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => { syncSize(); followSoon(); });
    return () => cancelAnimationFrame(id);
  }, [active, syncSize, followSoon]);

  const palette = terminalTheme();

  return (
    <div className="terminal-shell">
      <div
        ref={scrollContainerRef}
        className="terminal-scroll-container"
      >
        <div
          ref={containerRef}
          className="terminal-inner"
        />
      </div>

      {!connected && (everConnected || slow) && (
        <div className="conn-banner" role="status">
          <LoaderCircle size={14} className="anim-spin" />
          <span>{everConnected ? 'Connection lost. Reconnecting…' : 'Connecting…'}</span>
          <button className="btn btn-sm !min-h-[28px] !px-2.5 !rounded-full" onClick={reconnect}>
            <RotateCw size={13} /> Retry
          </button>
        </div>
      )}

      {cursorAway !== 'visible' && selectText === null && (
        <button className="jump-pill" onClick={scrollToCursor} aria-label="Jump to the cursor">
          {cursorAway === 'below' ? <ArrowDown size={15} strokeWidth={2.25} /> : <ArrowUp size={15} strokeWidth={2.25} />}
          Cursor
        </button>
      )}

      {selectText !== null && (
        <div className="select-overlay">
          <div className="select-overlay-bar">
            <span className="select-overlay-hint">Select text, then copy</span>
            <button
              className="btn btn-sm"
              aria-pressed={unwrapCopy}
              onClick={toggleUnwrapCopy}
              title="Re-join lines that were wrapped to the terminal width when copying"
              style={unwrapCopy ? { color: 'var(--accent)', background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' } : undefined}
            >
              Unwrap
            </button>
            <button className="btn btn-sm" onClick={handleCopyAll}>
              {copiedAll ? 'Copied' : 'Copy all'}
            </button>
            <button className="btn btn-sm btn-primary" onClick={exitSelectMode}>
              Done
            </button>
          </div>
          <div ref={overlayScrollRef} className="select-overlay-scroll">
            <pre className="select-overlay-text" style={{ fontSize: settings.fontSize, color: palette.foreground }}>{selectText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
