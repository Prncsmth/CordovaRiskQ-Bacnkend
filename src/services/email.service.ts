// src/services/email.service.ts
// Sends CORDOVA RISKQ's 6-digit codes (registration and password reset)
// over HTTPS -- never raw SMTP.
// Render's free tier blocks outbound SMTP ports 25/465/587, which is why a
// prior Gmail/nodemailer version hung indefinitely instead of failing.
//
// Resend is the only provider. Needs:
//   - RESEND_API_KEY
//   - EMAIL_FROM: an address on the domain verified in Resend, e.g.
//     "CORDOVA RISKQ <no-reply@your-verified-domain>". Required -- Resend's
//     unverified sandbox sender (onboarding@resend.dev) only ever delivers
//     to the account owner's own email, never to registering users.
//   - EMAIL_PROVIDER: optional; if set it must be "resend".
// Neither key nor code is ever logged.
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

export const PASSWORD_RESET_EMAIL_SUBJECT = "Your CORDOVA RISKQ Password Reset Code";

export function buildPasswordResetEmailText(code: string, expiryMinutes: number): string {
    return [
        "Your CORDOVA RISKQ password reset code is:",
        "",
        code,
        "",
        `This code expires in ${expiryMinutes} minutes.`,
        "",
        "If you did not request a password reset, you can ignore this email -- your password will not change.",
    ].join("\n");
}

// One plain-text email. The text carries the code, so it is never logged.
type EmailMessage = { to: string; subject: string; text: string };

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

export type SendOtpEmailDeps = { client: ResendClient; from: string };

// Read on every send, not at module load: a misconfiguration then fails only
// the email request instead of crashing the whole server on boot.
function readEmailConfig(): { apiKey: string; from: string } {
    const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
    if (provider && provider !== "resend") {
        throw new AppError(`Email is not configured (EMAIL_PROVIDER must be "resend")`, 500);
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    const missing = [!apiKey && "RESEND_API_KEY", !from && "EMAIL_FROM"].filter(Boolean);
    if (missing.length > 0) {
        // Names only -- never values.
        throw new AppError(`Email is not configured (${missing.join(", ")} not set)`, 500);
    }
    return { apiKey: apiKey!, from: from! };
}

let resendClient: { apiKey: string; client: ResendClient } | null = null;

function getResendClient(apiKey: string): ResendClient {
    if (resendClient?.apiKey !== apiKey) {
        resendClient = { apiKey, client: new Resend(apiKey) as unknown as ResendClient };
    }
    return resendClient.client;
}

// Shared by the registration and password-reset emails so they can never
// diverge in sender or error handling.
async function sendEmail(message: EmailMessage, deps: SendOtpEmailDeps | null): Promise<void> {
    let resend: ResendClient;
    let from: string;
    if (deps) {
        ({ client: resend, from } = deps);
    } else {
        const config = readEmailConfig();
        resend = getResendClient(config.apiKey);
        from = config.from;
    }

    const { error } = await resend.emails.send({ from, ...message });

    if (error) {
        // The SDK resolves { data, error } instead of rejecting on a failed
        // send -- without this check, a bad API key, a Resend outage, or a
        // bounced address would silently look like success to the caller.
        console.error("Verification email send failed (resend)", { message: error.message });
        throw new AppError("Couldn't send the verification email. Please try again.", 502);
    }
}

export async function sendOtpEmail(
    to: string,
    code: string,
    expiryMinutes: number,
    // Injectable for tests; defaults to the real Resend client.
    deps: SendOtpEmailDeps | null = null,
): Promise<void> {
    return sendEmail({ to, subject: OTP_EMAIL_SUBJECT, text: buildOtpEmailText(code, expiryMinutes) }, deps);
}

export async function sendPasswordResetEmail(
    to: string,
    code: string,
    expiryMinutes: number,
    deps: SendOtpEmailDeps | null = null,
): Promise<void> {
    return sendEmail(
        { to, subject: PASSWORD_RESET_EMAIL_SUBJECT, text: buildPasswordResetEmailText(code, expiryMinutes) },
        deps,
    );
}
