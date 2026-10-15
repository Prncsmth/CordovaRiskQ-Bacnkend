// src/services/adminAuditDetails.ts
// The human-readable "what changed" part of an AdminAuditLog row's detail
// (adminAuditLog.service.ts prefixes the admin's name). Pure, so the exact
// wording is unit-tested. Never put a password, code or token in here.
import type { AdminCloseOutcome } from "@/services/sosAlertStatus";

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function describeEvacuationCenterChange(
    name: string,
    before: { status: string; facilities: string[] },
    after: { status: string; facilities: string[] },
): string {
    const changes: string[] = [];
    if (before.status !== after.status) {
        changes.push(`status ${capitalize(before.status)} → ${capitalize(after.status)}`);
    }
    const added = after.facilities.filter((f) => !before.facilities.includes(f));
    const removed = before.facilities.filter((f) => !after.facilities.includes(f));
    if (added.length > 0) changes.push(`added ${added.join(", ")}`);
    if (removed.length > 0) changes.push(`removed ${removed.join(", ")}`);
    return `${name}: ${changes.length > 0 ? changes.join("; ") : "saved with no changes"}`;
}

type HotlineFields = { name: string; number: string; category: string };

export function describeHotlineChange(before: HotlineFields, after: HotlineFields): string {
    const changes = (["number", "name", "category"] as const)
        .filter((field) => before[field] !== after[field])
        .map((field) => `${field} ${before[field]} → ${after[field]}`);
    // Name first reads better when the name itself changed.
    changes.sort((a, b) => Number(b.startsWith("name")) - Number(a.startsWith("name")));
    return `${after.name}: ${changes.length > 0 ? changes.join("; ") : "saved with no changes"}`;
}

export function describeSosClose(outcome: AdminCloseOutcome, location: string | null): string {
    const verb = outcome === "resolved" ? "Resolved" : "Dismissed";
    return location ? `${verb} the SOS alert at ${location}` : `${verb} an SOS alert (location unavailable)`;
}

export function describeProfileChange(before: { name: string | null }, after: { name: string | null }): string {
    if (before.name !== after.name) {
        return `Changed their name from "${before.name ?? ""}" to "${after.name ?? ""}"`;
    }
    return "Updated their profile";
}
