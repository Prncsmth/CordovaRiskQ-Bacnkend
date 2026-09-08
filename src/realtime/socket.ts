// src/realtime/socket.ts
// Boots the Socket.IO server: authenticates connections with the same JWT
// used by REST, and handles join:incident (a socket joining the room for
// one incident's live updates). See
// docs/superpowers/specs/2026-09-08-active-incident-realtime-design.md.
import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";

import { prisma } from "@/lib/prisma";
import { canViewIncident } from "@/services/incidentAuthorization";
import { setIo } from "@/realtime/emit";
import { verifyToken } from "@/utils/jwt";

interface AuthenticatedSocket extends Socket {
    userId?: string;
}

export function initRealtime(httpServer: HttpServer): void {
    const io = new Server(httpServer, {
        cors: { origin: true, credentials: true },
    });

    io.use((socket: AuthenticatedSocket, next) => {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) {
            next(new Error("Missing or invalid Authorization"));
            return;
        }
        try {
            const payload = verifyToken(token) as { userId?: string };
            if (!payload.userId) {
                next(new Error("Missing or invalid Authorization"));
                return;
            }
            socket.userId = payload.userId;
            next();
        } catch {
            next(new Error("Missing or invalid Authorization"));
        }
    });

    io.on("connection", (socket: AuthenticatedSocket) => {
        socket.on("join:incident", async (data: { incidentId?: string }) => {
            const refuse = () => socket.emit("error", { message: "Cannot join this incident" });
            try {
                const incidentId = data?.incidentId;
                if (!socket.userId || typeof incidentId !== "string") {
                    refuse();
                    return;
                }

                const [incident, requester] = await Promise.all([
                    prisma.incident.findUnique({ where: { id: incidentId } }),
                    prisma.user.findUnique({ where: { id: socket.userId } }),
                ]);
                if (!incident) {
                    refuse();
                    return;
                }
                if (!canViewIncident(requester?.role, incident.reporterId, socket.userId)) {
                    refuse();
                    return;
                }

                socket.join(`incident:${incidentId}`);
            } catch {
                refuse();
            }
        });
    });

    setIo(io);
}
