import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { AppError } from "@/utils/AppError";
import {
    DEFAULT_OTP_CONFIG,
    loadOtpConfig,
    requestRegistrationOtp,
    resendRegistrationOtp,
    verifyRegistrationOtp,
    type CreatedUser,
    type PendingRegistrationRow,
    type RegistrationOtpDeps,
} from "@/services/pendingRegistrationFlow";

const TEN_MINUTES = 10 * 60 * 1000;
const START = new Date("2026-09-30T03:00:00.000Z");

type StoredUser = CreatedUser & { password: string };

function createFakeDeps(overrides: Partial<RegistrationOtpDeps> = {}) {
    const pendingRows = new Map<string, PendingRegistrationRow>();
    const users: StoredUser[] = [];
    const sentEmails: { to: string; code: string; expiryMinutes: number }[] = [];
    const createdEvents: CreatedUser[] = [];
    const hashedValues: string[] = [];
    let clock = START;
    let userSeq = 0;

    const deps: RegistrationOtpDeps = {
        pendingStore: {
            async findByEmail(email) {
                const row = pendingRows.get(email);
                return row ? { ...row } : null;
            },
            async upsert(row) {
                pendingRows.set(row.email, { ...row });
            },
            async incrementAttempts(email) {
                const row = pendingRows.get(email);
                if (row) row.attempts += 1;
            },
            async consume(email) {
                return pendingRows.delete(email);
            },
        },
        userStore: {
            async findByEmail(email) {
                const user = users.find((u) => u.email === email);
                return user ? { id: user.id } : null;
            },
            async create(data) {
                const user: StoredUser = {
                    id: `user-${++userSeq}`,
                    email: data.email,
                    name: data.name,
                    role: "citizen",
                    isOnDuty: true,
                    createdAt: clock,
                    password: data.passwordHash,
                };
                users.push(user);
                return user;
            },
        },
        // Reversible fake "hash" so compareHash can check equality without
        // real bcrypt; stored values are still never the plain input.
        hash: async (value) => {
            hashedValues.push(value);
            return `hashed:${value}`;
        },
        compareHash: async (value, hash) => `hashed:${value}` === hash,
        async sendOtpEmail(to, code, expiryMinutes) {
            sentEmails.push({ to, code, expiryMinutes });
        },
        now: () => clock,
        config: DEFAULT_OTP_CONFIG,
        onUserCreated: (user) => {
            createdEvents.push(user);
        },
        ...overrides,
    };

    return {
        deps,
        pendingRows,
        users,
        sentEmails,
        createdEvents,
        hashedValues,
        advanceClock(ms: number) {
            clock = new Date(clock.getTime() + ms);
        },
        lastCode() {
            return sentEmails[sentEmails.length - 1].code;
        },
        addUser(email: string) {
            users.push({ id: `existing-${users.length}`, email, name: null, role: "citizen", isOnDuty: true, createdAt: clock, password: "x" });
        },
    };
}

const REGISTRATION = { name: " Juana ", email: " Juana@Example.com ", password: "secret123" };

function wrongCodeFor(code: string): string {
    return code === "000000" ? "111111" : "000000";
}

async function rejectsWithStatus(promise: Promise<unknown>, statusCode: number, message?: RegExp) {
    await assert.rejects(promise, (err: unknown) => {
        assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
        assert.equal(err.statusCode, statusCode);
        if (message) assert.match(err.message, message);
        return true;
    });
}

// Captures everything written to the console during a test.
function captureConsole(t: TestContext) {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
        t.mock.method(console, method, (...args: unknown[]) => {
            lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "));
        });
    }
    return lines;
}

// --- configuration ---------------------------------------------------------

test("loadOtpConfig defaults to 10 minutes / 60 seconds / 5 attempts", () => {
    assert.deepEqual(loadOtpConfig({}), { expiryMs: TEN_MINUTES, resendCooldownMs: 60_000, maxAttempts: 5 });
});

test("loadOtpConfig reads OTP_EXPIRY_MINUTES, OTP_RESEND_COOLDOWN_SECONDS and OTP_MAX_ATTEMPTS", () => {
    assert.deepEqual(
        loadOtpConfig({ OTP_EXPIRY_MINUTES: "15", OTP_RESEND_COOLDOWN_SECONDS: "90", OTP_MAX_ATTEMPTS: "3" }),
        { expiryMs: 15 * 60_000, resendCooldownMs: 90_000, maxAttempts: 3 },
    );
});

