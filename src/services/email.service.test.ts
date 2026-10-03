import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "@/utils/AppError";
import {
    OTP_EMAIL_SUBJECT,
    buildOtpEmailText,
    sendOtpEmail,
    type MailgunFetch,
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

// --- Resend (default provider) -----------------------------------------

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
            from: "CORDOVA RISKQ <onboarding@resend.dev>",
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

// --- Mailgun (sandbox testing provider) ---------------------------------

test('EMAIL_PROVIDER="mailgun" sends via Mailgun\'s HTTPS API with Basic auth and form fields', () =>
    withEnv({ EMAIL_PROVIDER: "mailgun", MAILGUN_API_KEY: "test-mailgun-key", MAILGUN_DOMAIN: "sandbox123.mailgun.org" }, async () => {
        const calls: { url: string; init: RequestInit }[] = [];
        const fakeFetch: MailgunFetch = (async (url: string, init?: RequestInit) => {
            calls.push({ url, init: init! });
            return new Response(null, { status: 200 });
        }) as MailgunFetch;

        await sendOtpEmail("juana@example.com", "048213", 10, {
            fetchImpl: fakeFetch,
            from: "CORDOVA RISKQ <otp@sandbox123.mailgun.org>",
        });

        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "https://api.mailgun.net/v3/sandbox123.mailgun.org/messages");
        assert.equal(calls[0].init.method, "POST");

        const headers = calls[0].init.headers as Record<string, string>;
        assert.match(headers.Authorization, /^Basic /);
        const decoded = Buffer.from(headers.Authorization.replace("Basic ", ""), "base64").toString();
        assert.equal(decoded, "api:test-mailgun-key");

        const form = calls[0].init.body as FormData;
        assert.equal(form.get("to"), "juana@example.com");
        assert.equal(form.get("from"), "CORDOVA RISKQ <otp@sandbox123.mailgun.org>");
        assert.equal(form.get("subject"), OTP_EMAIL_SUBJECT);
        assert.match(String(form.get("text")), /048213/);
    }));

test("sendOtpEmail reads MAILGUN_DOMAIN from the environment when selecting the Mailgun provider", () =>
    withEnv({ EMAIL_PROVIDER: "mailgun", MAILGUN_API_KEY: "test-mailgun-key", MAILGUN_DOMAIN: "sandbox123.mailgun.org" }, async () => {
        const calls: string[] = [];
        const fakeFetch: MailgunFetch = (async (url: string) => {
            calls.push(url);
            return new Response(null, { status: 200 });
        }) as MailgunFetch;

        await sendOtpEmail("juana@example.com", "048213", 10, { fetchImpl: fakeFetch, from: "x" });

        assert.equal(calls[0], "https://api.mailgun.net/v3/sandbox123.mailgun.org/messages");
    }));

test("sendOtpEmail fails with a 500 AppError naming (never revealing) missing Mailgun settings", () =>
    withEnv({ EMAIL_PROVIDER: "mailgun", MAILGUN_API_KEY: undefined, MAILGUN_DOMAIN: undefined }, async () => {
        await assert.rejects(
            sendOtpEmail("juana@example.com", "048213", 10),
            (err: unknown) => {
                assert.ok(err instanceof AppError);
                assert.equal(err.statusCode, 500);
                assert.match(err.message, /MAILGUN_API_KEY/);
                assert.match(err.message, /MAILGUN_DOMAIN/);
                return true;
            },
        );
    }));

test("a non-2xx Mailgun response becomes a 502 AppError and logs the status/body but never the API key", () =>
    withEnv({ EMAIL_PROVIDER: "mailgun", MAILGUN_API_KEY: "test-mailgun-key", MAILGUN_DOMAIN: "sandbox123.mailgun.org" }, async () => {
        const logged: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => void logged.push(JSON.stringify(args));
        try {
            const fakeFetch: MailgunFetch = (async () =>
                new Response("Recipient not authorized for sandbox domain", { status: 403 })) as MailgunFetch;

            await assert.rejects(
                sendOtpEmail("juana@example.com", "048213", 10, { fetchImpl: fakeFetch, from: "x" }),
                (err: unknown) => err instanceof AppError && err.statusCode === 502,
            );

            const output = logged.join("\n");
            assert.match(output, /403/);
            assert.match(output, /not authorized/);
            assert.doesNotMatch(output, /test-mailgun-key/);
        } finally {
            console.error = original;
        }
    }));

test("a Mailgun request that times out becomes a 502 AppError and never logs the API key", () =>
    withEnv({ EMAIL_PROVIDER: "mailgun", MAILGUN_API_KEY: "test-mailgun-key", MAILGUN_DOMAIN: "sandbox123.mailgun.org" }, async () => {
        const logged: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => void logged.push(JSON.stringify(args));
        try {
            const fakeFetch: MailgunFetch = (async () => {
                const err = new Error("The operation was aborted");
                err.name = "AbortError";
                throw err;
            }) as MailgunFetch;

            await assert.rejects(
                sendOtpEmail("juana@example.com", "048213", 10, { fetchImpl: fakeFetch, from: "x" }),
                (err: unknown) => err instanceof AppError && err.statusCode === 502,
            );

            const output = logged.join("\n");
            assert.match(output, /timed out/);
            assert.doesNotMatch(output, /test-mailgun-key/);
        } finally {
            console.error = original;
        }
    }));
