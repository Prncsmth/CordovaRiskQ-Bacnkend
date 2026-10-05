import assert from "node:assert/strict";
import { test } from "node:test";

import { primaryContact } from "@/services/trackingContact";

test("returns the primary responder's mobile and unit", () => {
    assert.deepEqual(primaryContact({ mobile: "+63 912 345 6789", unit: "MDRRMO" }), {
        mobile: "+63 912 345 6789",
        unit: "MDRRMO",
    });
});

test("a responder with no number saved has no contact, without failing", () => {
    assert.deepEqual(primaryContact({ mobile: null, unit: null }), { mobile: null, unit: null });
    assert.deepEqual(primaryContact(undefined), { mobile: null, unit: null });
});

test("blank or too-short numbers count as missing, never handed to the dialer", () => {
    assert.equal(primaryContact({ mobile: "   ", unit: null }).mobile, null);
    assert.equal(primaryContact({ mobile: "12345", unit: null }).mobile, null);
});

test("blank unit counts as missing", () => {
    assert.equal(primaryContact({ mobile: "09171234567", unit: "  " }).unit, null);
});
