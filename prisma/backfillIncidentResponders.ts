import { prisma } from "@/lib/prisma";

const STATUS_MAP: Record<string, string> = {
    lobby: "joined",
    on_the_way: "on_the_way",
    arrived: "arrived",
    completed: "arrived",
    cancelled: "arrived",
};

async function main() {
    const incidents = await prisma.incident.findMany({
        where: { acceptedByResponderId: { not: null } },
        select: { id: true, acceptedByResponderId: true, status: true, updatedAt: true },
    });

    let created = 0;
    for (const incident of incidents) {
        if (!incident.acceptedByResponderId) continue;
        await prisma.incidentResponder.upsert({
            where: {
                incidentId_responderId: {
                    incidentId: incident.id,
                    responderId: incident.acceptedByResponderId,
                },
            },
            update: {},
            create: {
                incidentId: incident.id,
                responderId: incident.acceptedByResponderId,
                status: STATUS_MAP[incident.status] ?? "joined",
                createdAt: incident.updatedAt,
                updatedAt: incident.updatedAt,
            },
        });
        created++;
    }

    console.log(`Backfilled ${created} IncidentResponder row(s).`);
}

main()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
        console.error(err);
        await prisma.$disconnect();
        process.exit(1);
    });
