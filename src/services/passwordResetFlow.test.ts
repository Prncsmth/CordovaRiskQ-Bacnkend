import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { AppError } from "@/utils/AppError";
import { DEFAULT_OTP_CONFIG } from "@/services/pendingRegistrationFlow";
import {
    FORGOT_PASSWORD_MESSAGE,
    INVALID_RESET_CODE_MESSAGE,
    requestPasswordReset,
    resetPassword,
    startPasswordResetRequest,
    type PasswordResetDeps,
    type PasswordResetRow,
} from "@/services/passwordResetFlow";

const TEN_MINUTES = 10 * 60 * 1000;
const START = new Date("2026-10-04T03:00:00.000Z");

type StoredUser = { id: string; email: string; password: string | null; googleId: string | null };

function createFakeDeps(overrides: Partial<PasswordResetDeps> = {}) {
    const resetRows = new Map<string, PasswordResetRow>();
    const users: StoredUser[] = [
        { id: "u-password", email: "juana@example.com", password: "hashed:OldPass1!", googleId: null },
        { id: "u-google", email: "google.only@example.com", password: null, googleId: "g-123" },
        { id: "u-both", email: "both@example.com", password: "hashed:BothPass1!", googleId: "g-456" },
    ];
    const sentEmails: { to: string; code: string; expiryMinutes: number }[] = [];
    const passwordUpdates: { userId: string; passwordHash: string }[] = [];
    const passwordChangedUserIds: string[] = [];
    let clock = START;

    const deps: PasswordResetDeps = {
        resetStore: {
            async findByEmail(email) {
                const row = resetRows.get(email);
                return row ? { ...row } : null;
            },
            async upsert(row) {
                resetRows.set(row.email, { ...row });
            },
            async incrementAttempts(email) {
                const row = resetRows.get(email);
                if (row) row.attempts += 1;
            },
            async consume(email) {
                return resetRows.delete(email);
            },
        },
        userStore: {
            async findByEmail(email) {
                const user = users.find((u) => u.email === email);
                return user ? { id: user.id, hasPassword: user.password !== null } : null;
            },
            async updatePassword(userId, passwordHash) {
                passwordUpdates.push({ userId, passwordHash });
                const user = users.find((u) => u.id === userId)!;
                user.password = passwordHash;
            },
        },
        // Reversible fake "hash" so compareHash can check equality without
        // real bcrypt; stored values are still never the plain input.
        hash: async (value) => `hashed:${value}`,
        compareHash: async (value, hash) => `hashed:${value}` === hash,
        async sendResetEmail(to, code, expiryMinutes) {
            sentEmails.push({ to, code, expiryMinutes });
        },
        onPasswordChanged(userId) {
            passwordChangedUserIds.push(userId);
        },
        now: () => clock,
        config: DEFAULT_OTP_CONFIG,
        ...overrides,
    };

    return {
        deps,
        resetRows,
        users,
        sentEmails,
        passwordUpdates,
        passwordChangedUserIds,
        advanceClock(ms: number) {
            clock = new Date(clock.getTime() + ms);
        },
        lastCode() {
            return sentEmails[sentEmails.length - 1].code;
        },
    };
}

function wrongCodeFor(code: string): string {
    return code === "000000" ? "111111" : "000000";
}

async function rejectsWithStatus(promise: Promise<unknown>, statusCode: number, message?: string) {
    await assert.rejects(promise, (err: unknown) => {
        assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
        assert.equal(err.statusCode, statusCode);
        if (message !== undefined) assert.equal(err.message, message);
        return true;
    });
}

function captureConsole(t: TestContext) {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
        t.mock.method(console, method, (...args: unknown[]) => {
            lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a))).join(" "));
        });
    }
    return lines;
}

// --- forgot-password: identical response for every case ------------------

