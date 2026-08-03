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
};
