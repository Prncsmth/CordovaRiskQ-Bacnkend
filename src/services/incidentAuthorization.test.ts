import assert from "node:assert/strict";
import { test } from "node:test";

import { canCancelIncident, canViewIncident } from "@/services/incidentAuthorization";

test("a citizen can view only their own report", () => {
    assert.equal(canViewIncident("citizen", "reporter-1", "reporter-1"), true);
    assert.equal(canViewIncident("citizen", "reporter-1", "someone-else"), false);
});

test("a non-citizen role can view any incident", () => {
    assert.equal(canViewIncident("responder", "reporter-1", "someone-else"), true);
    assert.equal(canViewIncident(undefined, "reporter-1", "someone-else"), true);
});

test("only the reporter can cancel their own pending report", () => {
    assert.equal(canCancelIncident("reporter-1", "reporter-1", "pending"), true);
    assert.equal(canCancelIncident("reporter-1", "someone-else", "pending"), false);
});

test("a report can only be cancelled while still pending", () => {
    assert.equal(canCancelIncident("reporter-1", "reporter-1", "lobby"), false);
    assert.equal(canCancelIncident("reporter-1", "reporter-1", "on_the_way"), false);
    assert.equal(canCancelIncident("reporter-1", "reporter-1", "arrived"), false);
    assert.equal(canCancelIncident("reporter-1", "reporter-1", "completed"), false);
    assert.equal(canCancelIncident("reporter-1", "reporter-1", "cancelled"), false);
});
