// Service-level checks for the two password logins and Google sign-in, with
// the Prisma delegates and Google token verification stubbed (no database).
process.env.JWT_SECRET ||= "test-secret";

import assert from "node:assert/strict";
import { afterEach, before, mock, test } from "node:test";
import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { authService } from "@/services/auth.service";
import { ADMIN_APP_LOGIN_MESSAGE } from "@/services/loginPortal";

const PASSWORD = "Correct1!";
let hash = "";

before(async () => {
    hash = await bcrypt.hash(PASSWORD, 4);
});

// prisma.user is a lazy proxy whose delegates mock.method can't see, so they
// are stubbed by plain assignment and put back (original value) afterwards.
type Delegate = "findFirst" | "findUnique" | "update" | "create";
const userDelegate = prisma.user as unknown as Record<Delegate, unknown>;
const originals = new Map<Delegate, unknown>();
const calls: Record<Delegate, number> = { findFirst: 0, findUnique: 0, update: 0, create: 0 };

function stub(name: Delegate, impl: (args?: any) => Promise<unknown>) {
    if (!originals.has(name)) originals.set(name, userDelegate[name]);
    userDelegate[name] = async (args?: unknown) => {
        calls[name]++;
        return impl(args);
    };
}

afterEach(() => {
    mock.restoreAll();
    for (const [name, original] of originals) userDelegate[name] = original;
    originals.clear();
    for (const k of Object.keys(calls) as Delegate[]) calls[k] = 0;
});

function makeUser(role: string, extra: Record<string, unknown> = {}) {
    return {
        id: `id-${role}`,
        email: `${role}@example.com`,
        name: "Test User",
        role,
        isOnDuty: false,
        tokenVersion: 0,
        password: hash,
        googleId: null,
        createdAt: new Date(),
        ...extra,
    };
}

function stubFindFirst(user: ReturnType<typeof makeUser> | null) {
    stub("findFirst", async () => user);
}

async function rejection(p: Promise<unknown>): Promise<AppError> {
    try {
        await p;
    } catch (e) {
        assert.ok(e instanceof AppError, "rejects with an AppError");
        return e;
    }
    assert.fail("expected a rejection");
}

test("login refuses an admin with the correct password (403)", async () => {
    stubFindFirst(makeUser("admin"));
    const err = await rejection(authService.login("admin@example.com", PASSWORD));
    assert.equal(err.statusCode, 403);
    assert.equal(err.message, ADMIN_APP_LOGIN_MESSAGE);
    assert.equal(err.message, "Admin accounts can only sign in through the admin dashboard.");
});

test("login with an admin's WRONG password is a plain 401 (role not revealed)", async () => {
    stubFindFirst(makeUser("admin"));
    const err = await rejection(authService.login("admin@example.com", "Wrong1!"));
    assert.equal(err.statusCode, 401);
    assert.equal(err.message, "Invalid email or password");
});

test("login succeeds for a citizen", async () => {
    stubFindFirst(makeUser("citizen"));
    const result = await authService.login("citizen@example.com", PASSWORD);
    assert.deepEqual(result.user, {
        id: "id-citizen",
        email: "citizen@example.com",
        name: "Test User",
        role: "citizen",
        isOnDuty: false,
    });
    assert.equal(typeof result.token, "string");
    assert.ok(result.token.length > 0);
});

test("adminLogin succeeds for an admin", async () => {
    stubFindFirst(makeUser("admin"));
    const result = await authService.adminLogin("admin@example.com", PASSWORD);
    assert.deepEqual(result.user, {
        id: "id-admin",
        email: "admin@example.com",
        name: "Test User",
        role: "admin",
        isOnDuty: false,
    });
    assert.equal(typeof result.token, "string");
    assert.ok(result.token.length > 0);
});

for (const role of ["citizen", "responder"]) {
    test(`adminLogin refuses a ${role} with the correct password (401)`, async () => {
        stubFindFirst(makeUser(role));
        const err = await rejection(authService.adminLogin(`${role}@example.com`, PASSWORD));
        assert.equal(err.statusCode, 401);
        assert.equal(err.message, "Invalid email or password");
    });
}

test("loginWithGoogle refuses an admin matched by email before linking the Google id", async () => {
    mock.method(OAuth2Client.prototype, "verifyIdToken", (async () => ({
        getPayload: () => ({ email: "admin@example.com", email_verified: true, name: "A", sub: "google-sub" }),
    })) as never);
    stub("findUnique", async () => null);
    stubFindFirst(makeUser("admin"));
    stub("update", async () => {
        throw new Error("update must not be called");
    });
    stub("create", async () => {
        throw new Error("create must not be called");
    });

    const err = await rejection(authService.loginWithGoogle("token"));
    assert.equal(err.statusCode, 403);
    assert.equal(calls.update, 0);
    assert.equal(calls.create, 0);
});

function stubGoogleToken(email: string) {
    mock.method(OAuth2Client.prototype, "verifyIdToken", (async () => ({
        getPayload: () => ({ email, email_verified: true, name: "A", sub: "google-sub" }),
    })) as never);
}