test("loadOtpConfig falls back to safe defaults for zero, negative or non-numeric values", () => {
    assert.deepEqual(
        loadOtpConfig({ OTP_EXPIRY_MINUTES: "0", OTP_RESEND_COOLDOWN_SECONDS: "-5", OTP_MAX_ATTEMPTS: "lots" }),
        DEFAULT_OTP_CONFIG,
    );
});

// --- request-otp -----------------------------------------------------------

test("request-otp emails a 6-digit code and stores only hashes of the code and password", async () => {
    const { deps, pendingRows, sentEmails } = createFakeDeps();

    await requestRegistrationOtp(REGISTRATION, deps);

    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "juana@example.com");
    assert.match(sentEmails[0].code, /^\d{6}$/);
    assert.equal(sentEmails[0].expiryMinutes, 10);

    const row = pendingRows.get("juana@example.com")!;
    assert.equal(row.name, "Juana");
    assert.equal(row.attempts, 0);
    assert.equal(row.otpExpiresAt.getTime() - START.getTime(), TEN_MINUTES);
    assert.equal(row.passwordHash, "hashed:secret123");
    assert.notEqual(row.passwordHash, "secret123", "the plain password must never be stored");
    assert.equal(row.otpHash, `hashed:${sentEmails[0].code}`);
    assert.notEqual(row.otpHash, sentEmails[0].code, "the plain code must never be stored");
});

test("request-otp never returns the code or the password -- only the resend cooldown", async () => {
    const { deps, sentEmails } = createFakeDeps();

    const response = await requestRegistrationOtp(REGISTRATION, deps);

    assert.deepEqual(response, { resendCooldownSeconds: 60 });
    const serialized = JSON.stringify(response);
    assert.ok(!serialized.includes(sentEmails[0].code));
    assert.ok(!serialized.includes("secret123"));
});

test("request-otp generates codes with crypto, never Math.random", async (t) => {
    const mathRandom = t.mock.method(Math, "random");
    const codes = new Set<string>();

    for (let i = 0; i < 20; i++) {
        const { deps, lastCode } = createFakeDeps();
        await requestRegistrationOtp(REGISTRATION, deps);
        assert.match(lastCode(), /^\d{6}$/);
        codes.add(lastCode());
    }

    assert.equal(mathRandom.mock.callCount(), 0);
    assert.ok(codes.size > 1, "codes must vary between requests");
});

test("request-otp never logs the code or the password", async (t) => {
    const lines = captureConsole(t);
    const { deps, lastCode } = createFakeDeps();

    await requestRegistrationOtp(REGISTRATION, deps);

    assert.ok(!lines.some((line) => line.includes(lastCode()) || line.includes("secret123")));
});

test("request-otp rejects an email that already belongs to a User, without sending anything", async () => {
    const { deps, sentEmails, pendingRows, addUser } = createFakeDeps();
    addUser("juana@example.com");

    await rejectsWithStatus(requestRegistrationOtp(REGISTRATION, deps), 409, /Email already registered/);
    assert.equal(sentEmails.length, 0);
    assert.equal(pendingRows.size, 0);
});

test("request-otp enforces the resend cooldown server-side", async () => {
    const { deps, sentEmails, advanceClock } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);

    advanceClock(30_000);
    await rejectsWithStatus(requestRegistrationOtp(REGISTRATION, deps), 429);
    assert.equal(sentEmails.length, 1, "no email may be sent during the cooldown");

    advanceClock(30_000);
    await requestRegistrationOtp(REGISTRATION, deps);
    assert.equal(sentEmails.length, 2);
});

test("request-otp allows an immediate new request once the previous code has expired", async () => {
    const { deps, sentEmails, advanceClock } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    advanceClock(TEN_MINUTES + 1);
    await requestRegistrationOtp(REGISTRATION, deps);
    assert.equal(sentEmails.length, 2);
});

test("request-otp sends before saving: a send failure leaves no pending row and no cooldown", async () => {
    let fail = true;
    const { deps, pendingRows, sentEmails } = createFakeDeps({
        async sendOtpEmail(to, code, expiryMinutes) {
            if (fail) throw new AppError("Couldn't send the verification email. Please try again.", 502);
            sentEmails.push({ to, code, expiryMinutes });
        },
    });

    await rejectsWithStatus(requestRegistrationOtp(REGISTRATION, deps), 502);
    assert.equal(pendingRows.size, 0);

    fail = false;
    await requestRegistrationOtp(REGISTRATION, deps); // no false cooldown
    assert.equal(sentEmails.length, 1);
});

