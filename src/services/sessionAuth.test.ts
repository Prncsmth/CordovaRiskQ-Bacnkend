// Session revocation, end to end through the real JWT signing and the real
// reset/change-password flows, with an in-memory user store standing in for
// Prisma. The store applies sessionAuth.passwordUpdateData exactly as the
// Prisma wiring does (tokenVersion: { increment: 1 }).
import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";

// utils/jwt.ts reads the secret when first imported, so set a test-only one
// before loading anything that imports it.
process.env.JWT_SECRET ??= "test-only-jwt-secret";
const TEST_SECRET = process.env.JWT_SECRET;

const { issueSessionToken, passwordUpdateData, verifySession } = await import("@/services/sessionAuth");
const { resetPassword, requestPasswordReset } = await import("@/services/passwordResetFlow");
const { changePassword } = await import("@/services/changePasswordFlow");
const { DEFAULT_OTP_CONFIG } = await import("@/services/pendingRegistrationFlow");

type User = { id: string; email: string; password: string | null; tokenVersion: number; role: string };

function createUsers() {
    const users = new Map<string, User>([
        ["u-juana", { id: "u-juana", email: "juana@example.com", password: "hashed:OldPass1!", tokenVersion: 0, role: "citizen" }],
        ["u-pedro", { id: "u-pedro", email: "pedro@example.com", password: "hashed:Pedro1!x", tokenVersion: 0, role: "responder" }],
    ]);

    // Mirrors the Prisma update: set the password, increment tokenVersion.
    function applyPasswordUpdate(userId: string, passwordHash: string) {
        const user = users.get(userId)!;
        const data = passwordUpdateData(passwordHash);
        user.password = data.password;
        user.tokenVersion += data.tokenVersion.increment;
        return { id: user.id, tokenVersion: user.tokenVersion };
    }

    const sessionStore = {
        async findSessionUser(userId: string) {
            const user = users.get(userId);
            return user ? { tokenVersion: user.tokenVersion, role: user.role } : null;
        },
    };

    // Simulates a login: issues a token for the user's current version.
    const login = (userId: string) => issueSessionToken(users.get(userId)!);

    return { users, applyPasswordUpdate, sessionStore, login };
}

const hash = async (value: string) => `hashed:${value}`;
const compareHash = async (value: string, stored: string) => `hashed:${value}` === stored;

async function resetJuanasPasswordByEmailCode(ctx: ReturnType<typeof createUsers>) {
    const sent: string[] = [];
    const rows = new Map<string, { email: string; otpHash: string; otpExpiresAt: Date; attempts: number }>();
    const deps = {
        resetStore: {
            findByEmail: async (email: string) => rows.get(email) ?? null,
            upsert: async (row: { email: string; otpHash: string; otpExpiresAt: Date; attempts: number }) => {
                rows.set(row.email, { ...row });
            },
            incrementAttempts: async () => {},
            consume: async (email: string) => rows.delete(email),
        },
        userStore: {
            findByEmail: async (email: string) => {
                const user = [...ctx.users.values()].find((u) => u.email === email);
                return user ? { id: user.id, hasPassword: user.password !== null } : null;
            },
            updatePassword: async (userId: string, passwordHash: string) => {
                ctx.applyPasswordUpdate(userId, passwordHash);
            },
        },
        hash,
        compareHash,
        sendResetEmail: async (_to: string, code: string) => {
            sent.push(code);
        },
        onPasswordChanged: () => {},
        now: () => new Date("2026-10-04T03:00:00.000Z"),
        config: DEFAULT_OTP_CONFIG,
    };
    await requestPasswordReset({ email: "juana@example.com" }, deps);
    await resetPassword({ email: "juana@example.com", code: sent[0], newPassword: "NewPass1!" }, deps);
}

test("a current token is accepted", async () => {
    const ctx = createUsers();
    const token = ctx.login("u-juana");

    assert.deepEqual(await verifySession(token, ctx.sessionStore), { userId: "u-juana", role: "citizen" });
});

test("a token from before this feature (no version claim) keeps working until the password changes", async () => {
    const ctx = createUsers();
    const legacyToken = jwt.sign({ userId: "u-juana" }, TEST_SECRET, { expiresIn: "7d" });

    assert.equal((await verifySession(legacyToken, ctx.sessionStore))?.userId, "u-juana");

    ctx.applyPasswordUpdate("u-juana", "hashed:Changed1!");
    assert.equal(await verifySession(legacyToken, ctx.sessionStore), null);
});

