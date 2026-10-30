/** Combine cancellation lifetimes using APIs available in Safari 16. */
export function anySignal(signals: ReadonlyArray<AbortSignal>): AbortSignal {
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const abort = (source: AbortSignal) => {
    controller.abort(source.reason);
    for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    listeners.clear();
  };
  for (const signal of new Set(signals)) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    const listener = () => { abort(signal); };
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }
  return controller.signal;
}
