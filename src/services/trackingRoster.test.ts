import assert from "node:assert/strict";
import { test } from "node:test";

import { pickAcceptedByResponderId, type ResponderRosterStatus } from "@/services/incidentRoster";
import {
    activeTrackingRoster,
    LOCATION_SHARING_STATUSES,
    locationForIncident,
} from "@/services/trackingRoster";

const row = (id: string, responderId: string, status: ResponderRosterStatus, minute: number) => ({
    id,
    responderId,
    status,
    createdAt: new Date(Date.UTC(2026, 9, 5, 8, minute)),
});

test("lists every responder currently helping, not just the first", () => {
    const roster = activeTrackingRoster([
        row("r1", "juan", "on_the_way", 1),
        row("r2", "pedro", "joined", 2),
        row("r3", "maria", "arrived", 3),
    ]);
    assert.deepEqual(roster.map((r) => r.responderId), ["juan", "pedro", "maria"]);
});

test("leaves out responders who left or declined", () => {
    const roster = activeTrackingRoster([
        row("r1", "juan", "on_the_way", 1),
        row("r2", "pedro", "left", 2),
        row("r3", "ana", "declined", 3),
    ]);
    assert.deepEqual(roster.map((r) => r.responderId), ["juan"]);
});

test("is ordered by when each accepted, regardless of input order", () => {
    const roster = activeTrackingRoster([
        row("r3", "maria", "arrived", 9),
        row("r1", "juan", "joined", 1),
        row("r2", "pedro", "on_the_way", 5),
    ]);
    assert.deepEqual(roster.map((r) => r.responderId), ["juan", "pedro", "maria"]);
});

test("its first entry is always the responder the single-responder fields report", () => {
    const rows = [
        row("r-b", "pedro", "on_the_way", 4),
        row("r-a", "juan", "joined", 4), // same minute: id breaks the tie
        row("r-c", "maria", "arrived", 7),
    ];
    assert.equal(activeTrackingRoster(rows)[0].responderId, pickAcceptedByResponderId(rows));
});

test("is empty when nobody is helping yet", () => {
    assert.deepEqual(activeTrackingRoster([row("r1", "juan", "declined", 1)]), []);
});

// --- which locations count -------------------------------------------------

const joinedAt = new Date(Date.UTC(2026, 9, 5, 8, 10));
const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 8, minute));

test("responders share their location from joining until they arrive, matching the app", () => {
    assert.deepEqual(LOCATION_SHARING_STATUSES, ["joined", "on_the_way"]);
});

test("a location updated after joining this incident is shown", () => {
    const loc = locationForIncident({ latitude: 10.3, longitude: 124.0, locationUpdatedAt: at(12) }, joinedAt);
    assert.deepEqual(loc, { latitude: 10.3, longitude: 124.0, locationUpdatedAt: at(12) });
});

test("a location left over from an earlier incident is hidden, not drawn in the wrong place", () => {
    const loc = locationForIncident({ latitude: 10.9, longitude: 123.5, locationUpdatedAt: at(5) }, joinedAt);
    assert.deepEqual(loc, { latitude: null, longitude: null, locationUpdatedAt: null });
});

test("no location yet is reported as none", () => {
    const loc = locationForIncident({ latitude: null, longitude: null, locationUpdatedAt: null }, joinedAt);
    assert.deepEqual(loc, { latitude: null, longitude: null, locationUpdatedAt: null });
});
