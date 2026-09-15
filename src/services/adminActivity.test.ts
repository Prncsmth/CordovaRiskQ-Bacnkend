import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeRecentActivity } from "@/services/adminActivity";

test("mergeRecentActivity sorts items by occurredAt descending", () => {
    const result = mergeRecentActivity([
        { type: "user_registered", title: "a", detail: "a", occurredAt: "2026-01-01T00:00:00Z" },
        { type: "sos_alert", title: "b", detail: "b", occurredAt: "2026-01-03T00:00:00Z" },
        { type: "incident_resolved", title: "c", detail: "c", occurredAt: "2026-01-02T00:00:00Z" },
    ]);
    assert.deepEqual(result.map((i) => i.title), ["b", "c", "a"]);
});

test("mergeRecentActivity caps the result at the given limit, keeping the most recent", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
        type: "sos_alert" as const,
        title: `item-${i}`,
        detail: "",
        occurredAt: new Date(2026, 0, i + 1).toISOString(),
    }));

    const result = mergeRecentActivity(items, 10);

    assert.equal(result.length, 10);
    assert.equal(result[0].title, "item-14");
    assert.equal(result[9].title, "item-5");
});

test("mergeRecentActivity defaults to a limit of 10", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
        type: "sos_alert" as const,
        title: `item-${i}`,
        detail: "",
        occurredAt: new Date(2026, 0, i + 1).toISOString(),
    }));

    assert.equal(mergeRecentActivity(items).length, 10);
});

test("mergeRecentActivity does not mutate the input array", () => {
    const items = [
        { type: "sos_alert" as const, title: "a", detail: "", occurredAt: "2026-01-01T00:00:00Z" },
        { type: "sos_alert" as const, title: "b", detail: "", occurredAt: "2026-01-02T00:00:00Z" },
    ];
    const original = [...items];

    mergeRecentActivity(items);

    assert.deepEqual(items, original);
});
