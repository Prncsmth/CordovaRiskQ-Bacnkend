import assert from "node:assert/strict";
import { test } from "node:test";

import { bumpUrgency, resolveUrgency } from "@/services/incidentUrgency";

test("bumpUrgency raises one level and caps at high", () => {
    assert.equal(bumpUrgency("low"), "medium");
    assert.equal(bumpUrgency("medium"), "high");
    assert.equal(bumpUrgency("high"), "high");
});

test("resolveUrgency uses the category default when not marked urgent", () => {
    assert.equal(resolveUrgency("fire"), "high");
    assert.equal(resolveUrgency("medical", false), "high");
    assert.equal(resolveUrgency("flood"), "medium");
    assert.equal(resolveUrgency("road-accident", false), "medium");
    assert.equal(resolveUrgency("other"), "low");
});

test("resolveUrgency bumps the category default one level when marked urgent", () => {
    assert.equal(resolveUrgency("other", true), "medium");
    assert.equal(resolveUrgency("flood", true), "high");
    assert.equal(resolveUrgency("road-accident", true), "high");
});

test("resolveUrgency never lowers urgency", () => {
    assert.equal(resolveUrgency("fire", true), "high");
    assert.equal(resolveUrgency("medical", true), "high");
});

test("resolveUrgency falls back to low for an unknown category", () => {
    assert.equal(resolveUrgency("mystery"), "low");
    assert.equal(resolveUrgency("mystery", true), "medium");
});
