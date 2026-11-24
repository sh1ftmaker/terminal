import { Check, CircleDashed, LoaderCircle, MessageCircleQuestion, SquareTerminal } from 'lucide-react';
import { STATUS, type SessionStatus } from '../../lib/sessions';

interface StatusTileProps {
  status: SessionStatus | null;
  size?: number;
}

// Leading glyph of a session: shape *and* colour carry the state, so it reads
// without relying on hue alone.
export default function StatusTile({ status, size = 38 }: StatusTileProps) {
  const tone = status ? STATUS[status].tone : 'var(--ink-3)';
  const icon = Math.round(size * 0.5);
  return (
    <span
      className="status-tile"
      style={{ ['--tone' as string]: tone, width: size, height: size, borderRadius: Math.round(size * 0.29) }}
      title={status ? STATUS[status].label : 'Shell'}
      aria-hidden="true"
    >
      {status === 'working' && <LoaderCircle size={icon} strokeWidth={2.25} className="anim-spin" style={{ animationDuration: '1.6s' }} />}
      {status === 'waiting' && <MessageCircleQuestion size={icon} strokeWidth={2} />}
      {status === 'finished' && <Check size={icon} strokeWidth={2.5} />}
      {status === 'idle' && <CircleDashed size={icon} strokeWidth={2} />}
      {!status && <SquareTerminal size={icon} strokeWidth={1.9} />}
    </span>
  );
}
