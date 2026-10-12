import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ANNOUNCEMENT_PRIORITIES,
    normalizeAnnouncementPriority,
    storedPriorityValues,
    withNormalizedPriority,
} from "@/services/announcementPriority";
import { createAnnouncementSchema, updateAnnouncementSchema } from "@/validations/announcement.validation";

const base = { title: "Advisory", content: "Details", audience: "All Users" as const };

test("the three severity levels, lowest to highest", () => {
    assert.deepEqual([...ANNOUNCEMENT_PRIORITIES], ["Information", "Warning", "Critical"]);
});

test("legacy values map safely: Normal -> Information, Urgent -> Warning (never Critical)", () => {
    assert.equal(normalizeAnnouncementPriority("Normal"), "Information");
    assert.equal(normalizeAnnouncementPriority("Urgent"), "Warning");
});

test("current values pass through; anything unknown or missing is Information", () => {
    for (const p of ANNOUNCEMENT_PRIORITIES) assert.equal(normalizeAnnouncementPriority(p), p);
    assert.equal(normalizeAnnouncementPriority(null), "Information");
    assert.equal(normalizeAnnouncementPriority("whatever"), "Information");
});

test("the schema accepts the three levels and stores them as-is", () => {
    for (const priority of ANNOUNCEMENT_PRIORITIES) {
        const parsed = createAnnouncementSchema.parse({ ...base, priority });
        assert.equal(parsed.priority, priority);
    }
});

test("the schema still accepts an older admin's Normal/Urgent, saving the new value", () => {
    assert.equal(createAnnouncementSchema.parse({ ...base, priority: "Normal" }).priority, "Information");
    assert.equal(updateAnnouncementSchema.parse({ ...base, priority: "Urgent" }).priority, "Warning");
});

test("the schema rejects any other severity", () => {
    assert.equal(createAnnouncementSchema.safeParse({ ...base, priority: "Emergency" }).success, false);
    assert.equal(createAnnouncementSchema.safeParse({ ...base, priority: "critical" }).success, false);
});

test("filtering by a level also finds legacy rows stored under its old name", () => {
    assert.deepEqual(storedPriorityValues("Information").sort(), ["Information", "Normal"].sort());
    assert.deepEqual(storedPriorityValues("Warning").sort(), ["Urgent", "Warning"].sort());
    assert.deepEqual(storedPriorityValues("Critical"), ["Critical"]);
});

test("rows read back from the database always carry a current level", () => {
    assert.deepEqual(withNormalizedPriority({ id: "a", priority: "Urgent" }), { id: "a", priority: "Warning" });
    assert.equal(withNormalizedPriority(null), null);
});
