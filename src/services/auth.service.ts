import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { signToken } from "@/utils/jwt";

const googleClient = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);

export const authService = {
    async register(email: string, password: string, name?: string) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) throw new AppError("Email already registered", 409);

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: { email, password: hashedPassword, name },
        });

        const token = signToken({ userId: user.id });
        return {
            user: { id: user.id, email: user.email, name: user.name },
            token,
        };
    },

    async login(email: string, password: string) {
        const user = await prisma.user.findUnique({ where: { email } });
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

        const token = signToken({ userId: user.id });
        return {
            user: { id: user.id, email: user.email, name: user.name },
            token,
        };
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

        if (!payload?.email) {
            throw new AppError("Invalid Google token", 401);
        }

        const { email, name, sub: googleId } = payload;

        // Find by googleId first (returning Google user), then by email
        // (existing password account signing in with Google for the first time).
        let user = await prisma.user.findUnique({ where: { googleId } });
        let isNewUser = false;

        if (!user) {
            user = await prisma.user.findUnique({ where: { email } });

            if (user) {
                // Link this Google account to their existing email/password account.
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: { googleId },
                });
            } else {
                // Brand new user, Google-only, no password.
                user = await prisma.user.create({
                    data: { email, name, googleId },
                });
                isNewUser = true;
            }
        }

        const token = signToken({ userId: user.id });
        return {
            user: { id: user.id, email: user.email, name: user.name },
            token,
            isNewUser,
        };
    },
};
