// Compose box: write (or dictate) a whole message in a real text field, then
// send it to the terminal in one go. Sits directly above the key bar.

import { useLayoutEffect } from 'react';
import { ArrowUp } from 'lucide-react';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** `enter`: also press Enter after the text. */
  onSend: (text: string, enter: boolean) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export default function Composer({ value, onChange, onSend, onClose, inputRef }: ComposerProps) {
  // Grow with the text, up to the CSS max-height.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value, inputRef]);

  const send = (enter: boolean) => {
    if (!value) return;
    onSend(value, enter);
  };

  return (
    <div className="composer">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Type or dictate…"
        rows={1}
        enterKeyHint="send"
        autoCapitalize="sentences"
        className="composer-input"
        aria-label="Message to send to the terminal"
      />
      <button
        className="btn btn-ghost !px-2.5 !min-h-[42px] text-[13.5px]"
        disabled={!value}
        // Keep focus in the text field so the keyboard stays up.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => send(false)}
        title="Type the text into the terminal without pressing Enter"
      >
        Insert
      </button>
      <button
        className="btn btn-primary !p-0 !w-[42px] !min-h-[42px] !rounded-full flex-shrink-0"
        disabled={!value}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => send(true)}
        aria-label="Send and press Enter"
        title="Send and press Enter"
      >
        <ArrowUp size={20} strokeWidth={2.4} />
      </button>
    </div>
  );
}
