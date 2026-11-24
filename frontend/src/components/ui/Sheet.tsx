// Bottom sheet on phones, centred dialog on larger screens. Lives in a portal
// on #root, which is sized to the *visible* viewport — so a sheet with an
// input in it rides on top of the soft keyboard.

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Short line under the title. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Pinned below the scrolling body (primary actions). */
  footer?: ReactNode;
  /** Hide the close button (action sheets close via their own rows). */
  bare?: boolean;
}

export default function Sheet({ open, onClose, title, subtitle, children, footer, bare }: SheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    // Focus the sheet itself unless something inside asked for focus already.
    const el = sheetRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Hand focus back, except to text inputs: refocusing one would pop the
      // soft keyboard open again behind the closing sheet.
      if (previous && previous.isConnected && !/^(TEXTAREA|INPUT)$/.test(previous.tagName)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]);

  // Drag the header down to dismiss.
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const onDragStart = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    drag.current = { y: e.clientY, dy: 0 };
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = sheetRef.current;
    if (!d || !el) return;
    d.dy = Math.max(0, e.clientY - d.y);
    el.style.transition = 'none';
    el.style.transform = `translateY(${d.dy}px)`;
  };
  const onDragEnd = () => {
    const d = drag.current;
    const el = sheetRef.current;
    drag.current = null;
    if (!d || !el) return;
    el.style.transition = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    if (d.dy > 90) {
      el.style.transform = 'translateY(100%)';
      window.setTimeout(() => onCloseRef.current(), 140);
    } else {
      el.style.transform = '';
    }
  };

  if (!open) return null;
  const host = document.getElementById('root');
  if (!host) return null;

  return createPortal(
    <div className="sheet-root">
      <div className="sheet-scrim" onClick={onClose} />
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{ outline: 'none' }}
      >
        <div
          className="flex-shrink-0 touch-none"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="sheet-grabber" />
          {(title || !bare) && (
            <div className="flex items-start gap-3 pl-5 pr-2 pt-2 pb-1 min-h-[52px]">
              <div className="min-w-0 flex-1 pt-2">
                {title && <h2 id={titleId} className="m-0 text-[17px] font-semibold tracking-[-0.01em] truncate">{title}</h2>}
                {subtitle && <p className="m-0 mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
              </div>
              {!bare && (
                <button className="icon-btn" onClick={onClose} aria-label="Close">
                  <X size={20} strokeWidth={2} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="scroll-y flex-1 min-h-0 px-5 pb-5 pt-1">{children}</div>
        {footer && <div className="flex-shrink-0 px-5 pb-4 pt-3 border-t border-line">{footer}</div>}
      </div>
    </div>,
    host,
  );
}