test("forgot-password emails a 6-digit code to a password account and stores only its hash", async () => {
    const { deps, resetRows, sentEmails } = createFakeDeps();

    await requestPasswordReset({ email: " Juana@Example.com " }, deps);

    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "juana@example.com");
    assert.match(sentEmails[0].code, /^\d{6}$/);
    assert.equal(sentEmails[0].expiryMinutes, 10);

    const row = resetRows.get("juana@example.com")!;
    assert.equal(row.attempts, 0);
    assert.equal(row.otpHash, `hashed:${sentEmails[0].code}`);
    assert.notEqual(row.otpHash, sentEmails[0].code, "the plain code must never be stored");
    assert.equal(row.otpExpiresAt.getTime() - START.getTime(), TEN_MINUTES);
});

test("forgot-password returns the same response for a password account, an unknown email and a Google-only account", async () => {
    const { deps, sentEmails, resetRows } = createFakeDeps();

    const forReal = await requestPasswordReset({ email: "juana@example.com" }, deps);
    const forUnknown = await requestPasswordReset({ email: "nobody@example.com" }, deps);
    const forGoogleOnly = await requestPasswordReset({ email: "google.only@example.com" }, deps);

    assert.deepEqual(forUnknown, forReal);
    assert.deepEqual(forGoogleOnly, forReal);
    assert.equal(forReal.message, FORGOT_PASSWORD_MESSAGE);

    // Only the eligible account actually got a code.
    assert.deepEqual(sentEmails.map((e) => e.to), ["juana@example.com"]);
    assert.deepEqual([...resetRows.keys()], ["juana@example.com"]);
});

test("forgot-password never sends a code to a Google-only account, but does to an account with both", async () => {
    const { deps, sentEmails } = createFakeDeps();

    await requestPasswordReset({ email: "google.only@example.com" }, deps);
    await requestPasswordReset({ email: "both@example.com" }, deps);

    assert.deepEqual(sentEmails.map((e) => e.to), ["both@example.com"]);
});

test("forgot-password never returns the code", async () => {
    const { deps, lastCode } = createFakeDeps();
    const response = await requestPasswordReset({ email: "juana@example.com" }, deps);
    assert.ok(!JSON.stringify(response).includes(lastCode()));
});

test("forgot-password generates codes with crypto, never Math.random", async (t) => {
    const mathRandom = t.mock.method(Math, "random");
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
        const { deps, lastCode } = createFakeDeps();
        await requestPasswordReset({ email: "juana@example.com" }, deps);
        assert.match(lastCode(), /^\d{6}$/);
        codes.add(lastCode());
    }
    assert.equal(mathRandom.mock.callCount(), 0);
    assert.ok(codes.size > 1, "codes must vary between requests");
});

test("forgot-password enforces the 60-second resend cooldown silently, with the same response", async () => {
    const { deps, sentEmails, advanceClock } = createFakeDeps();
    const first = await requestPasswordReset({ email: "juana@example.com" }, deps);

    advanceClock(30_000);
    const during = await requestPasswordReset({ email: "juana@example.com" }, deps);
    assert.deepEqual(during, first, "no 429 -- that would reveal the account exists");
    assert.equal(sentEmails.length, 1, "no email may be sent during the cooldown");

    advanceClock(30_000);
    await requestPasswordReset({ email: "juana@example.com" }, deps);
    assert.equal(sentEmails.length, 2);
});

test("a new code replaces the old one and resets attempts", async () => {
    const { deps, resetRows, advanceClock, lastCode } = createFakeDeps();
    await requestPasswordReset({ email: "juana@example.com" }, deps);
    const oldCode = lastCode();
    await assert.rejects(resetPassword({ email: "juana@example.com", code: wrongCodeFor(oldCode), newPassword: "NewPass1!" }, deps));
    assert.equal(resetRows.get("juana@example.com")!.attempts, 1);

    let newCode = oldCode;
    while (newCode === oldCode) {
        advanceClock(60_000);
        await requestPasswordReset({ email: "juana@example.com" }, deps);
        newCode = lastCode();
    }

    assert.equal(resetRows.get("juana@example.com")!.attempts, 0);
    await rejectsWithStatus(resetPassword({ email: "juana@example.com", code: oldCode, newPassword: "NewPass1!" }, deps), 400);
    await resetPassword({ email: "juana@example.com", code: newCode, newPassword: "NewPass1!" }, deps);
});