test("loginWithGoogle refuses an admin already linked by googleId (403, nothing written)", async () => {
    stubGoogleToken("admin@example.com");
    stub("findUnique", async () => makeUser("admin", { googleId: "google-sub" }));
    stub("findFirst", async () => {
        throw new Error("findFirst must not be reached");
    });
    stub("update", async () => {
        throw new Error("update must not be called");
    });
    stub("create", async () => {
        throw new Error("create must not be called");
    });

    const err = await rejection(authService.loginWithGoogle("token"));
    assert.equal(err.statusCode, 403);
    assert.equal(err.message, ADMIN_APP_LOGIN_MESSAGE);
    assert.equal(calls.update, 0);
    assert.equal(calls.create, 0);
});

test("loginWithGoogle links an existing citizen matched by email", async () => {
    stubGoogleToken("citizen@example.com");
    stub("findUnique", async () => null);
    stubFindFirst(makeUser("citizen"));
    stub("update", async () => makeUser("citizen", { googleId: "google-sub" }));
    stub("create", async () => {
        throw new Error("create must not be called");
    });

    const result = await authService.loginWithGoogle("token");
    assert.equal(calls.update, 1);
    assert.equal(calls.create, 0);
    assert.equal(result.isNewUser, false);
    assert.deepEqual(result.user, {
        id: "id-citizen",
        email: "citizen@example.com",
        name: "Test User",
        role: "citizen",
        isOnDuty: false,
    });
    assert.ok(result.token.length > 0);
});

// --- Google sign-in: account persistence ---------------------------------

function stubGooglePayload(payload: Record<string, unknown>) {
    mock.method(OAuth2Client.prototype, "verifyIdToken", (async () => ({
        getPayload: () => ({ email_verified: true, sub: "google-sub", ...payload }),
    })) as never);
}

// What Prisma throws when a unique column (googleId / email) already holds
// the value -- here, because a concurrent first sign-in created the row.
function uniqueConstraintError() {
    return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

test("first-time Google sign-in creates one User with the verified email and Google name", async () => {
    stubGooglePayload({ email: "New.Person@Gmail.com", name: "New Person" });
    stub("findUnique", async () => null);
    stubFindFirst(null);
    let created: any = null;
    stub("create", async (args) => {
        created = args.data;
        return makeUser("citizen", { email: args.data.email, name: args.data.name, googleId: args.data.googleId, password: null });
    });

    const result = await authService.loginWithGoogle("token");

    assert.equal(calls.create, 1);
    assert.deepEqual(created, { email: "new.person@gmail.com", name: "New Person", googleId: "google-sub" });
    assert.equal(result.isNewUser, true);
    assert.equal(result.user.email, "new.person@gmail.com");
});

test("first-time Google sign-in with no display name stores no invented name", async () => {
    stubGooglePayload({ email: "noname@gmail.com" });
    stub("findUnique", async () => null);
    stubFindFirst(null);
    let created: any = null;
    stub("create", async (args) => {
        created = args.data;
        return makeUser("citizen", { email: args.data.email, name: null, googleId: "google-sub", password: null });
    });

    const result = await authService.loginWithGoogle("token");

    assert.equal(created.name, undefined);
    assert.equal(result.user.name, null);
});

test("returning Google sign-in reuses the linked User and creates nothing", async () => {
    stubGooglePayload({ email: "citizen@example.com", name: "A" });
    stub("findUnique", async () => makeUser("citizen", { googleId: "google-sub" }));
    stub("create", async () => {
        throw new Error("create must not be called");
    });

    const result = await authService.loginWithGoogle("token");

    assert.equal(calls.create, 0);
    assert.equal(result.isNewUser, false);
    assert.equal(result.user.id, "id-citizen");
});

test("two simultaneous first sign-ins: the one that loses the create race gets the same account, not a 500", async () => {
    stubGooglePayload({ email: "racer@gmail.com", name: "Racer" });
    const winner = makeUser("citizen", { id: "id-racer", email: "racer@gmail.com", googleId: "google-sub", password: null });
    // Not there on the first lookup; there once the other request committed.
    let lookups = 0;
    stub("findUnique", async () => (lookups++ === 0 ? null : winner));
    stubFindFirst(null);
    stub("create", async () => {
        throw uniqueConstraintError();
    });

    const result = await authService.loginWithGoogle("token");

    assert.equal(result.user.id, "id-racer");
    assert.equal(result.isNewUser, true);
    assert.equal(calls.create, 1);
});

test("a create failure that is not a unique-constraint race is not swallowed", async () => {
    stubGooglePayload({ email: "broken@gmail.com", name: "B" });
    stub("findUnique", async () => null);
    stubFindFirst(null);
    stub("create", async () => {
        throw new Error("database unavailable");
    });

    await assert.rejects(authService.loginWithGoogle("token"), /database unavailable/);
});

test("stubbed delegates are restored after each test", () => {
    assert.equal(typeof prisma.user.findFirst, "function");
    assert.equal(calls.findFirst, 0);
});
