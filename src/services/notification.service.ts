import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo's push API rejects an entire request if it carries more than 100
// messages, so recipients are sent in chunks of this size.
const EXPO_PUSH_CHUNK_SIZE = 100;

type ExpoPushTicket = {
    status: "ok" | "error";
    details?: { error?: string };
};

type NotificationData = {
    type: "announcement" | "incident_status" | "tide_risk";
    title: string;
    body: string;
};

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

async function sendPushToRecipients(
    recipients: { id: string; pushToken: string | null }[],
    data: { title: string; body: string }
) {
    const targets = recipients.filter(
        (r): r is { id: string; pushToken: string } => r.pushToken !== null
    );
    if (targets.length === 0) return;

    try {
        for (const targetChunk of chunk(targets, EXPO_PUSH_CHUNK_SIZE)) {
            const response = await fetch(EXPO_PUSH_URL, {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: JSON.stringify(
                    targetChunk.map((t) => ({ to: t.pushToken, title: data.title, body: data.body }))
                ),
                signal: AbortSignal.timeout(15_000),
            });

            if (!response.ok) {
                console.error("Expo push rejected:", response.status, await response.text());
                continue;
            }

            const result = (await response.json()) as { data?: ExpoPushTicket[] };
            if (!Array.isArray(result.data)) continue;

            // result.data is positionally aligned with this chunk's own
            // message array, not the full original targets array.
            const staleUserIds = targetChunk
                .filter((_, i) => result.data![i]?.details?.error === "DeviceNotRegistered")
                .map((t) => t.id);

            if (staleUserIds.length > 0) {
                await prisma.user.updateMany({
                    where: { id: { in: staleUserIds } },
                    data: { pushToken: null },
                });
            }
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

    // Bulk-creates Notification rows then does a best-effort Expo push
    // send. Wrapped in one try/catch so a DB/network failure here can
    // never make an already-committed primary action (e.g. publishing an
    // announcement) appear to fail to its caller.
    async createForUsers(userIds: string[], data: NotificationData) {
        if (userIds.length === 0) return;

        try {
            await prisma.notification.createMany({
                data: userIds.map((userId) => ({ userId, ...data })),
            });

            const recipients = await prisma.user.findMany({
                where: { id: { in: userIds }, pushToken: { not: null } },
                select: { id: true, pushToken: true },
            });

            await sendPushToRecipients(recipients, { title: data.title, body: data.body });
        } catch (error) {
            console.error("Failed to create notifications for users:", error);
        }
    },

    // Enumerates all citizens and fans a notification out to them. The
    // recipient lookup is covered by this same try/catch so callers that
    // already committed a primary action (announcement publish, tide
    // escalation) never see that primary action fail because of it.
    async createForAllCitizens(data: NotificationData) {
        try {
            const citizens = await prisma.user.findMany({
                where: { role: "citizen" },
                select: { id: true },
            });
            await this.createForUsers(
                citizens.map((c) => c.id),
                data
            );
        } catch (error) {
            console.error("Failed to create notifications for all citizens:", error);
        }
    },
};
