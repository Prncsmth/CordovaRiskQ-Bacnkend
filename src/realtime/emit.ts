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

export interface ResponderLocationPayload {
    responderId: string;
    latitude: number;
    longitude: number;
    locationUpdatedAt: string;
}

// Pushed to the same incident:<id> room join:incident already puts a viewing
// citizen into (see socket.ts) -- the Track Responder screen's live-map
// counterpart to emitIncidentUpdate, fired on every PATCH /responders/location
// (tracking.service.ts) instead of the citizen having to poll for movement.
export function emitResponderLocationUpdate(
    incidentId: string,
    payload: ResponderLocationPayload,
): void {
    ioInstance?.to(`incident:${incidentId}`).emit("incident:responderLocation", payload);
}

// Pushed to every connected admin socket (see socket.ts's "admin" room join)
// so the dashboard's Recent Activity widget updates live. The REST
// counterpart (GET /admin/activity, adminService.getRecentActivity) supplies
// the initial load; this covers everything that happens afterward.
export function emitAdminActivity(activity: AdminActivityItem): void {
    ioInstance?.to("admin").emit("admin:activity", activity);
}

export interface AdminResponderLocationPayload extends ResponderLocationPayload {
    incidentId: string;
    responderName: string;
}

// Pushed to the "admin" room alongside emitResponderLocationUpdate's
// per-incident broadcast, so the admin Live Map's responder layer moves
// live too. GET /admin/responders/en-route (adminService.listEnRouteResponders)
// supplies the initial load.
export function emitAdminResponderLocation(payload: AdminResponderLocationPayload): void {
    ioInstance?.to("admin").emit("admin:responderLocation", payload);
}

// Full admin-shaped incident row (same field set GET /incidents returns per
// item) -- unlike IncidentBroadcastPayload above, this carries everything
// the admin frontend's Emergency mapper needs (category, locationLabel,
// coordinates, etc.), not just the status/roster delta, since it also has to
// cover a brand-new incident the admin dashboard has never fetched before.
export interface AdminIncidentPayload {
    id: string;
    source: string;
    reporterId: string;
    category: string;
    details: string | null;
    locationLabel: string;
    latitude: number | null;
    longitude: number | null;
    status: string;
    createdAt: string;
    updatedAt: string;
    acceptedByResponderId: string | null;
    responders: { id: string; name: string; status: string }[];
}

// Pushed to the "admin" room on every incident create/status/roster change so
// the "Live Incidents" list and the Live Map's incident markers actually
// update live, the same way responder locations and the activity feed
// already do -- GET /incidents supplies the initial load.
export function emitAdminIncidentUpdate(payload: AdminIncidentPayload): void {
    ioInstance?.to("admin").emit("admin:incidentUpdate", payload);
}
