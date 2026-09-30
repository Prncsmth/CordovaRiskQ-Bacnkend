import { prisma } from "@/lib/prisma";
import { emitAdminActivity, emitAdminSupportRequest } from "@/realtime/emit";
import { supportRequestDetail } from "@/services/adminActivity";
import { AppError } from "@/utils/AppError";

// role lets the admin panel tell a responder's request from a citizen's --
// the mobile app's Contact Support form is the same for both.
const REQUESTER_SELECT = { id: true, name: true, email: true, mobile: true, role: true } as const;

export const supportRequestService = {
    async create(userId: string, data: { topic: string; subject?: string; message: string }) {
        const created = await prisma.supportRequest.create({
            data: {
                userId,
                topic: data.topic,
                subject: data.subject ? data.subject : null,
                message: data.message,
            },
            include: { user: { select: { name: true, role: true } } },
        });

        emitAdminActivity({
            type: "support_request",
            title: "New support request",
            detail: supportRequestDetail(created.subject, created.topic, created.user.name),
            occurredAt: created.createdAt.toISOString(),
        });
        emitAdminSupportRequest({
            kind: "created",
            id: created.id,
            topic: created.topic,
            subject: created.subject,
            status: created.status,
            userName: created.user.name,
            userRole: created.user.role,
        });

        return created;
    },

    // The citizen's own requests, newest first -- so the app can show what it
    // already sent and its current status.
    async listForUser(userId: string) {
        return prisma.supportRequest.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 50,
        });
    },

    async listForAdmin(filters: {
        search?: string;
        status?: string;
        page?: number;
        limit?: number;
    }) {
        const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
        const limit =
            filters.limit && filters.limit > 0 ? Math.min(Math.floor(filters.limit), 100) : 20;

        const where = {
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.search
                ? {
                      OR: [
                          { subject: { contains: filters.search, mode: "insensitive" as const } },
                          { message: { contains: filters.search, mode: "insensitive" as const } },
                          { user: { name: { contains: filters.search, mode: "insensitive" as const } } },
                          { user: { email: { contains: filters.search, mode: "insensitive" as const } } },
                      ],
                  }
                : {}),
        };

        const [total, openCount, supportRequests] = await Promise.all([
            prisma.supportRequest.count({ where }),
            prisma.supportRequest.count({ where: { status: "open" } }),
            prisma.supportRequest.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: { user: { select: REQUESTER_SELECT } },
            }),
        ]);

        return { supportRequests, total, openCount, page, limit };
    },

    async updateStatus(id: string, status: string) {
        const existing = await prisma.supportRequest.findUnique({ where: { id } });
        if (!existing) throw new AppError("Support request not found", 404);
        const updated = await prisma.supportRequest.update({
            where: { id },
            data: { status },
            include: { user: { select: REQUESTER_SELECT } },
        });

        emitAdminSupportRequest({
            kind: "updated",
            id: updated.id,
            topic: updated.topic,
            subject: updated.subject,
            status: updated.status,
            userName: updated.user.name,
            userRole: updated.user.role,
        });

        return updated;
    },
};
