import assert from "node:assert/strict";
import { test } from "node:test";

import { BARANGAY_CENTERS } from "@/constants/barangayCenters";
import { CORDOVA_BARANGAY_NAMES } from "@/constants/barangays";
import {
    canRespondToIncident,
    incidentBarangayName,
    isResponseActionAllowed,
    selectNewIncidentRecipients,
    type ResponderCoverage,
    type ScopeResponder,
} from "@/services/responderScope";

// Barangay centers (constants/barangayCenters.ts).
const DAY_AS = { latitude: 10.2554, longitude: 123.9355 };
const POBLACION = { latitude: 10.2525, longitude: 123.9502 };

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
const unclassified: ScopeResponder = {
    id: "u",
    role: "responder",
    unit: null,
    assignedBarangay: "Day-as",
    isOnDuty: true,
};

// Someone in scope is on duty everywhere, so nothing is escalated.
const covered: ResponderCoverage = { mdrrmoOnDuty: true, bdrrmoOnDutyBarangays: new Set() };

test("barangay centers cover exactly the official barangay names", () => {
    assert.deepEqual(
        BARANGAY_CENTERS.map((b) => b.name).sort(),
        [...CORDOVA_BARANGAY_NAMES].sort(),
    );
});

test("incidentBarangayName picks the nearest barangay center, null without coordinates", () => {
    assert.equal(incidentBarangayName(DAY_AS), "Day-as");
    assert.equal(incidentBarangayName(POBLACION), "Poblacion");
    assert.equal(incidentBarangayName({ latitude: null, longitude: null }), null);
});

test("a BDRRMO responder can respond only inside their assigned barangay", () => {
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), DAY_AS, covered), true);
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), POBLACION, covered), false);
});

test("the assigned barangay is matched case-insensitively", () => {
    assert.equal(canRespondToIncident(bdrrmo("day-as"), DAY_AS, covered), true);
});

test("MDRRMO can respond anywhere in Cordova, including incidents without coordinates", () => {
    assert.equal(canRespondToIncident(mdrrmo(), DAY_AS, covered), true);
    assert.equal(canRespondToIncident(mdrrmo(), POBLACION, covered), true);
    assert.equal(canRespondToIncident(mdrrmo(), { latitude: null, longitude: null }, covered), true);
});

test("an unassigned BDRRMO or a responder with no unit gets no actionable incidents", () => {
    assert.equal(canRespondToIncident(bdrrmo(null), DAY_AS, covered), false);
    assert.equal(canRespondToIncident(unclassified, DAY_AS, covered), false);
});

test("a BDRRMO can't respond to an incident without coordinates (can't be placed)", () => {
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), { latitude: null, longitude: null }, covered), false);
});

test("escalation: with nobody in scope on duty, any on-duty responder can respond", () => {
    const nobodyForDayAs: ResponderCoverage = {
        mdrrmoOnDuty: false,
        bdrrmoOnDutyBarangays: new Set(["Poblacion"]),
    };
    assert.equal(canRespondToIncident(bdrrmo("Poblacion"), DAY_AS, nobodyForDayAs), true);
    assert.equal(canRespondToIncident(unclassified, DAY_AS, nobodyForDayAs), true);
    // Day-as has its own on-duty BDRRMO here, so no escalation for Day-as.
    const dayAsCovered: ResponderCoverage = {
        mdrrmoOnDuty: false,
        bdrrmoOnDutyBarangays: new Set(["Day-as"]),
    };
    assert.equal(canRespondToIncident(bdrrmo("Poblacion"), DAY_AS, dayAsCovered), false);
});

test("escalation also covers incidents without coordinates when no MDRRMO is on duty", () => {
    const noMdrrmo: ResponderCoverage = { mdrrmoOnDuty: false, bdrrmoOnDutyBarangays: new Set(["Day-as"]) };
    assert.equal(canRespondToIncident(bdrrmo("Day-as"), { latitude: null, longitude: null }, noMdrrmo), true);
});

test("non-responders never get response actions", () => {
    const admin: ScopeResponder = { ...mdrrmo(), role: "admin" };
    assert.equal(canRespondToIncident(admin, DAY_AS, covered), false);
});

test("isResponseActionAllowed: joining or declining needs scope; someone already on the roster may continue", () => {
    // Not on the roster yet (null) or rejoining after leaving: needs scope.
    assert.equal(isResponseActionAllowed(null, false), false);
    assert.equal(isResponseActionAllowed("left", false), false);
    assert.equal(isResponseActionAllowed(null, true), true);
    // Already active: may move on / leave even if their assignment changed.
    assert.equal(isResponseActionAllowed("joined", false), true);
    assert.equal(isResponseActionAllowed("on_the_way", false), true);
    assert.equal(isResponseActionAllowed("arrived", false), true);
    // A past decline isn't an active row.
    assert.equal(isResponseActionAllowed("declined", false), false);
});

test("selectNewIncidentRecipients: only on-duty responders in scope", () => {
    const responders = [bdrrmo("Day-as"), bdrrmo("Poblacion"), mdrrmo(), bdrrmo("Day-as", false), unclassified];
    const coverage: ResponderCoverage = {
        mdrrmoOnDuty: true,
        bdrrmoOnDutyBarangays: new Set(["Day-as", "Poblacion"]),
    };
    const ids = selectNewIncidentRecipients(responders, DAY_AS, coverage).sort();
    // Day-as BDRRMO (on duty) + MDRRMO; not Poblacion, not the off-duty one, not unclassified.
    assert.deepEqual(ids, ["b-Day-as", "m"].sort());
});

test("selectNewIncidentRecipients escalates to every on-duty responder when nobody is in scope", () => {
    const responders = [bdrrmo("Poblacion"), unclassified, bdrrmo("Day-as", false)];
    const coverage: ResponderCoverage = { mdrrmoOnDuty: false, bdrrmoOnDutyBarangays: new Set(["Poblacion"]) };
    const ids = selectNewIncidentRecipients(responders, DAY_AS, coverage).sort();
    assert.deepEqual(ids, ["b-Poblacion", "u"].sort());
});
