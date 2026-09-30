// src/services/email.service.ts
// Sends CORDOVA RISKQ's registration OTP over SMTP (Gmail with an App
// Password -- no custom domain needed). All connection settings come from
// the environment:
//   SMTP_HOST (default smtp.gmail.com), SMTP_PORT, SMTP_SECURE,
//   SMTP_USER, SMTP_PASS, and optional EMAIL_FROM.
// Neither the OTP nor SMTP_PASS is ever logged.
import nodemailer from "nodemailer";
import { AppError } from "@/utils/AppError";

export type EmailMessage = { from: string; to: string; subject: string; text: string };

// The one method this service needs from a nodemailer transporter, so tests
// can pass a fake without any network.
export type EmailTransport = { sendMail(message: EmailMessage): Promise<unknown> };

export const OTP_EMAIL_SUBJECT = "Your CORDOVA RISKQ Verification Code";

export function buildOtpEmailText(code: string, expiryMinutes: number): string {
    return [
        "Your CORDOVA RISKQ verification code is:",
        "",
        code,
        "",
        `This code expires in ${expiryMinutes} minutes.`,
        "",
        "If you did not request this code, you can ignore this email.",
    ].join("\n");
}

type SmtpConfig = {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
};

export function readSmtpConfig(env: Record<string, string | undefined> = process.env): SmtpConfig {
    const user = env.SMTP_USER?.trim();
    const pass = env.SMTP_PASS?.trim();
    const missing = [!user && "SMTP_USER", !pass && "SMTP_PASS"].filter(Boolean);
    if (missing.length > 0) {
        // Names only -- never values.
        throw new AppError(`Email is not configured (${missing.join(", ")} not set)`, 500);
    }
    const secure = (env.SMTP_SECURE ?? "true").trim().toLowerCase() !== "false";
    const port = Number(env.SMTP_PORT) || (secure ? 465 : 587);
    return {
        host: env.SMTP_HOST?.trim() || "smtp.gmail.com",
        port,
        secure,
        user: user!,
        pass: pass!,
        from: env.EMAIL_FROM?.trim() || `"CORDOVA RISKQ" <${user}>`,
    };
}

// Created on first send, not at module load: a missing SMTP setting then
// fails only the OTP request instead of crashing the whole server on boot.
let transport: EmailTransport | null = null;
let fromAddress = "";

function getTransport(): EmailTransport {
    if (!transport) {
        const config = readSmtpConfig();
        transport = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: { user: config.user, pass: config.pass },
        });
        fromAddress = config.from;
    }
    return transport;
}

export async function sendOtpEmail(
    to: string,
    code: string,
    expiryMinutes: number,
    // Injectable for tests; defaults to the real SMTP transport.
    deps: { transport: EmailTransport; from: string } | null = null,
): Promise<void> {
    const mailer = deps?.transport ?? getTransport();
    const from = deps?.from ?? fromAddress;

    try {
        await mailer.sendMail({ from, to, subject: OTP_EMAIL_SUBJECT, text: buildOtpEmailText(code, expiryMinutes) });
    } catch (err) {
        // Only transport metadata -- the message/stack could echo the email
        // body, which contains the code.
        const e = err as { code?: unknown; responseCode?: unknown; command?: unknown };
        console.error("Verification email send failed", {
            code: e?.code,
            responseCode: e?.responseCode,
            command: e?.command,
        });
        throw new AppError("Couldn't send the verification email. Please try again.", 502);
    }
}
