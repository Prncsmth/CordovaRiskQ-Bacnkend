import assert from "node:assert/strict";
import { test } from "node:test";

import { ADMIN_APP_LOGIN_MESSAGE, assertPortalAllowed } from "@/services/loginPortal";
import { AppError } from "@/utils/AppError";

function errorOf(fn: () => void): AppError {
    try {
        fn();
    } catch (err) {
        assert.ok(err instanceof AppError);
        return err;
    }
    assert.fail("expected an AppError");
}

test("citizens and responders may use the mobile app login", () => {
    assert.doesNotThrow(() => assertPortalAllowed("citizen", "app"));
    assert.doesNotThrow(() => assertPortalAllowed("responder", "app"));
});

test("an admin is refused at the mobile app login with a 403 pointing to the dashboard", () => {
    const err = errorOf(() => assertPortalAllowed("admin", "app"));
    assert.equal(err.statusCode, 403);
    assert.equal(err.message, ADMIN_APP_LOGIN_MESSAGE);
    assert.equal(ADMIN_APP_LOGIN_MESSAGE, "Admin accounts can only sign in through the admin dashboard.");
});

test("only an admin may use the admin login", () => {
    assert.doesNotThrow(() => assertPortalAllowed("admin", "admin"));
});

test("a non-admin at the admin login gets the generic credentials error", () => {
    for (const role of ["citizen", "responder", ""]) {
        const err = errorOf(() => assertPortalAllowed(role, "admin"));
        assert.equal(err.statusCode, 401);
        assert.equal(err.message, "Invalid email or password");
    }
});
