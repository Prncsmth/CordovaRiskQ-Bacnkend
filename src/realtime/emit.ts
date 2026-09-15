// src/realtime/emit.ts
// Holds the live Socket.IO server instance (set once at boot by
// src/realtime/socket.ts) and exposes a narrow emit helper so controllers
// don't need to import the socket server directly. See
// docs/superpowers/specs/2026-09-08-active-incident-realtime-design.md.
import type { Server } from "socket.io";
import type { AdminActivityItem } from "@/services/adminActivity";

let ioInstance: Server | null = null;

export function setIo(server: Server): void {
    ioInstance = server;
}

// Deliberately omits myStatus -- it's per-requester
// (buildResponderFacingIncident computes it per viewer), so it can't be
// broadcast as one shared payload without leaking one responder's phase
// into another's screen.
export interface IncidentBroadcastPayload {
    id: string;
    status: string;
    responders: { id: string; name: string; status: string }[];
    respondersCount: number;
    acceptedByResponderId: string | null;
    updatedAt: string;
}

export function emitIncidentUpdate(incidentId: string, payload: IncidentBroadcastPayload): void {
    ioInstance?.to(`incident:${incidentId}`).emit("incident:updated", payload);
}

// Pushed to every connected admin socket (see socket.ts's "admin" room join)
// so the dashboard's Recent Activity widget updates live. The REST
// counterpart (GET /admin/activity, adminService.getRecentActivity) supplies
// the initial load; this covers everything that happens afterward.
export function emitAdminActivity(activity: AdminActivityItem): void {
    ioInstance?.to("admin").emit("admin:activity", activity);
}
