import assert from "node:assert/strict";
import { test } from "node:test";

import { forgotPasswordSchema, resetPasswordSchema } from "@/validations/auth.validation";

const valid = { email: " Juana@Example.com ", code: "048213", newPassword: "NewPass1!" };

test("forgot-password accepts a valid email and normalizes it", () => {
    const parsed = forgotPasswordSchema.parse({ email: " Juana@Example.com " });
    assert.equal(parsed.email, "juana@example.com");
});

test("forgot-password rejects a malformed email", () => {
    assert.equal(forgotPasswordSchema.safeParse({ email: "juana@" }).success, false);
    assert.equal(forgotPasswordSchema.safeParse({}).success, false);
});

test("reset-password accepts a valid request", () => {
    const parsed = resetPasswordSchema.parse(valid);
    assert.equal(parsed.email, "juana@example.com");
    assert.equal(parsed.code, "048213");
});

test("reset-password requires exactly 6 digits for the code", () => {
    for (const code of ["12345", "1234567", "12a456", ""]) {
        assert.equal(resetPasswordSchema.safeParse({ ...valid, code }).success, false, code);
    }
});

test("reset-password enforces the shared password policy on newPassword", () => {
    const weak = {
        "too short": "Ab1!",
        "too long": "Ab1!" + "x".repeat(61), // 65 characters
        "no uppercase": "newpass1!",
        "no lowercase": "NEWPASS1!",
        "no number": "NewPass!!",
        "no symbol": "NewPass11",
    };
    for (const [why, newPassword] of Object.entries(weak)) {
        assert.equal(resetPasswordSchema.safeParse({ ...valid, newPassword }).success, false, why);
    }
});
