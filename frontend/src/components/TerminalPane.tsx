// A terminal with everything needed to drive it by touch: the terminal
// itself, the compose box and the key bar. Used full-screen by TerminalView
// and inside the canvas focus overlay.

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Terminal, { type TerminalHandle } from './Terminal';
import KeyBar, { type KeyBarAction } from './KeyBar';
import Composer from './Composer';
import { readClipboardText } from '../lib/clipboard';
import { NO_MODS, applyMods, encodeKey, releaseArmed, tapModifier, type KeyId, type ModName, type Mods } from '../lib/keys';
import { toast } from './ui/toast';

interface TerminalPaneProps {
  sessionName: string;
  context?: string;
  onConnectionChange?: (connected: boolean, connecting: boolean) => void;
  /** False while mounted but hidden behind another tab. */
  active?: boolean;
  /** Focus the terminal when it opens (pointer devices only). */
  autoFocus?: boolean;
}

function isTextField(el: Element | null): boolean {
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
}

export default function TerminalPane({ sessionName, context, onConnectionChange, active = true, autoFocus = false }: TerminalPaneProps) {
  const [handle, setHandle] = useState<TerminalHandle | null>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  useEffect(() => { handleRef.current = handle; }, [handle]);

  // With a hardware keyboard, opening a terminal means typing in it. On
  // touch screens focus would raise the soft keyboard over the output the
  // user came to look at, so there it waits for a tap.
  useEffect(() => {
    if (autoFocus && handle && active && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) handle.focus();
  }, [autoFocus, handle, active]);

  // Sticky modifiers. The ref is what input handlers read (they outlive
  // renders); the state is what the key bar draws.
  const [mods, setModsState] = useState<Mods>(NO_MODS);
  const modsRef = useRef<Mods>(NO_MODS);
  const lastTap = useRef<Record<ModName, number>>({ ctrl: 0, alt: 0 });
  const setMods = useCallback((next: Mods) => {
    if (next === modsRef.current) return;
    modsRef.current = next;
    setModsState(next);
  }, []);

  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState(false);

  // Whether a text field in this pane has focus (the keyboard is up).
  useEffect(() => {
    const update = () => {
      const el = document.activeElement;
      setTyping(isTextField(el) && !!rootRef.current?.contains(el));
    };
    update();
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);

  // Keyboard input: a single typed character picks up the armed modifiers.
  const transformInput = useCallback((data: string) => {
    const out = applyMods(data, modsRef.current);
    if (out !== data || [...data].length === 1) setMods(releaseArmed(modsRef.current));
    return out;
  }, [setMods]);

  const handleKey = useCallback((id: KeyId) => {
    const term = handleRef.current;
    if (!term) return;
    term.sendInput(encodeKey(id, modsRef.current));
    setMods(releaseArmed(modsRef.current));
  }, [setMods]);

  const handleModifier = useCallback((name: ModName) => {
    const now = performance.now();
    const next = tapModifier(modsRef.current[name], now - lastTap.current[name]);
    lastTap.current[name] = now;
    setMods({ ...modsRef.current, [name]: next });
  }, [setMods]);

  const openComposer = useCallback(() => {
    // Mount and focus inside the tap itself: iOS only raises the keyboard
    // for a focus() that happens synchronously in a user gesture.
    flushSync(() => setComposeOpen(true));
    composerRef.current?.focus();
  }, []);

  const closeComposer = useCallback(() => {
    const hadFocus = document.activeElement === composerRef.current;
    setComposeOpen(false);
    // The keyboard was up for the composer: hand it to the terminal.
    if (hadFocus) handleRef.current?.focus();
  }, []);

  const handleAction = useCallback(async (action: KeyBarAction) => {
    const term = handleRef.current;
    if (!term) return;
    if (action === 'compose') {
      if (composeOpen) closeComposer();
      else openComposer();
    } else if (action === 'keyboard') {
      const el = document.activeElement as HTMLElement | null;
      if (isTextField(el) && rootRef.current?.contains(el)) el?.blur();
      else if (composeOpen) composerRef.current?.focus();
      else term.focus();
    } else if (action === 'copy') {
      if (term.hasSelection()) {
        toast((await term.copySelection()) ? 'Copied' : 'Copy failed');
      } else {
        // Nothing selected — open the plain-text overlay for native selection
        term.enterSelectMode();
      }
    } else if (action === 'paste') {
      const text = await readClipboardText();
      if (text) {
        term.paste(text);
      } else {
        // Clipboard API unavailable (http origin) or permission denied — open
        // the text box so the user can paste natively and send.
        openComposer();
        toast('Paste into the box, then send');
      }
    }
  }, [composeOpen, closeComposer, openComposer]);

  const handleSend = useCallback((text: string, enter: boolean) => {
    const term = handleRef.current;
    if (!term) return;
    // paste() keeps a multi-line message in one piece (bracketed paste); a
    // raw write would run it line by line.
    term.paste(text);
    if (enter) window.setTimeout(() => handleRef.current?.sendInput('\r'), 30);
    setDraft('');
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col h-full min-h-0">
      <Terminal
        sessionName={sessionName}
        context={context}
        onReady={setHandle}
        onConnectionChange={onConnectionChange}
        transformInput={transformInput}
        active={active}
      />
      {composeOpen && (
        <Composer value={draft} onChange={setDraft} onSend={handleSend} onClose={closeComposer} inputRef={composerRef} />
      )}
      <KeyBar
        mods={mods}
        onKey={handleKey}
        onModifier={handleModifier}
        onAction={handleAction}
        composeOpen={composeOpen}
        typing={typing}
      />
    </div>
  );
}
