import assert from "node:assert/strict";
import { test } from "node:test";

import { canViewIncident } from "@/services/incidentAuthorization";

test("a citizen can view only their own report", () => {
    assert.equal(canViewIncident("citizen", "reporter-1", "reporter-1"), true);
    assert.equal(canViewIncident("citizen", "reporter-1", "someone-else"), false);
});

test("a non-citizen role can view any incident", () => {
    assert.equal(canViewIncident("responder", "reporter-1", "someone-else"), true);
    assert.equal(canViewIncident(undefined, "reporter-1", "someone-else"), true);
});
