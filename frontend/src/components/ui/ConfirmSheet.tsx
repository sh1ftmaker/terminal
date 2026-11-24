import type { ReactNode } from 'react';
import Sheet from './Sheet';

interface ConfirmSheetProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// A modal yes/no, replacing window.confirm (which looks foreign in a PWA and
// is blocked outright in some standalone contexts).
export default function ConfirmSheet({ open, title, children, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmSheetProps) {
  return (
    <Sheet open={open} onClose={onCancel} title={title} bare>
      {children && <div className="text-[14px] leading-relaxed text-ink-2 -mt-1 mb-4">{children}</div>}
      <div className="flex flex-col gap-2">
        <button className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </Sheet>
  );
}
