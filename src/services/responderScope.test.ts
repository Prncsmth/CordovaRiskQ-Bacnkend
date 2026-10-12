import assert from "node:assert/strict";
import { test } from "node:test";

import { BARANGAY_CENTERS } from "@/constants/barangayCenters";
import { CORDOVA_BARANGAY_NAMES } from "@/constants/barangays";
import {
    ESCALATE_AFTER_MS,
    canRespondToIncident,
    coverageFrom,
    incidentBarangayName,
    isEscalated,
    isOpenAsBackup,
    isResponseActionAllowed,
    selectEscalationRecipients,
    selectNewIncidentRecipients,
    type ScopeIncident,
    type ScopeResponder,
} from "@/services/responderScope";

// Barangay centers (constants/barangayCenters.ts).
const DAY_AS = { latitude: 10.2554, longitude: 123.9355 };
const POBLACION = { latitude: 10.2525, longitude: 123.9502 };
const NOWHERE = { latitude: null, longitude: null };
type Loc = typeof DAY_AS | typeof NOWHERE;

const NOW = new Date("2026-10-12T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const fresh = (loc: Loc): ScopeIncident => ({ ...loc, status: "pending", createdAt: ago(10_000) });
const stale = (loc: Loc): ScopeIncident => ({ ...loc, status: "pending", createdAt: ago(ESCALATE_AFTER_MS) });

const bdrrmo = (assignedBarangay: string | null, isOnDuty = true): ScopeResponder => ({
    id: `b-${assignedBarangay}`,
    role: "responder",
    unit: "BDRRMO",
    assignedBarangay,
    isOnDuty,
});
const mdrrmo = (isOnDuty = true): ScopeResponder => ({
    id: "m",
    role: "responder",
    unit: "MDRRMO",
    assignedBarangay: null,
    isOnDuty,
});
const unclassified: ScopeResponder = { id: "u", role: "responder", unit: null, assignedBarangay: "Day-as", isOnDuty: true };

// Day-as has an on-duty BDRRMO; Poblacion doesn't.
const dayAsCovered = coverageFrom([bdrrmo("Day-as"), bdrrmo("Poblacion", false), mdrrmo()]);

test("barangay centers cover exactly the official barangay names", () => {
    assert.deepEqual(BARANGAY_CENTERS.map((b) => b.name).sort(), [...CORDOVA_BARANGAY_NAMES].sort());
});

test("incidentBarangayName picks the nearest barangay center, null without coordinates", () => {
    assert.equal(incidentBarangayName(DAY_AS), "Day-as");
    assert.equal(incidentBarangayName(POBLACION), "Poblacion");
    assert.equal(incidentBarangayName(NOWHERE), null);
});

test("coverage counts only on-duty BDRRMO with a barangay", () => {
    assert.deepEqual([...dayAsCovered], ["day-as"]);
});

test("escalation is 2 minutes, matching the admin's Unattended badge", () => {
    assert.equal(ESCALATE_AFTER_MS, 2 * 60 * 1000);
});

test("tier 1: the barangay's own BDRRMO can respond right away; others can't", () => {
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), fresh(DAY_AS), dayAsCovered, NOW), true);
    assert.equal(canRespondToIncident(bdrrmo("day-as"), fresh(DAY_AS), dayAsCovered, NOW), true);
    assert.equal(canRespondToIncident(bdrrmo("Poblacion"), fresh(DAY_AS), dayAsCovered, NOW), false);
});

test("MDRRMO waits while the barangay's BDRRMO is on duty", () => {
    assert.equal(canRespondToIncident(mdrrmo(), fresh(DAY_AS), dayAsCovered, NOW), false);
});

test("MDRRMO steps in right away when the barangay has no on-duty BDRRMO", () => {
    assert.equal(canRespondToIncident(mdrrmo(), fresh(POBLACION), dayAsCovered, NOW), true);
    // Can't be placed in a barangay at all.
    assert.equal(canRespondToIncident(mdrrmo(), fresh(NOWHERE), dayAsCovered, NOW), true);
});

