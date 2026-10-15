import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { sosExpiryMs } from "@/lib/sosExpiryPolling";

const original = process.env.SOS_EXPIRY_MINUTES;

afterEach(() => {
    if (original === undefined) delete process.env.SOS_EXPIRY_MINUTES;
    else process.env.SOS_EXPIRY_MINUTES = original;
});

test("defaults to 60 minutes", () => {
    delete process.env.SOS_EXPIRY_MINUTES;
    assert.equal(sosExpiryMs(), 60 * 60 * 1000);
});

test("SOS_EXPIRY_MINUTES is read as minutes", () => {
    process.env.SOS_EXPIRY_MINUTES = "15";
    assert.equal(sosExpiryMs(), 15 * 60 * 1000);
});

test("falls back to the default for a non-positive or non-numeric value", () => {
    for (const value of ["0", "-5", "abc"]) {
        process.env.SOS_EXPIRY_MINUTES = value;
        assert.equal(sosExpiryMs(), 60 * 60 * 1000, value);
    }
});
