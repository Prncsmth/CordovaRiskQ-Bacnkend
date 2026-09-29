import assert from "node:assert/strict";
import { test } from "node:test";

import {
    requestRegistrationOtp,
    verifyRegistrationOtp,
    type PendingRegistrationRow,
    type RegistrationOtpDeps,
} from "@/services/pendingRegistrationFlow";

const TEN_MINUTES = 10 * 60 * 1000;

function createFakeDeps(overrides: Partial<RegistrationOtpDeps> = {}) {
    const pendingRows = new Map<string, PendingRegistrationRow>();
    const users = new Map<string, { id: string; email: string; name: string | null; role: string; isOnDuty: boolean; createdAt: Date }>();
    const sentEmails: { to: string; code: string }[] = [];
    const createdEvents: { id: string; email: string; name: string | null; createdAt: Date }[] = [];
    let clock = new Date("2026-09-29T03:00:00.000Z");
    let userSeq = 0;

    const deps: RegistrationOtpDeps = {
        pendingStore: {
            async findByEmail(email) {
                return pendingRows.get(email) ?? null;
            },
            async upsert(row) {
                pendingRows.set(row.email, row);
            },
            async incrementAttempts(email) {
                const row = pendingRows.get(email);
                if (row) row.attempts += 1;
            },
            async delete(email) {
                pendingRows.delete(email);
            },
        },
        userStore: {
            async findByEmail(email) {
                for (const user of users.values()) {
                    if (user.email === email) return { id: user.id };
                }
                return null;
            },
            async create(data) {
                const user = {
                    id: `user-${++userSeq}`,
                    email: data.email,
                    name: data.name,
                    role: "citizen",
                    isOnDuty: true,
                    createdAt: clock,
                };
                users.set(user.id, user);
                return user;
            },
        },
        // Fake "hash" is reversible on purpose (`hashed:${value}`) so
        // compareHash below can check equality without real bcrypt --
        // real bcrypt is exercised in Task 3's wiring, not here.
        hash: async (value) => `hashed:${value}`,
        compareHash: async (value, hash) => `hashed:${value}` === hash,
        sendOtpEmail: overrides.sendOtpEmail ?? (async (to, code) => {
            sentEmails.push({ to, code });
        }),
        now: () => clock,
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
        advanceClock(ms: number) {
            clock = new Date(clock.getTime() + ms);
        },
        setClock(date: Date) {
            clock = date;
        },
    };
}

test("requestRegistrationOtp creates a pending row and sends the code", async () => {
    const { deps, pendingRows, sentEmails } = createFakeDeps();

    await requestRegistrationOtp({ name: "Juana", email: "juana@gmail.com", password: "secret123" }, deps);

    assert.equal(pendingRows.size, 1);
    const row = pendingRows.get("juana@gmail.com")!;
    assert.equal(row.attempts, 0);
    assert.equal(row.passwordHash, "hashed:secret123");
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "juana@gmail.com");
    assert.equal(row.otpHash, `hashed:${sentEmails[0].code}`);
    assert.equal(row.otpExpiresAt.getTime(), new Date("2026-09-29T03:10:00.000Z").getTime());
});

test("requestRegistrationOtp rejects an email that already belongs to a real User", async () => {
    const { deps } = createFakeDeps();
    await deps.userStore.create({ email: "existing@gmail.com", name: "Existing", passwordHash: "x" });

    await assert.rejects(
        () => requestRegistrationOtp({ email: "existing@gmail.com", password: "secret123" }, deps),
        (err: any) => {
            assert.equal(err.statusCode, 409);
            return true;
        },
    );
});

test("requestRegistrationOtp blocks a resend within 60 seconds of the code actually being sent", async () => {
    const { deps, advanceClock } = createFakeDeps();

    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);
    advanceClock(20_000); // 20s later

    await assert.rejects(
        () => requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps),
        (err: any) => {
            assert.equal(err.statusCode, 429);
            return true;
        },
    );
});

test("requestRegistrationOtp allows a resend once 60 seconds have passed", async () => {
    const { deps, advanceClock, sentEmails } = createFakeDeps();

    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);
    advanceClock(60_000);
    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);

    assert.equal(sentEmails.length, 2);
});

test("a failed verify attempt does not itself extend the resend cooldown (the updatedAt bug from spec review)", async () => {
    const { deps, advanceClock } = createFakeDeps();

    // 3:00:00 -- code requested
    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);

    // 3:00:10 -- wrong guess
    advanceClock(10_000);
    await assert.rejects(() => verifyRegistrationOtp({ email: "juana@gmail.com", code: "000000" }, deps));

    // 3:00:20 -- resend: only 20s have passed since the code was actually
    // sent at 3:00:00, so this must still be blocked (not measured from
    // the 3:00:10 typo, which would otherwise push the block out further).
    advanceClock(10_000);
    await assert.rejects(
        () => requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps),
        (err: any) => {
            assert.equal(err.statusCode, 429);
            return true;
        },
    );

    // 3:01:00 -- exactly 60s since the ORIGINAL send: must now be allowed.
    advanceClock(40_000);
    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps); // must not throw
});

test("requestRegistrationOtp resets attempts to 0 on a resend", async () => {
    const { deps, pendingRows, advanceClock } = createFakeDeps();

    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);
    await assert.rejects(() => verifyRegistrationOtp({ email: "juana@gmail.com", code: "000000" }, deps));
    assert.equal(pendingRows.get("juana@gmail.com")!.attempts, 1);

    advanceClock(60_000);
    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);

    assert.equal(pendingRows.get("juana@gmail.com")!.attempts, 0);
});

