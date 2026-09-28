// src/utils/runInBackground.ts
// Fire-and-forget for side effects (e.g. push fan-out) that must never delay
// or fail the request that triggered them. The task starts on the next
// microtask; any rejection -- or synchronous throw -- is logged, not raised.
export function runInBackground(label: string, task: () => Promise<unknown>): void {
    void Promise.resolve()
        .then(task)
        .catch((error) => {
            console.error(`Background task failed: ${label}`, error);
        });
}
