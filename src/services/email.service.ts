// src/services/email.service.ts
// Sends CORDOVA RISKQ's registration OTP via Resend's HTTPS API.
//
// Previously used raw SMTP (nodemailer + Gmail), but on Render that SMTP
// connection to smtp.gmail.com hung indefinitely instead of failing --
// Gmail silently blackholes/throttles SMTP-AUTH from unfamiliar
// cloud-datacenter IPs. An HTTPS API call doesn't have that failure mode,
// and this exact Resend integration was already proven working before the
// SMTP switch. Needs RESEND_API_KEY (and optionally EMAIL_FROM) set in the
// environment -- never logged.
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
let client: ResendClient | null = null;

function getClient(): ResendClient {
    if (!client) {
        client = new Resend(process.env.RESEND_API_KEY) as unknown as ResendClient;
    }
    return client;
}

export async function sendOtpEmail(
    to: string,
    code: string,
    expiryMinutes: number,
    // Injectable for tests; defaults to the real Resend client.
    deps: { client: ResendClient; from: string } | null = null,
): Promise<void> {
    const resend = deps?.client ?? getClient();
    const from = deps?.from ?? process.env.EMAIL_FROM ?? "CORDOVA RISKQ <onboarding@resend.dev>";

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
        // Log only the error message, never the code or recipient.
        console.error("Verification email send failed", { message: error.message });
        throw new AppError("Couldn't send the verification email. Please try again.", 502);
    }
}
