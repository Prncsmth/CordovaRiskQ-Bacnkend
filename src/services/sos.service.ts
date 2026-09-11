import { prisma } from "@/lib/prisma";
import { incidentService } from "@/services/incident.service";

export const sosService = {
    async trigger(
        userId: string,
        data: { latitude?: number; longitude?: number; locationLabel?: string }
    ) {
        const alert = await prisma.sosAlert.create({
            data: {
                userId,
                latitude: data.latitude,
                longitude: data.longitude,
            },
        });

        // Best-effort: the SOS record itself is the primary outcome and must
        // still succeed even if this mirror write fails.
        try {
            await incidentService.createFromSos(userId, alert.id, data);
        } catch (err) {
            console.error(
                "Failed to create linked incident for SOS alert",
                alert.id,
                err
            );
        }

        return {
            id: alert.id,
            status: alert.status,
            createdAt: alert.createdAt,
        };
    },
};
