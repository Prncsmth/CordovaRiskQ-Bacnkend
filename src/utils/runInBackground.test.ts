import assert from "node:assert/strict";
import { test } from "node:test";

import { runInBackground } from "@/utils/runInBackground";

test("runInBackground returns before the task settles", async () => {
    let settled = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });

    const result = runInBackground("slow task", async () => {
        await gate;
        settled = true;
    });

    assert.equal(result, undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);

    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, true);
});

test("runInBackground logs a rejected task instead of throwing", async (t) => {
    const errorLog = t.mock.method(console, "error", () => {});
    const failure = new Error("expo down");

    assert.doesNotThrow(() => runInBackground("push", () => Promise.reject(failure)));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(errorLog.mock.callCount(), 1);
    assert.match(String(errorLog.mock.calls[0].arguments[0]), /push/);
    assert.equal(errorLog.mock.calls[0].arguments[1], failure);
});

test("runInBackground logs a task that throws synchronously", async (t) => {
    const errorLog = t.mock.method(console, "error", () => {});

    assert.doesNotThrow(() =>
        runInBackground("sync throw", () => {
            throw new Error("boom");
        }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(errorLog.mock.callCount(), 1);
});
