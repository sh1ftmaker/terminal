import { useCallback, useRef } from 'react';

/**
 * Touch-and-hold. Returns handlers to spread on the element, plus
 * `consumeClick()` which reports (once) whether the click that follows the
 * release belongs to a long press and should be swallowed.
 */
export function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef(0);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;   // mice have a context menu
    fired.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    cancel();
    timer.current = window.setTimeout(() => {
      fired.current = true;
      onLongPress();
    }, ms);
  }, [cancel, ms, onLongPress]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!timer.current) return;
    if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) cancel();
  }, [cancel]);

  const consumeClick = useCallback(() => {
    const was = fired.current;
    fired.current = false;
    return was;
  }, []);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel },
    consumeClick,
  };
}
