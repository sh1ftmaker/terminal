// Home view switcher on the canvas: back to the session list, or stay.
// The choice is remembered per device (localStorage) by App.tsx.

interface HomeTabsProps {
  current: 'list' | 'canvas';
  onSwitch: (view: 'list' | 'canvas') => void;
  glass?: boolean;
}

export default function HomeTabs({ current, onSwitch, glass }: HomeTabsProps) {
  return (
    <div
      className={`flex gap-0.5 p-1 rounded-full ${glass ? 'glass' : 'seg'}`}
      role="tablist"
      aria-label="Home view"
    >
      {(['list', 'canvas'] as const).map((v) => (
        <button
          key={v}
          role="tab"
          aria-selected={current === v}
          onClick={() => onSwitch(v)}
          className="px-3.5 min-h-[34px] rounded-full text-[13px] font-semibold transition-colors"
          style={current === v
            ? { background: glass ? 'var(--cv-accent)' : 'var(--accent)', color: glass ? 'var(--cv-bg)' : 'var(--accent-ink)' }
            : { color: glass ? 'var(--cv-ink-dim)' : 'var(--ink-2)' }}
        >
          {v === 'list' ? 'Sessions' : 'Canvas'}
        </button>
      ))}
    </div>
  );
}
