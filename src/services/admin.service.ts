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
            mobile: user.mobile,
            role: user.role,
            unit: user.unit,
            isOnDuty: user.isOnDuty,
            createdAt: user.createdAt,
        }));
    },

    async updateUserRole(targetUserId: string, role: string, unit?: string | null) {
        const target = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (!target) throw new AppError("User not found", 404);
        if (target.role === "admin") {
            throw new AppError("Cannot change an admin's role", 403);
        }

        const updated = await prisma.user.update({
            where: { id: targetUserId },
            // unit only makes sense for responders -- clear it whenever the
            // target role isn't "responder" so a citizen never carries a
            // stale BDRRMO/MDRRMO classification from a prior promotion.
            data: { role, unit: role === "responder" ? unit : null },
        });

        return {
            id: updated.id,
            name: updated.name,
            email: updated.email,
            role: updated.role,
            unit: updated.unit,
            createdAt: updated.createdAt,
        };
    },

    async getResponderSummary() {
        const [total, onDuty, bdrrmo, mdrrmo] = await Promise.all([
            prisma.user.count({ where: { role: "responder" } }),
            prisma.user.count({ where: { role: "responder", isOnDuty: true } }),
            prisma.user.count({ where: { role: "responder", unit: "BDRRMO" } }),
            prisma.user.count({ where: { role: "responder", unit: "MDRRMO" } }),
        ]);

        return {
            total,
            onDuty,
            offDuty: total - onDuty,
            bdrrmo,
            mdrrmo,
            unclassified: total - bdrrmo - mdrrmo,
        };
    },
};
