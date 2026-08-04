import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

export const userService = {
    async getById(userId: string) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new AppError("User not found", 404);

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            mobile: user.mobile,
        };
    },

    async updateProfile(
        userId: string,
        data: { name?: string; email: string; mobile?: string }
    ) {
        const existing = await prisma.user.findUnique({
            where: { email: data.email },
        });
        if (existing && existing.id !== userId) {
            throw new AppError("Email already in use", 409);
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: {
                name: data.name,
                email: data.email,
                mobile: data.mobile,
            },
        });

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            mobile: user.mobile,
        };
    },

    async changePassword(
        userId: string,
        data: { oldPassword: string; newPassword: string }
    ) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new AppError("User not found", 404);

        if (!user.password) {
            throw new AppError(
                "This account uses Google Sign-In and has no password to change.",
                403
            );
        }

        const isMatch = await bcrypt.compare(data.oldPassword, user.password);
        if (!isMatch) throw new AppError("Old password is incorrect", 403);

        const hashedPassword = await bcrypt.hash(data.newPassword, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });
    },
};