// --- resend-otp ------------------------------------------------------------

test("resend-otp needs only the email and reuses the stored password hash", async () => {
    const { deps, pendingRows, sentEmails, hashedValues, advanceClock } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    const passwordHashBefore = pendingRows.get("juana@example.com")!.passwordHash;
    const hashedBefore = hashedValues.length;

    advanceClock(60_000);
    const response = await resendRegistrationOtp({ email: " JUANA@example.com " }, deps);

    assert.deepEqual(response, { resendCooldownSeconds: 60 });
    assert.equal(sentEmails.length, 2);
    assert.equal(pendingRows.get("juana@example.com")!.passwordHash, passwordHashBefore);
    // Only the new code was hashed -- no password was involved.
    assert.equal(hashedValues.length, hashedBefore + 1);
    assert.equal(hashedValues[hashedValues.length - 1], sentEmails[1].code);
});

test("resend-otp issues a new code, invalidates the old one and resets attempts", async () => {
    const { deps, pendingRows, advanceClock, lastCode } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    const oldCode = lastCode();
    await assert.rejects(verifyRegistrationOtp({ email: "juana@example.com", code: wrongCodeFor(oldCode) }, deps));
    assert.equal(pendingRows.get("juana@example.com")!.attempts, 1);

    let newCode = oldCode;
    // Retry until the random code differs, so the old-code check is meaningful.
    while (newCode === oldCode) {
        advanceClock(60_000);
        await resendRegistrationOtp({ email: "juana@example.com" }, deps);
        newCode = lastCode();
    }

    assert.equal(pendingRows.get("juana@example.com")!.attempts, 0);
    await rejectsWithStatus(verifyRegistrationOtp({ email: "juana@example.com", code: oldCode }, deps), 401);
    const user = await verifyRegistrationOtp({ email: "juana@example.com", code: newCode }, deps);
    assert.equal(user.email, "juana@example.com");
});

test("resend-otp enforces the cooldown server-side", async () => {
    const { deps, sentEmails, advanceClock } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);

    advanceClock(59_000);
    await rejectsWithStatus(resendRegistrationOtp({ email: "juana@example.com" }, deps), 429);
    assert.equal(sentEmails.length, 1);
});

test("resend-otp honours a configured cooldown", async () => {
    const { deps, advanceClock } = createFakeDeps({ config: { ...DEFAULT_OTP_CONFIG, resendCooldownMs: 120_000 } });
    await requestRegistrationOtp(REGISTRATION, deps);
    advanceClock(90_000);
    await rejectsWithStatus(resendRegistrationOtp({ email: "juana@example.com" }, deps), 429);
});

test("a failed resend leaves the previous code working", async () => {
    let fail = false;
    const { deps, sentEmails, advanceClock } = createFakeDeps({
        async sendOtpEmail(to, code, expiryMinutes) {
            if (fail) throw new AppError("send failed", 502);
            sentEmails.push({ to, code, expiryMinutes });
        },
    });
    await requestRegistrationOtp(REGISTRATION, deps);
    const original = sentEmails[0].code;

    advanceClock(60_000);
    fail = true;
    await rejectsWithStatus(resendRegistrationOtp({ email: "juana@example.com" }, deps), 502);

    const user = await verifyRegistrationOtp({ email: "juana@example.com", code: original }, deps);
    assert.equal(user.email, "juana@example.com");
});

test("resend-otp rejects an email with no pending registration", async () => {
    const { deps, sentEmails } = createFakeDeps();
    await rejectsWithStatus(resendRegistrationOtp({ email: "nobody@example.com" }, deps), 404);
    assert.equal(sentEmails.length, 0);
});

test("resend-otp rejects an email that has since become a registered User", async () => {
    const { deps, sentEmails, advanceClock, addUser } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    addUser("juana@example.com");
    advanceClock(60_000);

    await rejectsWithStatus(resendRegistrationOtp({ email: "juana@example.com" }, deps), 409);
    assert.equal(sentEmails.length, 1);
});

test("resend-otp never logs or returns the code", async (t) => {
    const lines = captureConsole(t);
    const { deps, advanceClock, lastCode } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    advanceClock(60_000);

    const response = await resendRegistrationOtp({ email: "juana@example.com" }, deps);

    assert.ok(!JSON.stringify(response).includes(lastCode()));
    assert.ok(!lines.some((line) => line.includes(lastCode())));
});

