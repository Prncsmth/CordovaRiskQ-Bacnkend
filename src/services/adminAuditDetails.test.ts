import assert from "node:assert/strict";
import { test } from "node:test";

import {
    describeEvacuationCenterChange,
    describeHotlineChange,
    describeProfileChange,
    describeSosClose,
} from "@/services/adminAuditDetails";

// --- evacuation centers ----------------------------------------------------

test("evacuation center: names the center and the status change", () => {
    assert.equal(
        describeEvacuationCenterChange(
            "Buagsong Elementary School",
            { status: "open", facilities: ["Water"] },
            { status: "full", facilities: ["Water"] },
        ),
        "Buagsong Elementary School: status Open → Full",
    );
});

test("evacuation center: lists facilities added and removed", () => {
    assert.equal(
        describeEvacuationCenterChange(
            "Cordova Gym",
            { status: "open", facilities: ["Water", "Power"] },
            { status: "open", facilities: ["Water", "Medical Aid"] },
        ),
        "Cordova Gym: added Medical Aid; removed Power",
    );
});

test("evacuation center: still records a save that changed nothing", () => {
    assert.equal(
        describeEvacuationCenterChange("Cordova Gym", { status: "open", facilities: [] }, { status: "open", facilities: [] }),
        "Cordova Gym: saved with no changes",
    );
});

// --- hotlines --------------------------------------------------------------

test("hotline: records the old and new number", () => {
    assert.equal(
        describeHotlineChange(
            { name: "BFP Cordova", number: "0917 111 2222", category: "fire" },
            { name: "BFP Cordova", number: "0918 333 4444", category: "fire" },
        ),
        "BFP Cordova: number 0917 111 2222 → 0918 333 4444",
    );
});

test("hotline: records every changed field", () => {
    assert.equal(
        describeHotlineChange(
            { name: "Cordova Police", number: "166", category: "police" },
            { name: "Cordova PNP", number: "166", category: "maritime" },
        ),
        "Cordova PNP: name Cordova Police → Cordova PNP; category police → maritime",
    );
});

// --- SOS alerts ------------------------------------------------------------

test("SOS close: records the outcome and where the alert came from", () => {
    assert.equal(describeSosClose("resolved", "Day-as, Cordova"), "Resolved the SOS alert at Day-as, Cordova");
    assert.equal(describeSosClose("dismissed", null), "Dismissed an SOS alert (location unavailable)");
});

// --- admin profile ---------------------------------------------------------

test("profile: records a name change", () => {
    assert.equal(describeProfileChange({ name: "Juan" }, { name: "Juan D." }), 'Changed their name from "Juan" to "Juan D."');
});

test("profile: a save without a name change is still recorded", () => {
    assert.equal(describeProfileChange({ name: "Juan" }, { name: "Juan" }), "Updated their profile");
});