test("requestRegistrationOtp allows an immediate resend once the previous code has expired", async () => {
    const { deps, advanceClock } = createFakeDeps();

    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);
    advanceClock(TEN_MINUTES + 1000); // just past expiry -- also long past the 60s cooldown

    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps); // must not throw
});

test("requestRegistrationOtp propagates a send failure without leaving a false-success response", async () => {
    const { deps, pendingRows } = createFakeDeps({
        sendOtpEmail: async () => {
            throw Object.assign(new Error("send failed"), { statusCode: 502 });
        },
    });

    await assert.rejects(
        () => requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps),
        (err: any) => {
            assert.equal(err.statusCode, 502);
            return true;
        },
    );

    // A first-ever send failure must not leave a pending row behind --
    // otherwise a cooldown/otpHash would exist for a code that was never
    // delivered.
    assert.equal(pendingRows.size, 0);
});

test("requestRegistrationOtp allows an immediate retry after a send failure on a fresh registration (no false cooldown)", async () => {
    let calls = 0;
    const { deps, pendingRows, sentEmails } = createFakeDeps({
        sendOtpEmail: async (to, code) => {
            calls += 1;
            if (calls === 1) {
                throw Object.assign(new Error("send failed"), { statusCode: 502 });
            }
            sentEmails.push({ to, code });
        },
    });

    await assert.rejects(
        () => requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps),
        (err: any) => {
            assert.equal(err.statusCode, 502);
            return true;
        },
    );

    // Immediate retry -- must not be rejected with 429, since no cooldown
    // was ever established (the failed send never persisted a row).
    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);

    assert.equal(calls, 2);
    assert.equal(pendingRows.size, 1);
});

test("requestRegistrationOtp leaves the original pending row untouched when a resend's send fails", async () => {
    let calls = 0;
    const { deps, pendingRows, advanceClock } = createFakeDeps({
        sendOtpEmail: async (to, code) => {
            calls += 1;
            if (calls === 1) {
                return; // initial request succeeds
            }
            throw Object.assign(new Error("send failed"), { statusCode: 502 });
        },
    });

    // Initial successful request establishes a valid, unexpired pending row.
    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);
    const original = { ...pendingRows.get("juana@gmail.com")! };

    // Past the cooldown, so a resend is attempted -- but its send fails.
    advanceClock(60_000);
    await assert.rejects(
        () => requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps),
        (err: any) => {
            assert.equal(err.statusCode, 502);
            return true;
        },
    );

    // The original row (old code, old cooldown timing) must remain intact --
    // the failed resend must not silently overwrite it.
    const after = pendingRows.get("juana@gmail.com")!;
    assert.equal(after.otpHash, original.otpHash);
    assert.equal(after.otpExpiresAt.getTime(), original.otpExpiresAt.getTime());
});

test("verifyRegistrationOtp creates the User and deletes the pending row on a correct code", async () => {
    const { deps, pendingRows, sentEmails, createdEvents } = createFakeDeps();

    await requestRegistrationOtp({ name: "Juana", email: "juana@gmail.com", password: "secret123" }, deps);
    const code = sentEmails[0].code;

    const user = await verifyRegistrationOtp({ email: "juana@gmail.com", code }, deps);

    assert.equal(user.email, "juana@gmail.com");
    assert.equal(user.name, "Juana");
    assert.equal(pendingRows.has("juana@gmail.com"), false);
    assert.equal(createdEvents.length, 1);
});

test("verifyRegistrationOtp rejects when no pending registration exists", async () => {
    const { deps } = createFakeDeps();

    await assert.rejects(
        () => verifyRegistrationOtp({ email: "nobody@gmail.com", code: "123456" }, deps),
        (err: any) => {
            assert.equal(err.statusCode, 404);
            return true;
        },
    );
});

test("verifyRegistrationOtp rejects an expired code", async () => {
    const { deps, advanceClock, sentEmails } = createFakeDeps();

    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);
    const code = sentEmails[0].code;
    advanceClock(TEN_MINUTES + 1000);

    await assert.rejects(
        () => verifyRegistrationOtp({ email: "juana@gmail.com", code }, deps),
        (err: any) => {
            assert.equal(err.statusCode, 410);
            return true;
        },
    );
});

test("verifyRegistrationOtp rejects a wrong code and increments attempts", async () => {
    const { deps, pendingRows } = createFakeDeps();

    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);

    await assert.rejects(
        () => verifyRegistrationOtp({ email: "juana@gmail.com", code: "000000" }, deps),
        (err: any) => {
            assert.equal(err.statusCode, 401);
            return true;
        },
    );
    assert.equal(pendingRows.get("juana@gmail.com")!.attempts, 1);
});

test("verifyRegistrationOtp rejects after 5 attempts even with time remaining", async () => {
    const { deps, sentEmails } = createFakeDeps();

    await requestRegistrationOtp({ email: "juana@gmail.com", password: "secret123" }, deps);
    const realCode = sentEmails[0].code;

    for (let i = 0; i < 5; i++) {
        await assert.rejects(() => verifyRegistrationOtp({ email: "juana@gmail.com", code: "000000" }, deps));
    }

    // Even the correct code is now rejected -- attempts are exhausted.
    await assert.rejects(
        () => verifyRegistrationOtp({ email: "juana@gmail.com", code: realCode }, deps),
        (err: any) => {
            assert.equal(err.statusCode, 429);
            return true;
        },
    );
});
