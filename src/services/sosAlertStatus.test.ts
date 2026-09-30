import assert from "node:assert/strict";
import { test } from "node:test";

import {
    adminCloseOutcomeToIncidentStatus,
    canAdminCloseSosIncident,
    countAlertsByStatus,
    deriveAlertStatus,
    filterAlertIdsByStatus,
    incidentStatusToAlertOutcome,
} from "@/services/sosAlertStatus";

const NOW = new Date("2026-09-30T12:00:00Z");
const EXPIRY_MS = 60 * 60 * 1000;
const FRESH = new Date("2026-09-30T11:30:00Z"); // 30 min old
const STALE = new Date("2026-09-29T12:00:00Z"); // 1 day old

function alert(id: string, createdAt = FRESH, status = "active") {
    return { id, status, createdAt };
}

test("deriveAlertStatus maps each incident lifecycle stage to its bucket", () => {
    const a = alert("a");
    assert.equal(deriveAlertStatus(a, "pending", NOW, EXPIRY_MS), "New");
    assert.equal(deriveAlertStatus(a, "lobby", NOW, EXPIRY_MS), "Acknowledged");
    assert.equal(deriveAlertStatus(a, "on_the_way", NOW, EXPIRY_MS), "Acknowledged");
    assert.equal(deriveAlertStatus(a, "arrived", NOW, EXPIRY_MS), "Acknowledged");
    assert.equal(deriveAlertStatus(a, "completed", NOW, EXPIRY_MS), "Resolved");
    assert.equal(deriveAlertStatus(a, "cancelled", NOW, EXPIRY_MS), "Cancelled");
    assert.equal(deriveAlertStatus(a, "expired", NOW, EXPIRY_MS), "Unattended");
});

test("deriveAlertStatus treats an alert with no incident as New only within the expiry window", () => {
    assert.equal(deriveAlertStatus(alert("a", FRESH), undefined, NOW, EXPIRY_MS), "New");
    assert.equal(deriveAlertStatus(alert("a", STALE), undefined, NOW, EXPIRY_MS), "Unattended");
});

test("deriveAlertStatus uses the outcome stamped on an alert whose incident is gone", () => {
    assert.equal(deriveAlertStatus(alert("a", STALE, "resolved"), undefined, NOW, EXPIRY_MS), "Resolved");
    assert.equal(deriveAlertStatus(alert("a", STALE, "cancelled"), undefined, NOW, EXPIRY_MS), "Cancelled");
    assert.equal(deriveAlertStatus(alert("a", STALE, "expired"), undefined, NOW, EXPIRY_MS), "Unattended");
});

test("incidentStatusToAlertOutcome stamps only terminal statuses", () => {
    assert.equal(incidentStatusToAlertOutcome("completed"), "resolved");
    assert.equal(incidentStatusToAlertOutcome("cancelled"), "cancelled");
    assert.equal(incidentStatusToAlertOutcome("expired"), "expired");
    assert.equal(incidentStatusToAlertOutcome("pending"), undefined);
    assert.equal(incidentStatusToAlertOutcome("arrived"), undefined);
});

test("canAdminCloseSosIncident allows only alerts no responder has joined", () => {
    assert.equal(canAdminCloseSosIncident("pending"), true);
    assert.equal(canAdminCloseSosIncident("expired"), true);
    assert.equal(canAdminCloseSosIncident("lobby"), false);
    assert.equal(canAdminCloseSosIncident("on_the_way"), false);
    assert.equal(canAdminCloseSosIncident("arrived"), false);
    assert.equal(canAdminCloseSosIncident("completed"), false);
    assert.equal(canAdminCloseSosIncident("cancelled"), false);
});

test("adminCloseOutcomeToIncidentStatus maps resolve/dismiss to terminal statuses", () => {
    assert.equal(adminCloseOutcomeToIncidentStatus("resolved"), "completed");
    assert.equal(adminCloseOutcomeToIncidentStatus("dismissed"), "cancelled");
});

test("filterAlertIdsByStatus returns only ids whose bucket matches", () => {
    const statusByAlertId = new Map([
        ["a1", "pending"],
        ["a2", "arrived"],
        ["a3", "completed"],
        // a4/a5 have no linked incident -- a4 fresh, a5 stale
    ]);
    const alerts = [alert("a1"), alert("a2"), alert("a3"), alert("a4", FRESH), alert("a5", STALE)];

    assert.deepEqual(filterAlertIdsByStatus(alerts, statusByAlertId, "New", NOW, EXPIRY_MS), ["a1", "a4"]);
    assert.deepEqual(filterAlertIdsByStatus(alerts, statusByAlertId, "Acknowledged", NOW, EXPIRY_MS), ["a2"]);
    assert.deepEqual(filterAlertIdsByStatus(alerts, statusByAlertId, "Resolved", NOW, EXPIRY_MS), ["a3"]);
    assert.deepEqual(filterAlertIdsByStatus(alerts, statusByAlertId, "Unattended", NOW, EXPIRY_MS), ["a5"]);
});

test("countAlertsByStatus buckets every alert and reports the total", () => {
    const statusByAlertId = new Map([
        ["a1", "pending"],
        ["a2", "lobby"],
        ["a3", "completed"],
        ["a4", "cancelled"],
        ["a6", "expired"],
    ]);
    const alerts = [
        alert("a1"),
        alert("a2"),
        alert("a3"),
        alert("a4"),
        alert("a5", FRESH),
        alert("a6"),
        alert("a7", STALE),
        alert("a8", STALE, "resolved"),
    ];

    assert.deepEqual(countAlertsByStatus(alerts, statusByAlertId, NOW, EXPIRY_MS), {
        New: 2,
        Acknowledged: 1,
        Resolved: 2,
        Cancelled: 1,
        Unattended: 2,
        total: 8,
    });
});
