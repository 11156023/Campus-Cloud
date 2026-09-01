export function createRubricAnalysisAutosave({ save, onError, delay = 650 }) {
  let timer = null;
  let pending = null;
  let inFlight = null;
  let disposed = false;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function flush() {
    clearTimer();
    let succeeded = true;

    while (!disposed && (pending !== null || inFlight !== null)) {
      if (inFlight !== null) {
        succeeded = (await inFlight) && succeeded;
        continue;
      }

      const value = pending;
      pending = null;
      inFlight = Promise.resolve()
        .then(() => save(value))
        .then(() => true)
        .catch((error) => {
          onError?.(error);
          return false;
        })
        .finally(() => {
          inFlight = null;
        });
      const saved = await inFlight;
      succeeded = saved && succeeded;
      if (!saved) {
        pending = null;
        return false;
      }
    }

    return succeeded;
  }

  function schedule(value) {
    if (disposed) return;
    pending = value;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  }

  function dispose() {
    disposed = true;
    pending = null;
    clearTimer();
  }

  return {
    schedule,
    flush,
    dispose,
    isPending: () => pending !== null || inFlight !== null || timer !== null,
  };
}
