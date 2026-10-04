import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "@/utils/AppError";
import {
    assertEmailUnchanged,
    EMAIL_CHANGE_NOT_ALLOWED_MESSAGE,
    verifiedGoogleEmail,
} from "@/services/accountEmail";
import { updateProfileSchema } from "@/validations/user.validation";

function rejectsEmailChange(fn: () => void) {
    assert.throws(fn, (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.message, EMAIL_CHANGE_NOT_ALLOWED_MESSAGE);
        return true;
    });
}

// --- Edit Profile can't change the email ------------------------------------

test("changing the email through the profile API is rejected", () => {
    rejectsEmailChange(() => assertEmailUnchanged("attacker@gmail.com", "victim@gmail.com"));
});

test("a profile save without an email, or with the same one in any case, is allowed", () => {
    assert.doesNotThrow(() => assertEmailUnchanged("juana@gmail.com", undefined));
    assert.doesNotThrow(() => assertEmailUnchanged("juana@gmail.com", "juana@gmail.com"));
    assert.doesNotThrow(() => assertEmailUnchanged("juana@gmail.com", "  Juana@Gmail.com "));
});

test("the profile schema no longer requires an email, so the app can omit it", () => {
    assert.equal(updateProfileSchema.safeParse({ name: "Juana", mobile: "09171234567" }).success, true);
});

// --- the takeover scenario ------------------------------------------------

test("the account-linking takeover is blocked at its first step", () => {
    // Step 1 of the attack: point your own account at the victim's Gmail so
    // their first "Sign in with Google" would be linked to it. Refused.
    rejectsEmailChange(() => assertEmailUnchanged("attacker@gmail.com", "Victim@Gmail.com"));
});

// --- Google: only a Google-verified email is trusted -----------------------

test("a Google-verified email is accepted and normalized", () => {
    assert.equal(verifiedGoogleEmail({ email: " Juana@Gmail.com ", email_verified: true }), "juana@gmail.com");
});

test("an email Google hasn't verified is never used to find, link or create an account", () => {
    assert.equal(verifiedGoogleEmail({ email: "victim@example.com", email_verified: false }), null);
    assert.equal(verifiedGoogleEmail({ email: "victim@example.com" }), null);
    assert.equal(verifiedGoogleEmail({ email_verified: true }), null);
    assert.equal(verifiedGoogleEmail(undefined), null);
});
