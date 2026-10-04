// Rules that keep an account's email trustworthy as its login identity.
//
// The email is fixed once the account exists: it was proven either by the
// 6-digit code at registration or by Google at Google sign-up. Letting
// Edit Profile change it (unverified) allowed an account takeover: set your
// own account's email to someone else's Gmail, and when that person first
// used "Sign in with Google", loginWithGoogle linked their Google identity
// to your account by matching email. Pure so it's unit-tested without a
// database.
import { AppError } from "@/utils/AppError";

export const EMAIL_CHANGE_NOT_ALLOWED_MESSAGE = "Your email address can't be changed.";

const normalize = (email: string) => email.trim().toLowerCase();

// PUT /users/me may still send the email (older app versions always did) --
// only an actual change is refused.
export function assertEmailUnchanged(currentEmail: string, requestedEmail: string | undefined): void {
    if (requestedEmail === undefined) return;
    if (normalize(requestedEmail) !== normalize(currentEmail)) {
        throw new AppError(EMAIL_CHANGE_NOT_ALLOWED_MESSAGE, 403);
    }
}

// The email from a verified Google ID token, or null when Google hasn't
// verified it -- such an email must never be used to find, link or create
// an account.
export function verifiedGoogleEmail(
    payload: { email?: string; email_verified?: boolean } | undefined
): string | null {
    if (!payload?.email || payload.email_verified !== true) return null;
    return normalize(payload.email);
}
