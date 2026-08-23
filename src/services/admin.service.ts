import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

export const adminService = {
    async listUsers() {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
        });

        return users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
        }));
    },

    async updateUserRole(targetUserId: string, role: string) {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (!target) throw new AppError("User not found", 404);
        if (target.role === "admin") {
            throw new AppError("Cannot change an admin's role", 403);
        }

        const updated = await prisma.user.update({
            where: { id: targetUserId },
            data: { role },
        });

        return {
            id: updated.id,
            name: updated.name,
            email: updated.email,
            role: updated.role,
            createdAt: updated.createdAt,
        };
    },
};
