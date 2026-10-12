// src/lib/adminAuditLogPruning.ts
import { prisma } from "@/lib/prisma";

// Audit trail for accountability/review, not a live feed like Notification
// (which filters by createdAt at query time but never deletes a row) -- this
// actually deletes, so the table doesn't grow forever. 90 days is long
// enough to review a full semester/capstone period; once a day is plenty
// for a window that wide.
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

let pollInFlight = false;

function pollOnce() {
    if (pollInFlight) return;
    pollInFlight = true;
    const cutoff = new Date(Date.now() - RETENTION_MS);
    prisma.adminAuditLog
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then(({ count }) => {
            if (count > 0) console.log(`Pruned ${count} admin audit log row(s) older than 90 days`);
        })
        .catch((error) => {
            console.error("Admin audit log pruning failed:", error);
        })
        .finally(() => {
            pollInFlight = false;
        });
}

export function startAdminAuditLogPruning(): void {
    pollOnce();
    setInterval(pollOnce, POLL_INTERVAL_MS);
}
