import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCurrentAnnouncement } from "@/services/announcementCurrent";

test("a live (never-deleted) newest row is current", () => {
    const row = { id: "a", deletedAt: null };
    assert.equal(resolveCurrentAnnouncement(row), row);
});

test("a deleted newest row means no current announcement -- not null-coalesced to anything else", () => {
    const row = { id: "a", deletedAt: new Date() };
    assert.equal(resolveCurrentAnnouncement(row), null);
});

test("no announcements at all (findFirst returned null) means no current announcement", () => {
    assert.equal(resolveCurrentAnnouncement(null), null);
});

test("never falls back to an older row -- it only ever sees the single newest row the caller passed in", () => {
    // This is the actual regression: resolveCurrentAnnouncement's signature
    // takes one row, not a list, so there is no "older announcement" for it
    // to promote even by accident -- the caller (getActive/
    // getActiveForResponder) is responsible for passing in the newest row
    // only, deleted or not, and this function cannot reach past it.
    const deletedNewest = { id: "newest", deletedAt: new Date() };
    assert.equal(resolveCurrentAnnouncement(deletedNewest), null);
});
