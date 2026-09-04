import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type ExpoPushTicket = {
    status: "ok" | "error";
    details?: { error?: string };
};

async function sendPushToRecipients(
    recipients: { id: string; pushToken: string | null }[],
    data: { title: string; body: string }
) {
    const targets = recipients.filter(
        (r): r is { id: string; pushToken: string } => r.pushToken !== null
    );
    if (targets.length === 0) return;

    try {
        const response = await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify(
                targets.map((t) => ({ to: t.pushToken, title: data.title, body: data.body }))
            ),
        });

        const result = (await response.json()) as { data?: ExpoPushTicket[] };
        if (!Array.isArray(result.data)) return;

        const staleUserIds = targets
            .filter((_, i) => result.data![i]?.details?.error === "DeviceNotRegistered")
            .map((t) => t.id);

        if (staleUserIds.length > 0) {
            await prisma.user.updateMany({
                where: { id: { in: staleUserIds } },
                data: { pushToken: null },
            });
        }
    } catch (error) {
        console.error("Push notification send failed:", error);
    }
}

export const notificationService = {
    async listForUser(userId: string) {
        return prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 50,
        });
    },

    async markRead(id: string, userId: string) {
        const existing = await prisma.notification.findUnique({ where: { id } });
        if (!existing || existing.userId !== userId) {
            throw new AppError("Notification not found", 404);
        }
        await prisma.notification.update({ where: { id }, data: { read: true } });
    },

    async markAllRead(userId: string) {
        await prisma.notification.updateMany({
            where: { userId, read: false },
            data: { read: true },
        });
    },

    async createForUsers(
        userIds: string[],
        data: { type: string; title: string; body: string }
    ) {
        if (userIds.length === 0) return;

        await prisma.notification.createMany({
            data: userIds.map((userId) => ({ userId, ...data })),
        });

        const recipients = await prisma.user.findMany({
            where: { id: { in: userIds }, pushToken: { not: null } },
            select: { id: true, pushToken: true },
        });

        await sendPushToRecipients(recipients, { title: data.title, body: data.body });
    },
};