test("after 2 minutes still pending, everyone may respond, MDRRMO included", () => {
    assert.equal(canRespondToIncident(mdrrmo(), stale(DAY_AS), dayAsCovered, NOW), true);
    assert.equal(canRespondToIncident(bdrrmo("Poblacion"), stale(DAY_AS), dayAsCovered, NOW), true);
    assert.equal(canRespondToIncident(unclassified, stale(DAY_AS), dayAsCovered, NOW), true);
});

test("one second short of 2 minutes is not escalated yet", () => {
    const almost: ScopeIncident = { ...DAY_AS, status: "pending", createdAt: ago(ESCALATE_AFTER_MS - 1000) };
    assert.equal(isEscalated(almost, NOW), false);
    assert.equal(canRespondToIncident(mdrrmo(), almost, dayAsCovered, NOW), false);
});

test("an incident someone already took never escalates, however old", () => {
    const taken: ScopeIncident = { ...DAY_AS, status: "lobby", createdAt: ago(60 * 60 * 1000) };
    assert.equal(isEscalated(taken, NOW), false);
    assert.equal(canRespondToIncident(bdrrmo("Poblacion"), taken, dayAsCovered, NOW), false);
});

test("unassigned or unit-less responders only get escalated incidents", () => {
    assert.equal(canRespondToIncident(bdrrmo(null), fresh(POBLACION), dayAsCovered, NOW), false);
    assert.equal(canRespondToIncident(unclassified, fresh(POBLACION), dayAsCovered, NOW), false);
});

test("isOpenAsBackup: true for MDRRMO or an outsider it reached, false for its own barangay", () => {
    assert.equal(isOpenAsBackup(mdrrmo(), fresh(POBLACION), dayAsCovered, NOW), true);
    assert.equal(isOpenAsBackup(bdrrmo("Poblacion"), stale(DAY_AS), dayAsCovered, NOW), true);
    assert.equal(isOpenAsBackup(bdrrmo("Day-as"), fresh(DAY_AS), dayAsCovered, NOW), false);
    assert.equal(isOpenAsBackup(mdrrmo(), fresh(DAY_AS), dayAsCovered, NOW), false);
});

test("non-responders never get response actions", () => {
    assert.equal(canRespondToIncident({ ...mdrrmo(), role: "admin" }, stale(DAY_AS), dayAsCovered, NOW), false);
});

test("isResponseActionAllowed: joining or declining needs scope; someone on the roster may continue", () => {
    assert.equal(isResponseActionAllowed(null, false), false);
    assert.equal(isResponseActionAllowed("left", false), false);
    assert.equal(isResponseActionAllowed(null, true), true);
    assert.equal(isResponseActionAllowed("joined", false), true);
    assert.equal(isResponseActionAllowed("on_the_way", false), true);
    assert.equal(isResponseActionAllowed("arrived", false), true);
    assert.equal(isResponseActionAllowed("declined", false), false);
});

test("first alert: the barangay's on-duty BDRRMO, not MDRRMO", () => {
    const responders = [bdrrmo("Day-as"), bdrrmo("Poblacion"), mdrrmo(), bdrrmo("Day-as", false), unclassified];
    assert.deepEqual(selectNewIncidentRecipients(responders, DAY_AS), ["b-Day-as"]);
});

test("first alert: MDRRMO when the barangay has no on-duty BDRRMO", () => {
    const responders = [bdrrmo("Day-as"), bdrrmo("Poblacion", false), mdrrmo(), mdrrmo(false)];
    assert.deepEqual(selectNewIncidentRecipients(responders, POBLACION), ["m"]);
    assert.deepEqual(selectNewIncidentRecipients(responders, NOWHERE), ["m"]);
});

test("escalation alert: every on-duty responder not already alerted or on the roster", () => {
    const responders = [bdrrmo("Day-as"), bdrrmo("Poblacion"), mdrrmo(), bdrrmo("Gabi", false), unclassified];
    // Day-as BDRRMO got the first alert; the unclassified one declined.
    const ids = selectEscalationRecipients(responders, new Set(["b-Day-as", "u"])).sort();
    assert.deepEqual(ids, ["b-Poblacion", "m"].sort());
});
