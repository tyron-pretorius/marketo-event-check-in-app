// A tiny keyed async mutex. Every route that does load-state -> mutate ->
// save-state runs its critical section through withLock(key, fn) so two
// such cycles for the same event can never interleave — without this, a
// slow multi-step operation (like /sync awaiting several Marketo calls)
// can have its final save clobber a check-in another device wrote to disk
// while it was still running, silently erasing it and leaving whatever
// status sync already sent to Marketo uncorrectable from the app.
//
// Callers queued behind a lock simply wait their turn (typically
// milliseconds; a few seconds at worst behind a slow sync) and then run
// against the already-updated file — no lost updates, no double-writes.

const queues = new Map(); // key -> tail promise of the queue

export function withLock(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  // Keep the queue moving even if fn throws — store a version that
  // swallows the error so one failed request doesn't wedge the lock for
  // everyone after it. The real result/error still propagates to this
  // call's own caller via `run`.
  queues.set(key, run.then(
    () => {},
    () => {}
  ));
  return run;
}
