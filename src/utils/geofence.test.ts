import assert from "node:assert/strict";
import { test } from "node:test";

import { isInsideCordova } from "@/utils/geofence";

test("isInsideCordova is true for the Cordova municipal center", () => {
    assert.equal(isInsideCordova(10.2515, 123.9499), true);
});

test("isInsideCordova is true for Gilutongan Island (part of Cordova)", () => {
    assert.equal(isInsideCordova(10.207, 123.988), true);
});

test("isInsideCordova is true exactly on a boundary vertex", () => {
    assert.equal(isInsideCordova(10.2463015, 123.8896035), true);
});

test("isInsideCordova is false for Lapu-Lapu City center", () => {
    assert.equal(isInsideCordova(10.3103, 123.9494), false);
});

test("isInsideCordova is false for Cebu City center", () => {
    assert.equal(isInsideCordova(10.3157, 123.8854), false);
});

test("isInsideCordova is false for Mandaue City center", () => {
    assert.equal(isInsideCordova(10.3236, 123.9227), false);
});

test("isInsideCordova is false far out in the open ocean", () => {
    assert.equal(isInsideCordova(10.25, 124.5), false);
});
