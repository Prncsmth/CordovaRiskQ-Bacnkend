import assert from "node:assert/strict";
import { test } from "node:test";

import { reporterContactFor } from "@/services/reporterContact";

const reporter = { name: "Juana Dela Cruz", mobile: "+63 917 123 4567" };

test("a responder on the incident (joined, on the way, arrived) gets the reporter's contact", () => {
    for (const status of ["joined", "on_the_way", "arrived"] as const) {
        assert.deepEqual(reporterContactFor(status, reporter), {
            name: "Juana Dela Cruz",
            mobile: "+63 917 123 4567",
        });
    }
});

test("a responder not on the roster, or who declined or left, gets nothing", () => {
    assert.equal(reporterContactFor(null, reporter), null);
    assert.equal(reporterContactFor(undefined, reporter), null);
    assert.equal(reporterContactFor("declined", reporter), null);
    assert.equal(reporterContactFor("left", reporter), null);
});

test("a missing, blank or too-short number is reported as unavailable, not handed to the dialer", () => {
    assert.deepEqual(reporterContactFor("joined", { name: "Juana", mobile: null }), { name: "Juana", mobile: null });
    assert.deepEqual(reporterContactFor("joined", { name: "Juana", mobile: "   " }), { name: "Juana", mobile: null });
    assert.deepEqual(reporterContactFor("joined", { name: "Juana", mobile: "12345" }), { name: "Juana", mobile: null });
});

test("a blank name comes back as null, and a missing reporter gives nothing", () => {
    assert.deepEqual(reporterContactFor("arrived", { name: "  ", mobile: "09171234567" }), {
        name: null,
        mobile: "09171234567",
    });
    assert.equal(reporterContactFor("arrived", null), null);
});
