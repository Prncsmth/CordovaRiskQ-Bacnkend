// src/services/announcementPriority.ts
// Announcement severity, stored in the existing `priority` column (a plain
// string, so no migration): Information, Warning or Critical, chosen by the
// publishing admin. The admin dashboard and the mobile apps style the
// announcement from this value alone.
//
// Older rows (and an older admin build) use "Normal" / "Urgent". Normal is
// Information. Urgent is mapped to Warning, not Critical: it was used for
// any important notice, and only an admin choosing Critical should make an
// announcement look like an imminent-threat alert. An admin can raise it by
// editing the announcement.
export const ANNOUNCEMENT_PRIORITIES = ["Information", "Warning", "Critical"] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

const LEGACY_PRIORITIES: Record<string, AnnouncementPriority> = {
    Normal: "Information",
    Urgent: "Warning",
};

// Every value the API accepts on create/update (the legacy ones are saved
// as their new name).
export const ACCEPTED_PRIORITY_INPUTS = [
    ...ANNOUNCEMENT_PRIORITIES,
    ...(Object.keys(LEGACY_PRIORITIES) as ["Normal", "Urgent"]),
] as const;

export function normalizeAnnouncementPriority(value: string | null | undefined): AnnouncementPriority {
    if (value && (ANNOUNCEMENT_PRIORITIES as readonly string[]).includes(value)) {
        return value as AnnouncementPriority;
    }
    return (value && LEGACY_PRIORITIES[value]) || "Information";
}

// The stored values that mean `level`, so filtering by Warning also finds
// rows still saved as "Urgent".
export function storedPriorityValues(level: string): string[] {
    const legacy = Object.entries(LEGACY_PRIORITIES)
        .filter(([, mapped]) => mapped === level)
        .map(([old]) => old);
    return [level, ...legacy];
}

// Applied to every announcement the API returns, so clients only ever see
// the three current levels.
export function withNormalizedPriority<T extends { priority: string }>(row: T): T;
export function withNormalizedPriority<T extends { priority: string }>(row: T | null): T | null;
export function withNormalizedPriority<T extends { priority: string }>(row: T | null): T | null {
    return row ? { ...row, priority: normalizeAnnouncementPriority(row.priority) } : null;
}