test("a failed email send keeps the generic response, saves nothing, logs no code", async (t) => {
    const lines = captureConsole(t);
    let attempted = "";
    const { deps, resetRows } = createFakeDeps({
        async sendResetEmail(_to, code) {
            attempted = code;
            throw new AppError("Couldn't send the verification email. Please try again.", 502);
        },
    });

    const response = await requestPasswordReset({ email: "juana@example.com" }, deps);

    assert.equal(response.message, FORGOT_PASSWORD_MESSAGE);
    assert.equal(resetRows.size, 0, "a code that never arrived must not be stored");
    assert.ok(attempted.length === 6);
    assert.ok(!lines.some((line) => line.includes(attempted)), "the code must never be logged");
});

test("a failed resend leaves the previous code usable", async () => {
    let fail = false;
    const sent: string[] = [];
    const { deps, advanceClock } = createFakeDeps({
        async sendResetEmail(_to, code) {
            if (fail) throw new AppError("send failed", 502);
            sent.push(code);
        },
    });
    await requestPasswordReset({ email: "juana@example.com" }, deps);

    advanceClock(60_000);
    fail = true;
    await requestPasswordReset({ email: "juana@example.com" }, deps);

    await resetPassword({ email: "juana@example.com", code: sent[0], newPassword: "NewPass1!" }, deps);
});

test("forgot-password never logs the code", async (t) => {
    const lines = captureConsole(t);
    const { deps, lastCode } = createFakeDeps();
    await requestPasswordReset({ email: "juana@example.com" }, deps);
    assert.ok(!lines.some((line) => line.includes(lastCode())));
});

// --- reset-password ----------------------------------------------------------

test("the correct code resets the password, stores only its hash, and consumes the code", async () => {
    const { deps, users, resetRows, passwordUpdates, lastCode } = createFakeDeps();
    await requestPasswordReset({ email: "juana@example.com" }, deps);

    const result = await resetPassword({ email: "JUANA@example.com", code: lastCode(), newPassword: "NewPass1!" }, deps);

    assert.deepEqual(result, { message: "Your password has been reset. You can now log in." });
    assert.equal(passwordUpdates.length, 1);
    assert.equal(passwordUpdates[0].userId, "u-password");
    const stored = users.find((u) => u.id === "u-password")!.password;
    assert.equal(stored, "hashed:NewPass1!");
    assert.notEqual(stored, "NewPass1!", "the plain password must never be stored");
    assert.equal(resetRows.size, 0);
});

test("a used code cannot be used again", async () => {
    const { deps, passwordUpdates, lastCode } = createFakeDeps();
    await requestPasswordReset({ email: "juana@example.com" }, deps);
    const code = lastCode();

    await resetPassword({ email: "juana@example.com", code, newPassword: "NewPass1!" }, deps);
    await rejectsWithStatus(
        resetPassword({ email: "juana@example.com", code, newPassword: "Other1!pw" }, deps),
        400,
        INVALID_RESET_CODE_MESSAGE,
    );
    assert.equal(passwordUpdates.length, 1);
});

