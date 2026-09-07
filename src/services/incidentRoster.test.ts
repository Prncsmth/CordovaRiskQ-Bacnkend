import assert from "node:assert/strict";
import { test } from "node:test";

import {
    deriveIncidentStatus,
    isActiveStatus,
    isRosterTransitionAllowed,
    pickAcceptedByResponderId,
} from "@/services/incidentRoster";

test("isActiveStatus is true only for joined/on_the_way/arrived", () => {
    assert.equal(isActiveStatus("joined"), true);
    assert.equal(isActiveStatus("on_the_way"), true);
    assert.equal(isActiveStatus("arrived"), true);
    assert.equal(isActiveStatus("left"), false);
    assert.equal(isActiveStatus("declined"), false);
});

test("isRosterTransitionAllowed: joining is allowed with no prior row or after leaving", () => {
    assert.equal(isRosterTransitionAllowed(null, "joined"), true);
    assert.equal(isRosterTransitionAllowed("left", "joined"), true);
    assert.equal(isRosterTransitionAllowed("joined", "joined"), false);
    assert.equal(isRosterTransitionAllowed("declined", "joined"), false);
});

test("isRosterTransitionAllowed: declining is only allowed with no prior row", () => {
    assert.equal(isRosterTransitionAllowed(null, "declined"), true);
    assert.equal(isRosterTransitionAllowed("joined", "declined"), false);
    assert.equal(isRosterTransitionAllowed("left", "declined"), false);
    assert.equal(isRosterTransitionAllowed("declined", "declined"), false);
});

test("isRosterTransitionAllowed: advancing on_the_way/arrived requires an active row", () => {
    assert.equal(isRosterTransitionAllowed("joined", "on_the_way"), true);
    assert.equal(isRosterTransitionAllowed("on_the_way", "arrived"), true);
    assert.equal(isRosterTransitionAllowed(null, "on_the_way"), false);
    assert.equal(isRosterTransitionAllowed("declined", "arrived"), false);
    assert.equal(isRosterTransitionAllowed("joined", "arrived"), false);
});

test("isRosterTransitionAllowed: leaving requires an active row", () => {
    assert.equal(isRosterTransitionAllowed("joined", "left"), true);
    assert.equal(isRosterTransitionAllowed("on_the_way", "left"), true);
    assert.equal(isRosterTransitionAllowed("arrived", "left"), true);
    assert.equal(isRosterTransitionAllowed(null, "left"), false);
    assert.equal(isRosterTransitionAllowed("declined", "left"), false);
});

test("isRosterTransitionAllowed: comprehensive cell coverage for on_the_way state", () => {
    assert.equal(isRosterTransitionAllowed("on_the_way", "on_the_way"), true); // idempotent no-op
    assert.equal(isRosterTransitionAllowed("on_the_way", "joined"), false); // can't regress to joined
    assert.equal(isRosterTransitionAllowed("on_the_way", "declined"), false); // can't decline while active
    assert.equal(isRosterTransitionAllowed("left", "on_the_way"), false); // can't resume on_the_way after leaving
    assert.equal(isRosterTransitionAllowed("declined", "on_the_way"), false); // can't resume on_the_way after declining
});

test("isRosterTransitionAllowed: comprehensive cell coverage for arrived state", () => {
    assert.equal(isRosterTransitionAllowed("arrived", "arrived"), true); // idempotent no-op
    assert.equal(isRosterTransitionAllowed("arrived", "joined"), false); // can't regress to joined
    assert.equal(isRosterTransitionAllowed("arrived", "declined"), false); // can't decline while active
    assert.equal(isRosterTransitionAllowed(null, "arrived"), false); // can't skip straight to arrived
    assert.equal(isRosterTransitionAllowed("left", "arrived"), false); // can't skip on_the_way when resuming
});

test("isRosterTransitionAllowed: comprehensive cell coverage for left state", () => {
    assert.equal(isRosterTransitionAllowed("left", "left"), false); // can't transition from left->left
});

test("deriveIncidentStatus picks the highest-progress active status", () => {
    assert.equal(deriveIncidentStatus([]), "pending");
    assert.equal(deriveIncidentStatus(["joined"]), "lobby");
    assert.equal(deriveIncidentStatus(["joined", "on_the_way"]), "on_the_way");
    assert.equal(deriveIncidentStatus(["on_the_way", "arrived"]), "arrived");
});

test("pickAcceptedByResponderId picks the earliest-created active row", () => {
    const result = pickAcceptedByResponderId([
        { id: "r1", responderId: "alice", status: "left", createdAt: new Date("2026-01-01T00:00:00Z") },
        { id: "r2", responderId: "bob", status: "joined", createdAt: new Date("2026-01-02T00:00:00Z") },
        { id: "r3", responderId: "carol", status: "on_the_way", createdAt: new Date("2026-01-03T00:00:00Z") },
    ]);
    assert.equal(result, "bob");
});

test("pickAcceptedByResponderId returns null when nobody is active", () => {
    const result = pickAcceptedByResponderId([
        { id: "r1", responderId: "alice", status: "declined", createdAt: new Date("2026-01-01T00:00:00Z") },
        { id: "r2", responderId: "bob", status: "left", createdAt: new Date("2026-01-02T00:00:00Z") },
    ]);
    assert.equal(result, null);
});

test("pickAcceptedByResponderId breaks an exact createdAt tie by id", () => {
    const tiedTime = new Date("2026-01-01T00:00:00.000Z");
    const result = pickAcceptedByResponderId([
        { id: "r2", responderId: "bob", status: "joined", createdAt: tiedTime },
        { id: "r1", responderId: "alice", status: "joined", createdAt: tiedTime },
    ]);
    assert.equal(result, "alice");
});
