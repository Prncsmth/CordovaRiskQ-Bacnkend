// src/services/email.service.ts
// Sends CORDOVA RISKQ's registration OTP over HTTPS -- never raw SMTP.
// Render's free tier blocks outbound SMTP ports 25/465/587, which is why a
// prior Gmail/nodemailer version hung indefinitely instead of failing.
//
// Two providers are supported behind EMAIL_PROVIDER, both HTTPS APIs so
// neither has that hang:
//   - "resend" (default): the production provider. Needs RESEND_API_KEY.
//     Its sandbox mode (no verified domain) only ever delivers to the
//     account owner's own email.
//   - "mailgun": Mailgun's free sandbox domain, used for capstone testing
//     against multiple real Gmail recipients without buying a domain.
//     Needs MAILGUN_API_KEY and MAILGUN_DOMAIN. Each test recipient must be
//     added as an Authorized Recipient in the Mailgun dashboard and click
//     the confirmation email Mailgun sends them, once, before they can
//     receive anything else (a sandbox-only restriction, max 5 recipients).
// Both share EMAIL_FROM. Neither key nor code is ever logged.
import { Resend } from "resend";
import { AppError } from "@/utils/AppError";

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

function readFromAddress(fallback: string): string {
    return process.env.EMAIL_FROM?.trim() || fallback;
}

// --- Resend (default provider) ---------------------------------------

// The one method this service needs from a Resend client, so tests can pass
// a fake without any network.
export type ResendClient = {
    emails: {
        send(message: {
            from: string;
            to: string;
            subject: string;
            text: string;
        }): Promise<{ data: unknown; error: { message: string } | null }>;
    };
};

// Created on first send, not at module load: a missing RESEND_API_KEY then
// fails only the OTP request instead of crashing the whole server on boot.
let resendClient: ResendClient | null = null;

function getResendClient(): ResendClient {
    if (!resendClient) {
        resendClient = new Resend(process.env.RESEND_API_KEY) as unknown as ResendClient;
    }
    return resendClient;
}

async function sendViaResend(
    to: string,
    code: string,
    expiryMinutes: number,
    deps: { client: ResendClient; from: string } | null,
): Promise<void> {
    const resend = deps?.client ?? getResendClient();
    const from = deps?.from ?? readFromAddress("CORDOVA RISKQ <onboarding@resend.dev>");

    const { error } = await resend.emails.send({
        from,
        to,
        subject: OTP_EMAIL_SUBJECT,
        text: buildOtpEmailText(code, expiryMinutes),
    });

    if (error) {
        // The SDK resolves { data, error } instead of rejecting on a failed
        // send -- without this check, a bad API key, a Resend outage, or a
        // bounced address would silently look like success to the caller.
        console.error("Verification email send failed (resend)", { message: error.message });
        throw new AppError("Couldn't send the verification email. Please try again.", 502);
    }
}

// --- Mailgun (sandbox-domain testing provider) ------------------------

// Mailgun sends over plain HTTPS -- unaffected by Render's SMTP port block
// the way raw SMTP was. Built on Node's global fetch/FormData (available on
// this project's required Node >=20) instead of adding a Mailgun SDK.
const MAILGUN_REQUEST_TIMEOUT_MS = 10_000;

export type MailgunFetch = typeof fetch;

function mailgunConfig(): { apiKey: string; domain: string } {
    const apiKey = process.env.MAILGUN_API_KEY?.trim();
    const domain = process.env.MAILGUN_DOMAIN?.trim();
    const missing = [!apiKey && "MAILGUN_API_KEY", !domain && "MAILGUN_DOMAIN"].filter(Boolean);
    if (missing.length > 0) {
        // Names only -- never values.
        throw new AppError(`Email is not configured (${missing.join(", ")} not set)`, 500);
    }
    return { apiKey: apiKey!, domain: domain! };
}

async function sendViaMailgun(
    to: string,
    code: string,
    expiryMinutes: number,
    deps: { fetchImpl: MailgunFetch; from: string } | null,
): Promise<void> {
    const { apiKey, domain } = mailgunConfig();
    const fetchImpl = deps?.fetchImpl ?? fetch;
    const from = deps?.from ?? readFromAddress(`CORDOVA RISKQ <otp@${domain}>`);

    const form = new FormData();
    form.set("from", from);
    form.set("to", to);
    form.set("subject", OTP_EMAIL_SUBJECT);
    form.set("text", buildOtpEmailText(code, expiryMinutes));

    // Basic auth per Mailgun's API: username "api", password the API key.
    // Built here (never logged) rather than via a library helper.
    const auth = Buffer.from(`api:${apiKey}`).toString("base64");

    // So a Mailgun outage or network stall can't hang registration the way
    // the old raw-SMTP hang did -- this aborts the request instead of
    // waiting indefinitely.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAILGUN_REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetchImpl(`https://api.mailgun.net/v3/${domain}/messages`, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}` },
            body: form,
            signal: controller.signal,
        });
    } catch (err) {
        const reason =
            err instanceof Error && err.name === "AbortError"
                ? `timed out after ${MAILGUN_REQUEST_TIMEOUT_MS}ms`
                : "network error";
        console.error("Verification email send failed (mailgun)", { reason });
        throw new AppError("Couldn't send the verification email. Please try again.", 502);
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        // The response body is Mailgun's own error description (e.g. "recipient
        // not authorized") -- never the API key, which only ever appears in
        // the request we sent, never in what Mailgun sends back.
        const body = await response.text().catch(() => "");
        console.error("Verification email send failed (mailgun)", { status: response.status, body });
        throw new AppError("Couldn't send the verification email. Please try again.", 502);
    }
}

// --- Provider switch ----------------------------------------------------

export type SendOtpEmailDeps = { client: ResendClient; from: string } | { fetchImpl: MailgunFetch; from: string };

function readEmailProvider(): "resend" | "mailgun" {
    return process.env.EMAIL_PROVIDER?.trim().toLowerCase() === "mailgun" ? "mailgun" : "resend";
}

export async function sendOtpEmail(
    to: string,
    code: string,
    expiryMinutes: number,
    // Injectable for tests; defaults to the real client for whichever
    // provider EMAIL_PROVIDER selects.
    deps: SendOtpEmailDeps | null = null,
): Promise<void> {
    if (readEmailProvider() === "mailgun") {
        return sendViaMailgun(to, code, expiryMinutes, deps && "fetchImpl" in deps ? deps : null);
    }
    return sendViaResend(to, code, expiryMinutes, deps && "client" in deps ? deps : null);
}