test("an old token is rejected after a Forgot Password reset, and a new login works", async () => {
    const ctx = createUsers();
    const oldToken = ctx.login("u-juana");

    await resetJuanasPasswordByEmailCode(ctx);

    assert.equal(await verifySession(oldToken, ctx.sessionStore), null, "old session revoked");

    const newToken = ctx.login("u-juana");
    assert.equal((await verifySession(newToken, ctx.sessionStore))?.userId, "u-juana", "new login accepted");
});

test("an old token is rejected after Change Password; the device that changed it gets a working token", async () => {
    const ctx = createUsers();
    const otherDevice = ctx.login("u-juana");
    const thisDevice = ctx.login("u-juana");

    const { token: replacement } = await changePassword(
        "u-juana",
        { oldPassword: "OldPass1!", newPassword: "NewPass1!" },
        {
            findUser: async (id) => ctx.users.get(id) ?? null,
            compareHash,
            hash,
            savePasswordAndRevokeSessions: async (id, passwordHash) => ctx.applyPasswordUpdate(id, passwordHash),
            issueToken: issueSessionToken,
            onPasswordChanged: () => {},
        }
    );

    assert.equal(await verifySession(otherDevice, ctx.sessionStore), null, "other device logged out");
    assert.equal(await verifySession(thisDevice, ctx.sessionStore), null, "the request's own old token is revoked too");
    assert.equal((await verifySession(replacement, ctx.sessionStore))?.userId, "u-juana", "replacement token works");
});

test("a wrong old password changes nothing and revokes nothing", async () => {
    const ctx = createUsers();
    const token = ctx.login("u-juana");

    await assert.rejects(
        changePassword(
            "u-juana",
            { oldPassword: "WrongPass1!", newPassword: "NewPass1!" },
            {
                findUser: async (id) => ctx.users.get(id) ?? null,
                compareHash,
                hash,
                savePasswordAndRevokeSessions: async (id, passwordHash) => ctx.applyPasswordUpdate(id, passwordHash),
                issueToken: issueSessionToken,
                onPasswordChanged: () => {},
            }
        )
    );

    assert.equal(ctx.users.get("u-juana")!.tokenVersion, 0);
    assert.equal((await verifySession(token, ctx.sessionStore))?.userId, "u-juana");
});

test("another user's sessions are unaffected by a password change", async () => {
    const ctx = createUsers();
    const pedrosToken = ctx.login("u-pedro");

    await resetJuanasPasswordByEmailCode(ctx);
    ctx.applyPasswordUpdate("u-juana", "hashed:Again1!x");

    assert.deepEqual(await verifySession(pedrosToken, ctx.sessionStore), { userId: "u-pedro", role: "responder" });
});

test("invalid, expired, tampered or deleted-user tokens are rejected", async () => {
    const ctx = createUsers();

    assert.equal(await verifySession("not-a-jwt", ctx.sessionStore), null);
    assert.equal(
        await verifySession(jwt.sign({ userId: "u-juana" }, "some-other-secret"), ctx.sessionStore),
        null,
        "signed with the wrong secret"
    );
    assert.equal(
        await verifySession(jwt.sign({ userId: "u-juana", tokenVersion: 0 }, TEST_SECRET, { expiresIn: -10 }), ctx.sessionStore),
        null,
        "expired"
    );
    assert.equal(
        await verifySession(jwt.sign({ userId: "u-juana", tokenVersion: "0" }, TEST_SECRET), ctx.sessionStore),
        null,
        "non-numeric version claim"
    );
    assert.equal(await verifySession(issueSessionToken({ id: "u-gone", tokenVersion: 0 }), ctx.sessionStore), null);
});

test("a database failure during verification throws instead of looking like a bad token", async () => {
    const ctx = createUsers();
    const token = ctx.login("u-juana");
    const failingStore = {
        findSessionUser: async () => {
            throw new Error("database unreachable");
        },
    };

    await assert.rejects(verifySession(token, failingStore), /database unreachable/);
});

test("the shared password update always revokes sessions", () => {
    assert.deepEqual(passwordUpdateData("hashed:x"), { password: "hashed:x", tokenVersion: { increment: 1 } });
});
