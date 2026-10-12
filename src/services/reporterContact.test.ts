import assert from "node:assert/strict";
import { test } from "node:test";

import { reporterContactFor } from "@/services/reporterContact";

const reporter = { name: "Juana Dela Cruz", mobile: "+63 917 123 4567" };

test("a responder on the incident (joined, on the way, arrived) gets the reporter's contact", () => {
    for (const status of ["joined", "on_the_way", "arrived"] as const) {
        assert.deepEqual(reporterContactFor(status, reporter), {
            name: "Juana Dela Cruz",
            mobile: "+63 917 123 4567",
            avatarUrl: null,
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
    const noNumber = { name: "Juana", mobile: null, avatarUrl: null };
    assert.deepEqual(reporterContactFor("joined", { name: "Juana", mobile: null }), noNumber);
    assert.deepEqual(reporterContactFor("joined", { name: "Juana", mobile: "   " }), noNumber);
    assert.deepEqual(reporterContactFor("joined", { name: "Juana", mobile: "12345" }), noNumber);
});

test("a blank name comes back as null, and a missing reporter gives nothing", () => {
    assert.deepEqual(reporterContactFor("arrived", { name: "  ", mobile: "09171234567" }), {
        name: null,
        mobile: "09171234567",
        avatarUrl: null,
    });
    assert.equal(reporterContactFor("arrived", null), null);
});

test("the reporter's optional profile photo comes along, only with the rest of the contact", () => {
    const withPhoto = { ...reporter, avatarUrl: "https://res.cloudinary.com/x/image/upload/a.jpg" };
    assert.equal(reporterContactFor("joined", withPhoto)?.avatarUrl, withPhoto.avatarUrl);
    assert.equal(reporterContactFor("declined", withPhoto), null);
});
