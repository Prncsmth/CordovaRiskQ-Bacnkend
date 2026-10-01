import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordField } from "./password.schema";

function isValid(password: string): boolean {
    return passwordField.safeParse(password).success;
}

test("accepts the shortest valid password (8 chars, all required types)", () => {
    assert.equal(isValid("Abcde1!g"), true); // 8 chars: upper, lower, number, symbol
});

test("accepts the longest valid password (12 chars, all required types)", () => {
    assert.equal(isValid("Abcdefghij1!"), true); // 12 chars
})

test("rejects 7 characters (one below the minimum)", () => {
    assert.equal(isValid("Abcde1!"), false);
});

test("rejects 13 characters (one above the maximum)", () => {
    assert.equal(isValid("Abcdefghijk1!"), false);
});

test("rejects a password missing an uppercase letter", () => {
    assert.equal(isValid("abcdefg1!"), false);
});

test("rejects a password missing a lowercase letter", () => {
    assert.equal(isValid("ABCDEFG1!"), false);
});

test("rejects a password missing a number", () => {
    assert.equal(isValid("Abcdefgh!"), false);
});

test("rejects a password missing a symbol", () => {
    assert.equal(isValid("Abcdefg12"), false);
});
