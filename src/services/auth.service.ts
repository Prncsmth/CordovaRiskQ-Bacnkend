import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { verifiedGoogleEmail } from "@/services/accountEmail";
import { issueSessionToken } from "@/services/sessionAuth";
import { emitAdminActivity } from "@/realtime/emit";
import { assertPortalAllowed } from "@/services/loginPortal";

const googleClient = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);

const normalizeEmail = (email: string) => email.trim().toLowerCase();

// The email/password check both logins share. Which portal the account may
// use is decided afterwards, by the caller, so a refusal only ever reaches
// someone who already knows the password.
async function verifyPasswordCredentials(email: string, password: string) {
    const normalizedEmail = normalizeEmail(email);

    const user = await prisma.user.findFirst({
        where: {
            email: {
                equals: normalizedEmail,
                mode: "insensitive",
            },
        },
    });
    if (!user) throw new AppError("Invalid email or password", 401);

    if (!user.password) {
        // Account was created via Google and has no password set.
        throw new AppError(
            "This account uses Google Sign-In. Please log in with Google.",
            401
        );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new AppError("Invalid email or password", 401);

    return user;
}

function sessionUser(user: { id: string; email: string; name: string | null; role: string; isOnDuty: boolean }) {
    return { id: user.id, email: user.email, name: user.name, role: user.role, isOnDuty: user.isOnDuty };
}

// Email/password accounts are created only through the 6-digit email code
// flow (pendingRegistration.service.ts) -- there is intentionally no direct
// register method here.
export const authService = {
    // The mobile app's login. Admin accounts are refused here -- they sign
    // in only through the dashboard's adminLogin below.
    async login(email: string, password: string) {
        const user = await verifyPasswordCredentials(email, password);
        assertPortalAllowed(user.role, "app");

        const token = issueSessionToken(user);
        return { user: sessionUser(user), token };
    },

    // The admin dashboard's login. Anyone but an admin gets the same 401 as
    // a wrong password.
    async adminLogin(email: string, password: string) {
        const user = await verifyPasswordCredentials(email, password);
        assertPortalAllowed(user.role, "admin");

        const token = issueSessionToken(user);
        return { user: sessionUser(user), token };
    },

    async loginWithGoogle(idToken: string) {
        // Verifies the token was genuinely issued by Google for our app,
        // and hasn't been tampered with or expired.
        let payload;
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken,
                audience: process.env.GOOGLE_WEB_CLIENT_ID,
            });
            payload = ticket.getPayload();
        } catch {
            throw new AppError("Invalid Google token", 401);
        }

        // Only an email Google has verified may find, link or create an
        // account -- see accountEmail.ts.
        const normalizedEmail = verifiedGoogleEmail(payload);
        if (!payload || !normalizedEmail) {
            throw new AppError("Invalid Google token", 401);
        }

        const { name, sub: googleId } = payload;

        // Find by googleId first (returning Google user), then by email
        // (existing password account signing in with Google for the first
        // time). Linking by email is safe because an account's email can't
        // be changed after it was verified at sign-up (accountEmail.ts).
        // Google sign-in is mobile-app only, so an admin is refused -- before
        // the link below, so an admin account never gains a Google login.
        let user = await prisma.user.findUnique({ where: { googleId } });
        if (user) assertPortalAllowed(user.role, "app");
        let isNewUser = false;

        if (!user) {
            user = await prisma.user.findFirst({
                where: {
                    email: {
                        equals: normalizedEmail,
                        mode: "insensitive",
                    },
                },
            });

            if (user) {
                assertPortalAllowed(user.role, "app");
                // Link this Google account to their existing email/password account.
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: { googleId },
                });
            } else {
                // Brand new user, Google-only, no password.
                user = await prisma.user.create({
                    data: { email: normalizedEmail, name, googleId },
                });
                isNewUser = true;
                emitAdminActivity({
                    type: "user_registered",
                    title: "New user registered",
                    detail: user.name ?? user.email,
                    occurredAt: user.createdAt.toISOString(),
                });
            }
        }

        const token = issueSessionToken(user);
        return { user: sessionUser(user), token, isNewUser };
    },
};
