import { prisma } from "@/lib/prisma";

export const sosService = {
    async trigger(
        userId: string,
        data: { latitude?: number; longitude?: number }
    ) {
        const alert = await prisma.sosAlert.create({
            data: {
                userId,
                latitude: data.latitude,
                longitude: data.longitude,
            },
        });

        return {
            id: alert.id,
            status: alert.status,
            createdAt: alert.createdAt,
        };
    },
};
