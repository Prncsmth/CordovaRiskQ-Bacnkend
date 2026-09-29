// src/services/email.service.ts
import { Resend } from "resend";
import { AppError } from "@/utils/AppError";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.EMAIL_FROM ?? "Cordova RiskQ <onboarding@resend.dev>";

export async function sendOtpEmail(to: string, code: string): Promise<void> {
    const { error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to,
        subject: "Your Cordova RiskQ verification code",
        text: `Your verification code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    });

    if (error) {
        // The SDK resolves { data, error } instead of rejecting on a failed
        // send -- without this check, a bad API key, a Resend outage, or a
        // bounced address would silently look like success to the caller.
        throw new AppError("Couldn't send the verification email. Please try again.", 502);
    }
}
