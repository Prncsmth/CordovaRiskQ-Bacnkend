import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "@/utils/AppError";
import {
    OTP_EMAIL_SUBJECT,
    PASSWORD_RESET_EMAIL_SUBJECT,
    buildOtpEmailText,
    buildPasswordResetEmailText,
    sendOtpEmail,
    sendPasswordResetEmail,
    type ResendClient,
} from "@/services/email.service";

function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void> | void) {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) saved[key] = process.env[key];
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    return Promise.resolve(run()).finally(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

test("the OTP email has the CORDOVA RISKQ subject and states the code and its expiry", () => {
    assert.equal(OTP_EMAIL_SUBJECT, "Your CORDOVA RISKQ Verification Code");
    const text = buildOtpEmailText("048213", 10);
    assert.match(text, /Your CORDOVA RISKQ verification code is:/);
    assert.match(text, /^048213$/m);
    assert.match(text, /expires in 10 minutes/);
    assert.match(text, /If you did not request this code, you can ignore this email\./);
});

// --- Resend ------------------------------------------------------------

test("with no EMAIL_PROVIDER set, sendOtpEmail uses Resend", () =>
    withEnv({ EMAIL_PROVIDER: undefined }, async () => {
        const sent: { from: string; to: string; subject: string; text: string }[] = [];
        const fakeClient: ResendClient = {
            emails: {
                send: async (message) => {
                    sent.push(message);
                    return { data: { id: "fake" }, error: null };
                },
            },
        };

        await sendOtpEmail("juana@example.com", "048213", 10, {
            client: fakeClient,
            from: "CORDOVA RISKQ <no-reply@example.com>",
        });

        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, "juana@example.com");
        assert.equal(sent[0].subject, OTP_EMAIL_SUBJECT);
        assert.match(sent[0].text, /048213/);
    }));

test('EMAIL_PROVIDER="resend" explicitly still uses Resend', () =>
    withEnv({ EMAIL_PROVIDER: "resend" }, async () => {
        let called = false;
        const fakeClient: ResendClient = {
            emails: {
                send: async () => {
                    called = true;
                    return { data: { id: "fake" }, error: null };
                },
            },
        };
        await sendOtpEmail("juana@example.com", "048213", 10, {
            client: fakeClient,
            from: "x",
        });
        assert.equal(called, true);
    }));

test("a Resend send failure (the SDK's {data,error} contract, not a thrown error) becomes a 502 AppError and logs no code", () =>
    withEnv({ EMAIL_PROVIDER: "resend" }, async () => {
        const logged: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => void logged.push(JSON.stringify(args));
        try {
            const fakeClient: ResendClient = {
                emails: {
                    send: async () => ({ data: null, error: { message: "Invalid API key" } }),
                },
            };

            await assert.rejects(
                sendOtpEmail("juana@example.com", "048213", 10, { client: fakeClient, from: "x" }),
                (err: unknown) => err instanceof AppError && err.statusCode === 502,
            );

            const output = logged.join("\n");
            assert.match(output, /Invalid API key/);
            assert.doesNotMatch(output, /048213/);
        } finally {
            console.error = original;
        }
    }));

// --- Configuration ---------------------------------------------------------
// These fail before any Resend client is created, so they never touch the network.

test("sendOtpEmail fails with a 500 AppError naming (never revealing) missing Resend settings", () =>
    withEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: undefined, EMAIL_FROM: undefined }, async () => {
        await assert.rejects(sendOtpEmail("juana@example.com", "048213", 10), (err: unknown) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.statusCode, 500);
            assert.match(err.message, /RESEND_API_KEY/);
            assert.match(err.message, /EMAIL_FROM/);
            return true;
        });
    }));

test("a missing EMAIL_FROM fails instead of falling back to Resend's owner-only sandbox sender", () =>
    withEnv({ EMAIL_PROVIDER: undefined, RESEND_API_KEY: "re_test_key", EMAIL_FROM: undefined }, async () => {
        await assert.rejects(sendOtpEmail("juana@example.com", "048213", 10), (err: unknown) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.statusCode, 500);
            assert.match(err.message, /EMAIL_FROM/);
            assert.doesNotMatch(err.message, /re_test_key/);
            return true;
        });
    }));

test('a leftover EMAIL_PROVIDER="mailgun" fails loudly instead of sending through a removed provider', () =>
    withEnv(
        { EMAIL_PROVIDER: "mailgun", RESEND_API_KEY: "re_test_key", EMAIL_FROM: "CORDOVA RISKQ <no-reply@example.com>" },
        async () => {
            await assert.rejects(sendPasswordResetEmail("juana@example.com", "482019", 10), (err: unknown) => {
                assert.ok(err instanceof AppError);
                assert.equal(err.statusCode, 500);
                assert.match(err.message, /EMAIL_PROVIDER/);
                return true;
            });
        },
    ));

test("OTP emails go to whichever address registers, not a single fixed recipient", () =>
    withEnv({ EMAIL_PROVIDER: "resend" }, async () => {
        const recipients: string[] = [];
        const fakeClient: ResendClient = {
            emails: {
                send: async (message) => {
                    recipients.push(message.to);
                    return { data: { id: "fake" }, error: null };
                },
            },
        };
        const deps = { client: fakeClient, from: "CORDOVA RISKQ <no-reply@example.com>" };

        await sendOtpEmail("juana@gmail.com", "048213", 10, deps);
        await sendOtpEmail("pedro@gmail.com", "593104", 10, deps);

        assert.deepEqual(recipients, ["juana@gmail.com", "pedro@gmail.com"]);
    }));

// --- Password reset email ---------------------------------------------------

test("the password reset email has its own subject and states the code and its expiry", () => {
    assert.equal(PASSWORD_RESET_EMAIL_SUBJECT, "Your CORDOVA RISKQ Password Reset Code");
    const text = buildPasswordResetEmailText("482019", 10);
    assert.match(text, /password reset code is:/i);
    assert.match(text, /^482019$/m);
    assert.match(text, /expires in 10 minutes/);
    assert.match(text, /did not request a password reset/i);
});

test("sendPasswordResetEmail sends via Resend with the reset subject and code", () =>
    withEnv({ EMAIL_PROVIDER: undefined }, async () => {
        const sent: { from: string; to: string; subject: string; text: string }[] = [];
        const fakeClient: ResendClient = {
            emails: {
                send: async (message) => {
                    sent.push(message);
                    return { data: { id: "fake" }, error: null };
                },
            },
        };

        await sendPasswordResetEmail("juana@example.com", "482019", 10, { client: fakeClient, from: "x" });

        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, "juana@example.com");
        assert.equal(sent[0].subject, PASSWORD_RESET_EMAIL_SUBJECT);
        assert.match(sent[0].text, /482019/);
    }));

test("a failed password reset email becomes a 502 AppError and never logs the code", () =>
    withEnv({ EMAIL_PROVIDER: "resend" }, async () => {
        const logged: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => void logged.push(JSON.stringify(args));
        try {
            const fakeClient: ResendClient = {
                emails: { send: async () => ({ data: null, error: { message: "Invalid API key" } }) },
            };
            await assert.rejects(
                sendPasswordResetEmail("juana@example.com", "482019", 10, { client: fakeClient, from: "x" }),
                (err: unknown) => err instanceof AppError && err.statusCode === 502,
            );
            assert.doesNotMatch(logged.join("\n"), /482019/);
        } finally {
            console.error = original;
        }
    }));
