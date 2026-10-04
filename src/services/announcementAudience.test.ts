import assert from "node:assert/strict";
import { test } from "node:test";

import {
    activeAnnouncementConditions,
    canViewAnnouncement,
    findViewableAnnouncement,
} from "@/services/announcementAudience";

test("the public card only sees All Users by default", () => {
    assert.deepEqual(activeAnnouncementConditions({}), [{ audience: "All Users" }]);
});

test("a citizen with a known barangay also sees that barangay's announcements", () => {
    assert.deepEqual(activeAnnouncementConditions({ barangayName: "Poblacion" }), [
        { audience: "All Users" },
        {
            audience: "Specific Barangay",
            barangayName: { equals: "Poblacion", mode: "insensitive" },
        },
    ]);
});

test("a responder sees All Users and Responders Only", () => {
    assert.deepEqual(activeAnnouncementConditions({ includeRespondersOnly: true }), [
        { audience: "All Users" },
        { audience: "Responders Only" },
    ]);
});

test("Responders Only is never included unless asked for", () => {
    const audiences = activeAnnouncementConditions({ barangayName: "Poblacion" }).map(
        (c) => c.audience
    );
    assert.ok(!audiences.includes("Responders Only"));
});

// --- GET /api/announcements/:id: a known UUID is not authorization ---------

const RESPONDERS_ONLY_ID = "e6c183d7-0000-4000-8000-000000000001";
const ALL_USERS_ID = "fe33cf82-0000-4000-8000-000000000002";
const store = new Map([
    [RESPONDERS_ONLY_ID, { id: RESPONDERS_ONLY_ID, audience: "Responders Only", title: "Team briefing" }],
    [ALL_USERS_ID, { id: ALL_USERS_ID, audience: "All Users", title: "Road closure" }],
]);
const findById = async (id: string) => store.get(id) ?? null;

test("a known Responders Only UUID returns nothing to an anonymous caller", async () => {
    assert.equal(await findViewableAnnouncement(RESPONDERS_ONLY_ID, null, findById), null);
});

test("a known Responders Only UUID returns nothing to a citizen", async () => {
    assert.equal(await findViewableAnnouncement(RESPONDERS_ONLY_ID, "citizen", findById), null);
});

test("a known Responders Only UUID returns nothing to any other non-responder role", async () => {
    for (const role of ["admin", "unknown-role", ""]) {
        assert.equal(await findViewableAnnouncement(RESPONDERS_ONLY_ID, role, findById), null, role);
    }
});

test("a signed-in responder can open a Responders Only announcement", async () => {
    assert.equal((await findViewableAnnouncement(RESPONDERS_ONLY_ID, "responder", findById))?.id, RESPONDERS_ONLY_ID);
});

test("All Users announcements stay public to everyone", async () => {
    for (const role of [null, "citizen", "responder", "admin"]) {
        assert.equal((await findViewableAnnouncement(ALL_USERS_ID, role, findById))?.id, ALL_USERS_ID);
    }
});

test("Specific Barangay announcements keep their existing public access", () => {
    assert.equal(canViewAnnouncement("Specific Barangay", null), true);
});

test("an unknown id is not found for everyone, the same answer as a hidden one", async () => {
    assert.equal(await findViewableAnnouncement("00000000-0000-4000-8000-000000000000", "responder", findById), null);
});
