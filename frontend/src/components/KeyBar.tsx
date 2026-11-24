// On-screen key bar, docked above the soft keyboard: the keys a phone
// keyboard lacks (Esc, Tab, Ctrl, Alt, arrows) plus the one-tap actions
// (interrupt, tmux prefix, compose, paste, copy, show/hide keyboard).
//
// One compact row under the header: the most-used keys first, the rest
// scroll sideways on a phone; the keyboard toggle is pinned at the end.
//
// Keys never take focus: pressing one must not dismiss the soft keyboard
// when it is up, nor summon it when it is down.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowBigUp, ArrowDown, ArrowLeft, ArrowRight, ArrowRightToLine, ArrowUp, ClipboardPaste, Copy, CornerDownLeft,
  Keyboard, KeyboardOff, PenLine,
} from 'lucide-react';
import { REPEATS, haptic, type KeyId, type ModName, type Mods } from '../lib/keys';
import { useSettings } from '../lib/settings';

export type KeyBarAction = 'compose' | 'paste' | 'copy' | 'keyboard';

interface KeyBarProps {
  mods: Mods;
  onKey: (id: KeyId) => void;
  onModifier: (name: ModName) => void;
  onAction: (action: KeyBarAction) => void;
  composeOpen: boolean;
  /** A text field (terminal or composer) has focus, i.e. the keyboard is up. */
  typing: boolean;
}

const REPEAT_DELAY = 380;
const REPEAT_EVERY = 65;

interface KeyProps {
  label: ReactNode;
  title: string;
  className?: string;
  /** Fires on touch-down (and repeats while held, if `repeat`). */
  onPress?: () => void;
  repeat?: boolean;
  /**
   * Fires on click instead. For actions that need a user activation the
   * browser only grants on release (clipboard read, focusing an input).
   */
  onClick?: () => void;
  pressed?: boolean;
  mod?: 'armed' | 'locked';
  haptics: boolean;
}

function Key({ label, title, className, onPress, repeat, onClick, pressed, mod, haptics }: KeyProps) {
  const [down, setDown] = useState(false);
  const timers = useRef<{ delay: number; every: number }>({ delay: 0, every: 0 });
  // Held keys repeat from a timer: it must call the latest handler (the
  // modifiers may have changed since the press began).
  const onPressRef = useRef(onPress);
  useEffect(() => { onPressRef.current = onPress; });

  const stop = useCallback(() => {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.every);
    timers.current = { delay: 0, every: 0 };
    setDown(false);
  }, []);

  useEffect(() => stop, [stop]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setDown(true);
    haptic(haptics);
    // Click-activated keys must leave the gesture alone so the browser still
    // turns it into a click; the mousedown handler below is what keeps focus
    // (and with it the soft keyboard's state) where it is.
    if (!onPress) return;
    e.preventDefault();
    onPressRef.current?.();
    if (repeat) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      timers.current.delay = window.setTimeout(() => {
        timers.current.every = window.setInterval(() => onPressRef.current?.(), REPEAT_EVERY);
      }, REPEAT_DELAY);
    }
  };

  return (
    <button
      type="button"
      tabIndex={-1}
      title={title}
      aria-label={title}
      aria-pressed={pressed ?? (mod ? true : undefined)}
      data-mod={mod}
      className={`key ${down ? 'is-pressed' : ''} ${className ?? ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (onClick) onClick();
        // Keyboard activation (Enter/Space on a focused key) has no pointer.
        else if (e.detail === 0) onPressRef.current?.();
      }}
    >
      {label}
    </button>
  );
}

export default function KeyBar({ mods, onKey, onModifier, onAction, composeOpen, typing }: KeyBarProps) {
  const { haptics } = useSettings();
  const icon = { size: 17, strokeWidth: 2 } as const;
  const modState = (name: ModName) => (mods[name] === 'off' ? undefined : mods[name]);

  const key = (id: KeyId, label: ReactNode, title: string, className?: string) => (
    <Key key={id} label={label} title={title} className={className} haptics={haptics} repeat={REPEATS.has(id)} onPress={() => onKey(id)} />
  );

  return (
    <div className="keybar" role="toolbar" aria-label="Terminal keys">
      <div className="keybar-row no-scrollbar">
        {key('esc', 'esc', 'Escape')}
        {key('tab', 'tab', 'Tab')}
        <Key label="ctrl" title="Control (tap: next key, double-tap: lock)" haptics={haptics} mod={modState('ctrl')} pressed={mods.ctrl !== 'off'} onPress={() => onModifier('ctrl')} />
        <Key label="alt" title="Alt (tap: next key, double-tap: lock)" haptics={haptics} mod={modState('alt')} pressed={mods.alt !== 'off'} onPress={() => onModifier('alt')} />
        {key('interrupt', '^C', 'Interrupt (Ctrl+C)', 'key-danger')}
        {key('left', <ArrowLeft {...icon} />, 'Left')}
        {key('down', <ArrowDown {...icon} />, 'Down')}
        {key('up', <ArrowUp {...icon} />, 'Up')}
        {key('right', <ArrowRight {...icon} />, 'Right')}
        {key('enter', <CornerDownLeft {...icon} />, 'Enter')}
        {key('backtab', <span className="inline-flex items-center"><ArrowBigUp size={13} strokeWidth={2} /><ArrowRightToLine size={14} strokeWidth={2} /></span>, 'Shift+Tab')}
        {key('slash', <span className="text-[15px]">/</span>, 'Slash')}
        {key('dash', <span className="text-[15px]">-</span>, 'Dash')}
        {key('pipe', <span className="text-[15px]">|</span>, 'Pipe')}
        {key('tilde', <span className="text-[15px]">~</span>, 'Tilde')}
        {key('prefix', '^B', 'Ctrl+B (tmux prefix)', 'key-quiet')}
        <Key label={<PenLine {...icon} />} title="Compose: type or dictate, then send" className="key-quiet" haptics={haptics} pressed={composeOpen} onClick={() => onAction('compose')} />
        <Key label={<ClipboardPaste {...icon} />} title="Paste" className="key-quiet" haptics={haptics} onClick={() => onAction('paste')} />
        <Key label={<Copy {...icon} />} title="Copy the selection, or select text" className="key-quiet" haptics={haptics} onClick={() => onAction('copy')} />
      </div>
      <Key
        label={typing ? <KeyboardOff {...icon} /> : <Keyboard {...icon} />}
        title={typing ? 'Hide keyboard' : 'Show keyboard'}
        className="key-quiet key-pin"
        haptics={haptics}
        onClick={() => onAction('keyboard')}
      />
    </div>
  );
}