// --- verify-otp ------------------------------------------------------------

test("verify-otp creates the User with the stored bcrypt password hash and consumes the code", async () => {
    const { deps, pendingRows, users, createdEvents, lastCode } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);

    const user = await verifyRegistrationOtp({ email: "Juana@Example.com", code: lastCode() }, deps);

    assert.equal(user.email, "juana@example.com");
    assert.equal(user.name, "Juana");
    assert.equal(users.length, 1);
    assert.equal(users[0].password, "hashed:secret123");
    assert.equal(pendingRows.size, 0);
    assert.equal(createdEvents.length, 1);
});

test("a used code cannot be used again", async () => {
    const { deps, users, lastCode } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    const code = lastCode();

    await verifyRegistrationOtp({ email: "juana@example.com", code }, deps);
    await rejectsWithStatus(verifyRegistrationOtp({ email: "juana@example.com", code }, deps), 404);
    assert.equal(users.length, 1);
});

test("two simultaneous verifications with the correct code succeed only once", async () => {
    const { deps, users, lastCode } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    const code = lastCode();

    const results = await Promise.allSettled([
        verifyRegistrationOtp({ email: "juana@example.com", code }, deps),
        verifyRegistrationOtp({ email: "juana@example.com", code }, deps),
    ]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(users.length, 1);
});

test("verify-otp rejects a wrong code with 401 and counts the attempt", async () => {
    const { deps, pendingRows, lastCode } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);

    await rejectsWithStatus(
        verifyRegistrationOtp({ email: "juana@example.com", code: wrongCodeFor(lastCode()) }, deps),
        401,
        /Incorrect code/,
    );
    assert.equal(pendingRows.get("juana@example.com")!.attempts, 1);
});

test("the attempt limit invalidates the code, even the correct one", async () => {
    const { deps, users, lastCode } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    const real = lastCode();
    const wrong = wrongCodeFor(real);

    for (let i = 0; i < 4; i++) {
        await rejectsWithStatus(verifyRegistrationOtp({ email: "juana@example.com", code: wrong }, deps), 401);
    }
    await rejectsWithStatus(verifyRegistrationOtp({ email: "juana@example.com", code: wrong }, deps), 429, /Too many attempts/);
    await rejectsWithStatus(verifyRegistrationOtp({ email: "juana@example.com", code: real }, deps), 429, /Too many attempts/);
    assert.equal(users.length, 0);
});

test("verify-otp honours a configured attempt limit", async () => {
    const { deps, lastCode } = createFakeDeps({ config: { ...DEFAULT_OTP_CONFIG, maxAttempts: 2 } });
    await requestRegistrationOtp(REGISTRATION, deps);
    const wrong = wrongCodeFor(lastCode());
    await rejectsWithStatus(verifyRegistrationOtp({ email: "juana@example.com", code: wrong }, deps), 401);
    await rejectsWithStatus(verifyRegistrationOtp({ email: "juana@example.com", code: wrong }, deps), 429);
});

test("verify-otp rejects an expired code with 410", async () => {
    const { deps, advanceClock, lastCode } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    advanceClock(TEN_MINUTES + 1);
    await rejectsWithStatus(verifyRegistrationOtp({ email: "juana@example.com", code: lastCode() }, deps), 410);
});

test("verify-otp rejects when nothing is pending", async () => {
    const { deps } = createFakeDeps();
    await rejectsWithStatus(verifyRegistrationOtp({ email: "nobody@example.com", code: "123456" }, deps), 404);
});

test("verify-otp refuses an email that became a registered User meanwhile", async () => {
    const { deps, users, lastCode, addUser } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    addUser("juana@example.com");

    await rejectsWithStatus(verifyRegistrationOtp({ email: "juana@example.com", code: lastCode() }, deps), 409);
    assert.equal(users.length, 1, "no second account may be created");
});

test("verify-otp never logs the code or the password", async (t) => {
    const lines = captureConsole(t);
    const { deps, lastCode } = createFakeDeps();
    await requestRegistrationOtp(REGISTRATION, deps);
    const code = lastCode();

    await assert.rejects(verifyRegistrationOtp({ email: "juana@example.com", code: wrongCodeFor(code) }, deps));
    await verifyRegistrationOtp({ email: "juana@example.com", code }, deps);

    assert.ok(!lines.some((line) => line.includes(code) || line.includes("secret123")));
});
