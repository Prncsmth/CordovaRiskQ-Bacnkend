import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { ITXClientDenyList } from "@/generated/prisma/runtime/client";
import { isRetryableReadOperation, withDbRetry } from "@/lib/dbRetry";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg(
    {
        connectionString,
        // pg's default is to wait forever for a new connection -- fail fast
        // instead so a request doesn't hang on a stalled TLS handshake.
        connectionTimeoutMillis: 10_000,
        // Drop idle connections well before Neon's side closes them, so the
        // pool rarely hands out a socket that's already dead.
        idleTimeoutMillis: 30_000,
        keepAlive: true,
    },
    {
        onPoolError: (err) => console.error("Postgres idle client error:", err.message),
        onConnectionError: (err) => console.error("Postgres connection error:", err.message),
    },
);

// Reads that hit a dropped connection are retried on a fresh one (see
// dbRetry.ts); writes are never replayed.
const prisma = new PrismaClient({ adapter }).$extends({
    query: {
        $allModels: {
            $allOperations({ operation, args, query }) {
                return isRetryableReadOperation(operation) ? withDbRetry(() => query(args)) : query(args);
            },
        },
    },
});

// The interactive-transaction client of the extended `prisma` above --
// use this instead of Prisma.TransactionClient, which describes the
// unextended client and no longer matches.
type DbTransactionClient = Omit<typeof prisma, ITXClientDenyList>;

export { prisma, type DbTransactionClient };
