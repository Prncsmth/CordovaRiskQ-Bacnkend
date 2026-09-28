// src/lib/dbRetry.ts
// Retry for reads that fail because the Postgres connection dropped (Neon
// closing an idle connection, or the network blipping mid-handshake) --
// a fresh pooled connection almost always succeeds on the next try. Pure,
// no Prisma import, so it's unit-tested directly; wired into the client
// in lib/prisma.ts.

// Reads only: a write whose connection dropped may already have committed,
// so replaying it could double-insert. Those still surface as errors.
const RETRYABLE_READ_OPERATIONS = new Set([
    "findUnique",
    "findUniqueOrThrow",
    "findFirst",
    "findFirstOrThrow",
    "findMany",
    "count",
    "aggregate",
    "groupBy",
]);

export function isRetryableReadOperation(operation: string): boolean {
    return RETRYABLE_READ_OPERATIONS.has(operation);
}

const TRANSIENT_CODES = new Set([
    "P1001", // Can't reach database server
    "P1002", // Database server timed out
    "P1017", // Server has closed the connection
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
]);

const TRANSIENT_MESSAGES = [
    /connection terminated unexpectedly/i,
    /connection terminated due to connection timeout/i,
    /timeout exceeded when trying to connect/i,
    /server has closed the connection/i,
    /socket disconnected before secure tls connection/i,
];

type ErrorLike = {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
    meta?: { driverAdapterError?: { message?: unknown } };
};

export function isTransientDbError(error: unknown): boolean {
    let current: unknown = error;
    // Bounded walk down the cause chain (Prisma wraps the pg error).
    for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
        const e = current as ErrorLike;
        if (typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) return true;
        if (e.meta?.driverAdapterError?.message === "ConnectionClosed") return true;
        if (typeof e.message === "string" && TRANSIENT_MESSAGES.some((re) => re.test(e.message as string))) {
            return true;
        }
        current = e.cause;
    }
    return false;
}

export async function withDbRetry<T>(
    run: () => Promise<T>,
    {
        retries = 2,
        baseDelayMs = 200,
        sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    }: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await run();
        } catch (error) {
            if (attempt >= retries || !isTransientDbError(error)) throw error;
            await sleep(baseDelayMs * 2 ** attempt);
        }
    }
}
