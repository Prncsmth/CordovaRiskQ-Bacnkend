import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { emitNotificationCreated } from "@/realtime/emit";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo's push API rejects an entire request if it carries more than 100
// messages, so recipients are sent in chunks of this size.
const EXPO_PUSH_CHUNK_SIZE = 100;

type ExpoPushTicket = {
    status: "ok" | "error";
    details?: { error?: string };
};

type NotificationData = {
    type:
        | "announcement"
        | "incident_status"
        | "tide_risk"
        | "new_incident"
        | "roster_update"
        | "team_ring"
        | "support_status";
    title: string;
    body: string;
    referenceId?: string;
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
    data: NotificationData
) {
    const targets = recipients.filter(
        (r): r is { id: string; pushToken: string } => r.pushToken !== null
    );
    if (targets.length === 0) return;

    // Lets the frontend deep-link a tapped notification (e.g. straight to an
    // incident) without a second API call -- referenceId is only present
    // when the caller has one (e.g. omitted for announcements).
    const expoData = {
        type: data.type,
        ...(data.referenceId ? { referenceId: data.referenceId } : {}),
    };

    try {
        for (const targetChunk of chunk(targets, EXPO_PUSH_CHUNK_SIZE)) {
            const messages = targetChunk.map((t) => ({
                to: t.pushToken,
                title: data.title,
                body: data.body,
                data: expoData,
            }));

            const response = await fetch(EXPO_PUSH_URL, {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: JSON.stringify(messages),
                signal: AbortSignal.timeout(15_000),
            });

            if (!response.ok) {
                console.error("Expo push rejected:", response.status, await response.text());
                continue;
            }

            const result = (await response.json()) as { data?: ExpoPushTicket[] };
            if (!Array.isArray(result.data)) continue;

            // Production troubleshooting without identifying anyone: how many
            // tickets in this chunk failed, and Expo's error codes only --
            // never user ids or tokens.
            const failedTickets = result.data.filter((ticket) => ticket?.status === "error");
            if (failedTickets.length > 0) {
                const errorCodes = [...new Set(failedTickets.map((t) => t.details?.error ?? "unknown"))];
                console.error(
                    `Expo push: ${failedTickets.length} of ${result.data.length} tickets failed:`,
                    errorCodes.join(", ")
                );
            }

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

    async remove(id: string, userId: string) {
        const existing = await prisma.notification.findUnique({ where: { id } });
        if (!existing || existing.userId !== userId) {
            throw new AppError("Notification not found", 404);
        }
        await prisma.notification.delete({ where: { id } });
    },

    // Bulk-creates Notification rows then does a best-effort Expo push
    // send. Wrapped in one try/catch so a DB/network failure here can
    // never make an already-committed primary action (e.g. publishing an
    // announcement) appear to fail to its caller.
    async createForUsers(userIds: string[], data: NotificationData) {
        if (userIds.length === 0) return;

        try {
            const created = await prisma.notification.createManyAndReturn({
                data: userIds.map((userId) => ({ userId, ...data })),
            });

            // Pushed the instant each row is written -- see user:<id> room
            // join in realtime/socket.ts -- so a connected client sees it
            // live instead of waiting for its next GET /api/notifications.
            for (const row of created) {
                emitNotificationCreated(row.userId, {
                    id: row.id,
                    userId: row.userId,
                    type: row.type,
                    title: row.title,
                    body: row.body,
                    read: row.read,
                    referenceId: row.referenceId,
                    createdAt: row.createdAt.toISOString(),
                });
            }

            const recipients = await prisma.user.findMany({
                where: { id: { in: userIds }, pushToken: { not: null } },
                select: { id: true, pushToken: true },
            });

            await sendPushToRecipients(recipients, data);
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

    // Mirrors createForAllCitizens, for fanning a new-incident alert out to
    // every responder account. Defaults to on-duty only -- off-duty
    // responders are excluded, since going offline is meaningless if it
    // doesn't stop new-incident pages. Callers like announcements, which
    // aren't tied to duty status, opt into { onDutyOnly: false }.
    async createForAllResponders(data: NotificationData, options?: { onDutyOnly?: boolean }) {
        const onDutyOnly = options?.onDutyOnly ?? true;
        try {
            const responders = await prisma.user.findMany({
                where: { role: "responder", ...(onDutyOnly ? { isOnDuty: true } : {}) },
                select: { id: true },
            });

            await this.createForUsers(
                responders.map((r) => r.id),
                data
            );
        } catch (error) {
            console.error("Failed to create notifications for all responders:", error);
        }
    },

    // Mirrors createForAllCitizens/createForAllResponders. "All Users"
    // announcements previously only fanned out to role "citizen" and
    // "responder", silently skipping role "admin" -- since admin accounts
    // share the same User table/login as citizens and responders (an admin
    // can also open the mobile app), an "All Users" announcement should
    // reach them too, matching what the audience label actually says.
    async createForAllAdmins(data: NotificationData) {
        try {
            const admins = await prisma.user.findMany({
                where: { role: "admin" },
                select: { id: true },
            });

            await this.createForUsers(
                admins.map((a) => a.id),
                data
            );
        } catch (error) {
            console.error("Failed to create notifications for all admins:", error);
        }
    },
};
