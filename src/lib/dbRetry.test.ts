import assert from "node:assert/strict";
import { test } from "node:test";

import { isRetryableReadOperation, isTransientDbError, withDbRetry } from "@/lib/dbRetry";

const noSleep = async () => {};

// Shapes copied from the real errors logged when the Neon connection drops.
const terminated = new Error("Connection terminated unexpectedly");
const tlsDropped = Object.assign(
    new Error("Client network socket disconnected before secure TLS connection was established"),
    { code: "ECONNRESET" },
);
const serverClosed = Object.assign(new Error("Server has closed the connection."), {
    code: "P1017",
    meta: { driverAdapterError: { message: "ConnectionClosed" } },
});

test("isTransientDbError recognizes the dropped-connection errors seen in production logs", () => {
    assert.equal(isTransientDbError(terminated), true);
    assert.equal(isTransientDbError(tlsDropped), true);
    assert.equal(isTransientDbError(serverClosed), true);
});

test("isTransientDbError follows the cause chain", () => {
    const wrapped = new Error("query failed", { cause: terminated });
    assert.equal(isTransientDbError(wrapped), true);
});

test("isTransientDbError rejects ordinary query errors", () => {
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const notFound = Object.assign(new Error("Record not found"), { code: "P2025" });
    assert.equal(isTransientDbError(uniqueViolation), false);
    assert.equal(isTransientDbError(notFound), false);
    assert.equal(isTransientDbError(new Error("boom")), false);
    assert.equal(isTransientDbError(undefined), false);
    assert.equal(isTransientDbError("Connection terminated unexpectedly"), false);
});

test("withDbRetry retries a transient failure and returns the eventual result", async () => {
    let calls = 0;
    const result = await withDbRetry(
        async () => {
            calls++;
            if (calls < 3) throw terminated;
            return "rows";
        },
        { sleep: noSleep },
    );
    assert.equal(result, "rows");
    assert.equal(calls, 3);
});

test("withDbRetry gives up after the retry budget and rethrows the last error", async () => {
    let calls = 0;
    await assert.rejects(
        withDbRetry(
            async () => {
                calls++;
                throw serverClosed;
            },
            { retries: 2, sleep: noSleep },
        ),
        serverClosed,
    );
    assert.equal(calls, 3);
});

test("withDbRetry does not retry non-transient errors", async () => {
    let calls = 0;
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    await assert.rejects(
        withDbRetry(
            async () => {
                calls++;
                throw uniqueViolation;
            },
            { sleep: noSleep },
        ),
        uniqueViolation,
    );
    assert.equal(calls, 1);
});

test("withDbRetry backs off between attempts", async () => {
    const delays: number[] = [];
    let calls = 0;
    await withDbRetry(
        async () => {
            calls++;
            if (calls < 3) throw tlsDropped;
            return null;
        },
        { baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) },
    );
    assert.deepEqual(delays, [100, 200]);
});

test("isRetryableReadOperation allows reads and never writes", () => {
    for (const op of ["findMany", "findUnique", "findFirst", "findUniqueOrThrow", "findFirstOrThrow", "count", "aggregate", "groupBy"]) {
        assert.equal(isRetryableReadOperation(op), true, op);
    }
    for (const op of ["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany", "$queryRaw", "$executeRaw"]) {
        assert.equal(isRetryableReadOperation(op), false, op);
    }
});
