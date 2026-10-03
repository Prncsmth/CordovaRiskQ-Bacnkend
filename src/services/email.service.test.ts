import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "@/utils/AppError";
import {
    OTP_EMAIL_SUBJECT,
    buildOtpEmailText,
    sendOtpEmail,
    type ResendClient,
} from "@/services/email.service";

test("the OTP email has the CORDOVA RISKQ subject and states the code and its expiry", () => {
    assert.equal(OTP_EMAIL_SUBJECT, "Your CORDOVA RISKQ Verification Code");
    const text = buildOtpEmailText("048213", 10);
    assert.match(text, /Your CORDOVA RISKQ verification code is:/);
    assert.match(text, /^048213$/m);
    assert.match(text, /expires in 10 minutes/);
    assert.match(text, /If you did not request this code, you can ignore this email\./);
});

test("sendOtpEmail sends exactly one message to the recipient", async () => {
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
    assert.equal(sent[0].from, "CORDOVA RISKQ <onboarding@resend.dev>");
    assert.match(sent[0].text, /048213/);
});

test("a send failure (the SDK's {data,error} contract, not a thrown error) becomes a 502 AppError and logs no code", async (t) => {
    const logged: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => {
        logged.push(JSON.stringify(args));
    });
    const fakeClient: ResendClient = {
        emails: {
            send: async () => ({ data: null, error: { message: "Invalid API key" } }),
        },
    };

    await assert.rejects(
        sendOtpEmail("juana@example.com", "048213", 10, {
            client: fakeClient,
            from: "x",
        }),
        (err: unknown) => err instanceof AppError && err.statusCode === 502,
    );

    const output = logged.join("\n");
    assert.match(output, /Invalid API key/);
    assert.doesNotMatch(output, /048213/);
});
