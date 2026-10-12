import assert from "node:assert/strict";
import { test } from "node:test";

import { BARANGAY_CENTERS } from "@/constants/barangayCenters";
import { CORDOVA_BARANGAY_NAMES } from "@/constants/barangays";
import {
    ESCALATE_AFTER_MS,
    canRespondToIncident,
    incidentBarangayName,
    isEscalated,
    isEscalatedFor,
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

const NOW = new Date("2026-10-12T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
// A just-created pending incident (not escalated yet), and one left
// pending past the escalation window.
const fresh = (loc: typeof DAY_AS | typeof NOWHERE): ScopeIncident => ({ ...loc, status: "pending", createdAt: ago(10_000) });
const stale = (loc: typeof DAY_AS | typeof NOWHERE): ScopeIncident => ({
    ...loc,
    status: "pending",
    createdAt: ago(ESCALATE_AFTER_MS),
});

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

test("barangay centers cover exactly the official barangay names", () => {
    assert.deepEqual(BARANGAY_CENTERS.map((b) => b.name).sort(), [...CORDOVA_BARANGAY_NAMES].sort());
});

test("incidentBarangayName picks the nearest barangay center, null without coordinates", () => {
    assert.equal(incidentBarangayName(DAY_AS), "Day-as");
    assert.equal(incidentBarangayName(POBLACION), "Poblacion");
    assert.equal(incidentBarangayName(NOWHERE), null);
});

test("escalation is 2 minutes, matching the admin's Unattended badge", () => {
    assert.equal(ESCALATE_AFTER_MS, 2 * 60 * 1000);
});

test("a fresh incident: a BDRRMO responder can respond only inside their barangay", () => {
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), fresh(DAY_AS), NOW), true);
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), fresh(POBLACION), NOW), false);
    assert.equal(canRespondToIncident(bdrrmo("day-as"), fresh(DAY_AS), NOW), true);
});

test("MDRRMO can respond anywhere, including incidents without coordinates", () => {
    assert.equal(canRespondToIncident(mdrrmo(), fresh(POBLACION), NOW), true);
    assert.equal(canRespondToIncident(mdrrmo(), fresh(NOWHERE), NOW), true);
});

test("unassigned or unit-less responders get nothing until an incident escalates", () => {
    assert.equal(canRespondToIncident(bdrrmo(null), fresh(DAY_AS), NOW), false);
    assert.equal(canRespondToIncident(unclassified, fresh(DAY_AS), NOW), false);
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), fresh(NOWHERE), NOW), false);
});

test("still pending after 2 minutes: every responder may respond", () => {
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), stale(POBLACION), NOW), true);
    assert.equal(canRespondToIncident(unclassified, stale(POBLACION), NOW), true);
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), stale(NOWHERE), NOW), true);
});

test("one second short of 2 minutes is not escalated yet", () => {
    const almost: ScopeIncident = { ...POBLACION, status: "pending", createdAt: ago(ESCALATE_AFTER_MS - 1000) };
    assert.equal(isEscalated(almost, NOW), false);
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), almost, NOW), false);
});

test("an incident someone already took is never escalated, however old", () => {
    const taken: ScopeIncident = { ...POBLACION, status: "lobby", createdAt: ago(60 * 60 * 1000) };
    assert.equal(isEscalated(taken, NOW), false);
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), taken, NOW), false);
});

test("isEscalatedFor marks only the outsiders it was opened up to", () => {
    assert.equal(isEscalatedFor(bdrrmo("Day-as"), stale(POBLACION), NOW), true);
    assert.equal(isEscalatedFor(bdrrmo("Poblacion"), stale(POBLACION), NOW), false);
    assert.equal(isEscalatedFor(bdrrmo("Day-as"), fresh(POBLACION), NOW), false);
});

test("non-responders never get response actions", () => {
    assert.equal(canRespondToIncident({ ...mdrrmo(), role: "admin" }, stale(DAY_AS), NOW), false);
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

test("the first alert goes only to on-duty responders in scope", () => {
    const responders = [bdrrmo("Day-as"), bdrrmo("Poblacion"), mdrrmo(), bdrrmo("Day-as", false), unclassified];
    assert.deepEqual(selectNewIncidentRecipients(responders, DAY_AS).sort(), ["b-Day-as", "m"].sort());
});

test("the escalation alert goes to the on-duty outsiders not already on it", () => {
    const responders = [bdrrmo("Day-as"), bdrrmo("Poblacion"), mdrrmo(), bdrrmo("Gabi", false), unclassified];
    // Poblacion BDRRMO + MDRRMO already got the first alert (in scope); the
    // unclassified one declined.
    const ids = selectEscalationRecipients(responders, POBLACION, new Set(["u"]));
    assert.deepEqual(ids, ["b-Day-as"]);
});
