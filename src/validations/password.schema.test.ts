import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordField } from "./password.schema";

function isValid(password: string): boolean {
    return passwordField.safeParse(password).success;
}

test("accepts the shortest valid password (8 chars, all required types)", () => {
    assert.equal(isValid("Abcde1!g"), true); // 8 chars: upper, lower, number, symbol
});

// "Ab1!" + lowercase padding: exactly n characters with every required type.
const ofLength = (n: number) => "Ab1!" + "x".repeat(n - 4);

test("accepts the longest valid password (64 chars, all required types)", () => {
    assert.equal(ofLength(64).length, 64);
    assert.equal(isValid(ofLength(64)), true);
});

test("accepts a long passphrase that the old 12-character limit refused", () => {
    assert.equal(isValid("Cordova-Flood-Safe-2026!"), true); // 24 chars
});

test("rejects 7 characters (one below the minimum)", () => {
    assert.equal(isValid("Abcde1!"), false);
});

test("rejects 65 characters (one above the maximum)", () => {
    assert.equal(isValid(ofLength(65)), false);
});

test("the maximum stays within bcrypt's 72-byte input limit for ASCII passwords", () => {
    assert.ok(Buffer.byteLength(ofLength(64), "utf8") <= 72);
});

test("rejects a password under 64 characters that is over bcrypt's 72 bytes (emoji)", () => {
    const emoji = "Ab1!" + "\u{1F600}".repeat(20); // 44 UTF-16 units, 84 bytes
    assert.ok(emoji.length <= 64);
    assert.ok(Buffer.byteLength(emoji, "utf8") > 72);
    assert.equal(isValid(emoji), false);
});

test("accepts a short password with a few multi-byte characters", () => {
    assert.equal(isValid("Mañana-Cebu-1!"), true); // ñ is 2 bytes; well under 72
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
