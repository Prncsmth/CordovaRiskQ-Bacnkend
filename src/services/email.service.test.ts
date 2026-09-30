import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "@/utils/AppError";
import {
    OTP_EMAIL_SUBJECT,
    buildOtpEmailText,
    readSmtpConfig,
    sendOtpEmail,
    type EmailMessage,
} from "@/services/email.service";

test("the OTP email has the CORDOVA RISKQ subject and states the code and its expiry", () => {
    assert.equal(OTP_EMAIL_SUBJECT, "Your CORDOVA RISKQ Verification Code");
    const text = buildOtpEmailText("048213", 10);
    assert.match(text, /Your CORDOVA RISKQ verification code is:/);
    assert.match(text, /^048213$/m);
    assert.match(text, /expires in 10 minutes/);
    assert.match(text, /If you did not request this code, you can ignore this email\./);
});

test("readSmtpConfig reads the SMTP_* variables with Gmail defaults", () => {
    const config = readSmtpConfig({ SMTP_USER: "cordova.riskq@gmail.com", SMTP_PASS: "app-password" });
    assert.equal(config.host, "smtp.gmail.com");
    assert.equal(config.port, 465);
    assert.equal(config.secure, true);
    assert.equal(config.from, '"CORDOVA RISKQ" <cordova.riskq@gmail.com>');
});

test("readSmtpConfig honours explicit host, port, SMTP_SECURE=false and EMAIL_FROM", () => {
    const config = readSmtpConfig({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "2525",
        SMTP_SECURE: "false",
        SMTP_USER: "u@example.com",
        SMTP_PASS: "p",
        EMAIL_FROM: "Cordova <u@example.com>",
    });
    assert.deepEqual(
        { host: config.host, port: config.port, secure: config.secure, from: config.from },
        { host: "smtp.example.com", port: 2525, secure: false, from: "Cordova <u@example.com>" },
    );
    assert.equal(readSmtpConfig({ SMTP_USER: "u", SMTP_PASS: "p", SMTP_SECURE: "false" }).port, 587);
});

test("readSmtpConfig fails with an AppError naming (never revealing) the missing settings", () => {
    assert.throws(
        () => readSmtpConfig({ SMTP_USER: "u@example.com" }),
        (err: unknown) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.statusCode, 500);
            assert.match(err.message, /SMTP_PASS/);
            assert.doesNotMatch(err.message, /u@example\.com/);
            return true;
        },
    );
});

test("email.service can be imported without SMTP settings, and sending then fails with an AppError", async () => {
    const saved = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    try {
        await assert.rejects(sendOtpEmail("someone@example.com", "123456", 10), (err: unknown) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.statusCode, 500);
            return true;
        });
    } finally {
        if (saved.user !== undefined) process.env.SMTP_USER = saved.user;
        if (saved.pass !== undefined) process.env.SMTP_PASS = saved.pass;
    }
});

test("sendOtpEmail sends exactly one message to the recipient", async () => {
    const sent: EmailMessage[] = [];
    await sendOtpEmail("juana@example.com", "048213", 10, {
        transport: { sendMail: async (m) => void sent.push(m) },
        from: '"CORDOVA RISKQ" <cordova.riskq@gmail.com>',
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "juana@example.com");
    assert.equal(sent[0].subject, OTP_EMAIL_SUBJECT);
    assert.equal(sent[0].from, '"CORDOVA RISKQ" <cordova.riskq@gmail.com>');
    assert.match(sent[0].text, /048213/);
});

test("a send failure becomes a 502 AppError and logs neither the code nor the SMTP password", async (t) => {
    const logged: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => {
        logged.push(JSON.stringify(args));
    });
    const failure = Object.assign(new Error("Invalid login: 535 ... app-password ... 048213"), {
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH PLAIN",
    });

    await assert.rejects(
        sendOtpEmail("juana@example.com", "048213", 10, {
            transport: {
                sendMail: async () => {
                    throw failure;
                },
            },
            from: "x",
        }),
        (err: unknown) => err instanceof AppError && err.statusCode === 502,
    );

    const output = logged.join("\n");
    assert.match(output, /EAUTH/);
    assert.doesNotMatch(output, /048213/);
    assert.doesNotMatch(output, /app-password/);
});
