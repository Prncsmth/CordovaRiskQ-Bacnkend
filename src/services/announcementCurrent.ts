// src/services/announcementCurrent.ts
// Pure -- no Prisma -- so this is unit-tested directly, same convention as
// announcementAudience.ts and announcementPriority.ts.
//
// Decides whether the single newest-by-createdAt row a caller already
// fetched (regardless of its own deletion status) counts as "the current
// announcement". It does only if that exact row hasn't been soft-deleted.
// This deliberately never falls back to an older row: once the newest
// published announcement is deleted, there is no current announcement --
// not the next-newest one -- until a new one is published. The caller is
// responsible for fetching "newest by createdAt" without filtering out
// deleted rows at the query level; filtering them out there would just
// reproduce the bug this exists to prevent (the next-newest surviving row
// silently becoming "current" again).
export function resolveCurrentAnnouncement<T extends { deletedAt: Date | null }>(
    latest: T | null,
): T | null {
    if (!latest || latest.deletedAt !== null) return null;
    return latest;
}