test("two simultaneous resets with the correct code succeed only once", async () => {
    const { deps, passwordUpdates, lastCode } = createFakeDeps();
    await requestPasswordReset({ email: "juana@example.com" }, deps);
    const code = lastCode();

    const results = await Promise.allSettled([
        resetPassword({ email: "juana@example.com", code, newPassword: "NewPass1!" }, deps),
        resetPassword({ email: "juana@example.com", code, newPassword: "Other1!pw" }, deps),
    ]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(passwordUpdates.length, 1);
});

test("an incorrect code is rejected and counts an attempt", async () => {
    const { deps, resetRows, passwordUpdates, lastCode } = createFakeDeps();
    await requestPasswordReset({ email: "juana@example.com" }, deps);

    await rejectsWithStatus(
        resetPassword({ email: "juana@example.com", code: wrongCodeFor(lastCode()), newPassword: "NewPass1!" }, deps),
        400,
        INVALID_RESET_CODE_MESSAGE,
    );
    assert.equal(resetRows.get("juana@example.com")!.attempts, 1);
    assert.equal(passwordUpdates.length, 0);
});

test("the 5th wrong attempt invalidates the code -- even the correct code then fails", async () => {
    const { deps, resetRows, passwordUpdates, lastCode } = createFakeDeps();
    await requestPasswordReset({ email: "juana@example.com" }, deps);
    const real = lastCode();

    for (let i = 0; i < 5; i++) {
        await rejectsWithStatus(
            resetPassword({ email: "juana@example.com", code: wrongCodeFor(real), newPassword: "NewPass1!" }, deps),
            400,
            INVALID_RESET_CODE_MESSAGE,
        );
    }
    assert.equal(resetRows.size, 0, "the code is deleted once attempts are exhausted");
    await rejectsWithStatus(
        resetPassword({ email: "juana@example.com", code: real, newPassword: "NewPass1!" }, deps),
        400,
        INVALID_RESET_CODE_MESSAGE,
    );
    assert.equal(passwordUpdates.length, 0);
});

test("an expired code is rejected with the same generic error and cannot change the password", async () => {
    const { deps, passwordUpdates, advanceClock, lastCode } = createFakeDeps();
    await requestPasswordReset({ email: "juana@example.com" }, deps);
    advanceClock(TEN_MINUTES + 1);

    await rejectsWithStatus(
        resetPassword({ email: "juana@example.com", code: lastCode(), newPassword: "NewPass1!" }, deps),
        400,
        INVALID_RESET_CODE_MESSAGE,
    );
    assert.equal(passwordUpdates.length, 0);
});

test("a nonexistent account cannot have its password reset, with the same error as a wrong code", async () => {
    const { deps, passwordUpdates } = createFakeDeps();
    await requestPasswordReset({ email: "nobody@example.com" }, deps);

    await rejectsWithStatus(
        resetPassword({ email: "nobody@example.com", code: "123456", newPassword: "NewPass1!" }, deps),
        400,
        INVALID_RESET_CODE_MESSAGE,
    );
    assert.equal(passwordUpdates.length, 0);
});

test("a Google-only account cannot have a password set through reset", async () => {
    const { deps, passwordUpdates } = createFakeDeps();
    await requestPasswordReset({ email: "google.only@example.com" }, deps);

    await rejectsWithStatus(
        resetPassword({ email: "google.only@example.com", code: "123456", newPassword: "NewPass1!" }, deps),
        400,
        INVALID_RESET_CODE_MESSAGE,
    );
    assert.equal(passwordUpdates.length, 0);
});

test("reset never creates an account", async () => {
    const { deps, users } = createFakeDeps();
    const before = users.length;
    await assert.rejects(resetPassword({ email: "nobody@example.com", code: "123456", newPassword: "NewPass1!" }, deps));
    assert.equal(users.length, before);
});

test("reset-password never logs the code or the new password", async (t) => {
    const lines = captureConsole(t);
    const { deps, lastCode } = createFakeDeps();
    await requestPasswordReset({ email: "juana@example.com" }, deps);
    const code = lastCode();

    await assert.rejects(resetPassword({ email: "juana@example.com", code: wrongCodeFor(code), newPassword: "NewPass1!" }, deps));
    await resetPassword({ email: "juana@example.com", code, newPassword: "NewPass1!" }, deps);

    assert.ok(!lines.some((line) => line.includes(code) || line.includes("NewPass1!")));
});

test("configured OTP settings (expiry / attempts) are honoured", async () => {
    const { deps, advanceClock, lastCode } = createFakeDeps({
        config: { ...DEFAULT_OTP_CONFIG, expiryMs: 2 * 60_000, maxAttempts: 2 },
    });
    await requestPasswordReset({ email: "juana@example.com" }, deps);
    const real = lastCode();
    assert.ok(true);

    advanceClock(2 * 60_000 + 1);
    await rejectsWithStatus(resetPassword({ email: "juana@example.com", code: real, newPassword: "NewPass1!" }, deps), 400);
});

// --- forgot-password answers before any email work (timing) ---------------

// Collects scheduled tasks instead of running them, so a test can check what
// the caller got back before any lookup or email happened.
function captureSchedule() {
    const tasks: { label: string; task: () => Promise<unknown> }[] = [];
    return {
        tasks,
        schedule(label: string, task: () => Promise<unknown>) {
            tasks.push({ label, task });
        },
        async runAll() {
            for (const { task } of tasks.splice(0)) await task();
        },
    };
}

test("forgot-password answers before any lookup or email, identically for every kind of email", async () => {
    // An email provider that never answers: the response must not wait on it.
    const { deps, sentEmails } = createFakeDeps({ sendResetEmail: () => new Promise<void>(() => {}) });
    const { tasks, schedule } = captureSchedule();

    const responses = ["juana@example.com", "nobody@example.com", "google.only@example.com"].map((email) =>
        startPasswordResetRequest({ email }, deps, schedule)
    );

    for (const response of responses) {
        assert.deepEqual(response, { message: FORGOT_PASSWORD_MESSAGE, resendCooldownSeconds: 60 });
    }
    assert.equal(tasks.length, 3, "every request schedules the same background task");
    assert.ok(tasks.every((t) => t.label === "password reset request"), "the label never contains the email");
    assert.equal(sentEmails.length, 0, "nothing was sent before answering");
});

test("the background task emails only an eligible account, and the code works once", async () => {
    const { deps, sentEmails, lastCode } = createFakeDeps();
    const { schedule, runAll } = captureSchedule();

    startPasswordResetRequest({ email: "juana@example.com" }, deps, schedule);
    startPasswordResetRequest({ email: "nobody@example.com" }, deps, schedule);
    startPasswordResetRequest({ email: "google.only@example.com" }, deps, schedule);
    await runAll();

    assert.deepEqual(sentEmails.map((e) => e.to), ["juana@example.com"]);

    const code = lastCode();
    await resetPassword({ email: "juana@example.com", code, newPassword: "NewPass1!" }, deps);
    await rejectsWithStatus(
        resetPassword({ email: "juana@example.com", code, newPassword: "Other1!x" }, deps),
        400,
        INVALID_RESET_CODE_MESSAGE
    );
});

test("the 60-second cooldown still applies when sending in the background", async () => {
    const { deps, sentEmails, advanceClock } = createFakeDeps();
    const { schedule, runAll } = captureSchedule();

    startPasswordResetRequest({ email: "juana@example.com" }, deps, schedule);
    await runAll();
    advanceClock(30_000);
    startPasswordResetRequest({ email: "juana@example.com" }, deps, schedule);
    await runAll();
    assert.equal(sentEmails.length, 1, "a second request inside the cooldown sends nothing");

    advanceClock(30_001);
    startPasswordResetRequest({ email: "juana@example.com" }, deps, schedule);
    await runAll();
    assert.equal(sentEmails.length, 2, "after the cooldown a new code is sent");
});

test("a failed background send leaves no code behind and never surfaces the code", async (t) => {
    const lines = captureConsole(t);
    const { deps, resetRows } = createFakeDeps({
        sendResetEmail: async () => {
            throw new Error("provider down");
        },
    });
    const { schedule, runAll } = captureSchedule();

    const response = startPasswordResetRequest({ email: "juana@example.com" }, deps, schedule);
    assert.equal(response.message, FORGOT_PASSWORD_MESSAGE);

    await runAll(); // must not throw
    assert.equal(resetRows.size, 0, "no code is saved when the email didn't go out");
    assert.ok(lines.every((line) => !/\b\d{6}\b/.test(line)), "no 6-digit code is ever logged");
});
