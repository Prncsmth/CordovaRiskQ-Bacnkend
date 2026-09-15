import assert from "node:assert/strict";
import { test } from "node:test";

import {
    countAlertsByStatus,
    filterAlertIdsByStatus,
    incidentStatusToAlertStatus,
} from "@/services/sosAlertStatus";

test("incidentStatusToAlertStatus maps each incident lifecycle stage to its bucket", () => {
    assert.equal(incidentStatusToAlertStatus("pending"), "New");
    assert.equal(incidentStatusToAlertStatus("lobby"), "Acknowledged");
    assert.equal(incidentStatusToAlertStatus("on_the_way"), "Acknowledged");
    assert.equal(incidentStatusToAlertStatus("arrived"), "Acknowledged");
    assert.equal(incidentStatusToAlertStatus("completed"), "Resolved");
    assert.equal(incidentStatusToAlertStatus("cancelled"), "Resolved");
});

test("incidentStatusToAlertStatus treats a missing incident as New", () => {
    assert.equal(incidentStatusToAlertStatus(undefined), "New");
});

test("filterAlertIdsByStatus returns only ids whose bucket matches", () => {
    const statusByAlertId = new Map([
        ["a1", "pending"],
        ["a2", "arrived"],
        ["a3", "completed"],
        // a4 has no entry -- no linked incident yet
    ]);

    assert.deepEqual(
        filterAlertIdsByStatus(["a1", "a2", "a3", "a4"], statusByAlertId, "New"),
        ["a1", "a4"],
    );
    assert.deepEqual(
        filterAlertIdsByStatus(["a1", "a2", "a3", "a4"], statusByAlertId, "Acknowledged"),
        ["a2"],
    );
    assert.deepEqual(
        filterAlertIdsByStatus(["a1", "a2", "a3", "a4"], statusByAlertId, "Resolved"),
        ["a3"],
    );
});

test("countAlertsByStatus buckets every id and reports the total", () => {
    const statusByAlertId = new Map([
        ["a1", "pending"],
        ["a2", "lobby"],
        ["a3", "completed"],
        ["a4", "cancelled"],
    ]);

    assert.deepEqual(
        countAlertsByStatus(["a1", "a2", "a3", "a4", "a5"], statusByAlertId),
        { New: 2, Acknowledged: 1, Resolved: 2, total: 5 },
    );
});
