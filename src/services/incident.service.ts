import { prisma, type DbTransactionClient } from "@/lib/prisma";
import type { Incident } from "@/generated/prisma/client";
import { AppError } from "@/utils/AppError";
import { notificationService } from "@/services/notification.service";
import {
    deriveIncidentStatus,
    isActiveStatus,
    isRosterTransitionAllowed,
    otherActiveResponderIds,
    pickAcceptedByResponderId,
    type ResponderRosterStatus,
} from "@/services/incidentRoster";
import { canCancelIncident, canViewIncident } from "@/services/incidentAuthorization";
import { reporterContactFor } from "@/services/reporterContact";
import { emitAdminActivity, emitAdminIncidentUpdate, emitIncidentUpdate } from "@/realtime/emit";
import { isIncidentPhotoUrl } from "@/lib/cloudinary";
import { resolveUrgency } from "@/services/incidentUrgency";
import { ROSTER_NOTIFICATION_COPY } from "@/services/rosterNotificationCopy";
import { incidentStatusToAlertOutcome } from "@/services/sosAlertStatus";
import {
    ESCALATE_AFTER_MS,
    canRespondToIncident,
    coverageFrom,
    isOpenAsBackup,
    isResponseActionAllowed,
    selectEscalationRecipients,
    selectNewIncidentRecipients,
    type BarangayCoverage,
    type ScopeIncident,
    type ScopeResponder,
} from "@/services/responderScope";

const SCOPE_RESPONDER_SELECT = {
    id: true,
    role: true,
    unit: true,
    assignedBarangay: true,
    isOnDuty: true,
} as const;

// Every on-duty responder, from their User rows -- the push recipient pool.
async function loadOnDutyResponders(): Promise<ScopeResponder[]> {
    return prisma.user.findMany({
        where: { role: "responder", isOnDuty: true },
        select: SCOPE_RESPONDER_SELECT,
    });
}

type ScopeContext = { requester: ScopeResponder | null; coverage: BarangayCoverage };

// The requester's own unit/barangay from their User row (never the client),
// plus which barangays have an on-duty BDRRMO (MDRRMO only steps in where
// none is), for per-incident canRespond checks.
async function loadScopeContext(requesterId: string): Promise<ScopeContext> {
    const [requester, onDuty] = await Promise.all([
        prisma.user.findUnique({ where: { id: requesterId }, select: SCOPE_RESPONDER_SELECT }),
        loadOnDutyResponders(),
    ]);
    return { requester, coverage: coverageFrom(onDuty) };
}

// canRespond (may accept/decline) and escalated (open to them as backup or
// because it went unanswered, not as their own barangay's) for one caller.
function scopeFlags(context: ScopeContext, incident: ScopeIncident, now = new Date()) {
    const { requester, coverage } = context;
    if (!requester) return { canRespond: false, escalated: false };
    return {
        canRespond: canRespondToIncident(requester, incident, coverage, now),
        escalated: isOpenAsBackup(requester, incident, coverage, now),
    };
}

// The escalation alert's title, also used to tell whether one was already
// sent for an incident (no extra column needed).
const ESCALATION_TITLE = "Unanswered emergency nearby";
// Escalation only looks this far back, so a first run after downtime
// doesn't page everyone about long-stale incidents.
const ESCALATION_LOOKBACK_MS = 60 * 60 * 1000;

// The first new_incident push / in-app alert: the incident barangay's
// on-duty BDRRMO, or MDRRMO if it has none (see responderScope.ts);
// everyone else hears about it only if it escalates.
async function notifyRespondersOfNewIncident(
    incident: { id: string; latitude: number | null; longitude: number | null },
    copy: { title: string; body: string },
) {
    try {
        const onDuty = await loadOnDutyResponders();
        const recipients = selectNewIncidentRecipients(onDuty, incident);
        await notificationService.createForUsers(recipients, {
            type: "new_incident",
            ...copy,
            referenceId: incident.id,
        });
    } catch (error) {
        console.error("Failed to notify responders of new incident:", error);
    }
}

export const NON_TERMINAL_STATUSES =["pending", "lobby", "on_the_way", "arrived"];

const STATUS_NOTIFICATION_COPY: Record<string, { title: string; body: string }> = {
    lobby: { title: "Responder assigned", body: "A responder has accepted your report." },
    on_the_way: { title: "Responder en route", body: "Your responder is on the way." },
    arrived: { title: "Responder arrived", body: "Your responder has arrived at the location." },
    completed: { title: "Report resolved", body: "Your report has been resolved." },
    cancelled: { title: "Report cancelled", body: "Your report was cancelled." },
};

// SOS-sourced incidents don't have a reporter-authored "report" -- swap in
// alert-appropriate copy for the statuses whose default text says "report".
const SOS_STATUS_NOTIFICATION_COPY: Partial<Record<string, { title: string; body: string }>> = {
    lobby: { title: "Responder assigned", body: "A responder has accepted your SOS alert." },
    completed: { title: "Alert resolved", body: "Your SOS alert has been resolved." },
    cancelled: { title: "Alert cancelled", body: "Your SOS alert was cancelled." },
    expired: {
        title: "No responder available",
        body: "No responder accepted your SOS alert. If you still need help, call an emergency hotline or send a new SOS.",
    },
};

// An SOS that expires long after it was sent (e.g. the backlog swept up the
// first time expiry runs) skips the citizen notification -- telling someone
// days later that nobody came helps no one.
const EXPIRY_NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000;

async function notifyStatusChange(
    reporterId: string,
    incidentId: string,
    status: string,
    source?: string
) {
    const copy =
        (source === "sos" ? SOS_STATUS_NOTIFICATION_COPY[status] : undefined) ??
        STATUS_NOTIFICATION_COPY[status];
    if (!copy) return;
    await notificationService.createForUsers([reporterId], {
        type: "incident_status",
        title: copy.title,
        body: copy.body,
        referenceId: incidentId,
    });
}

const CLOSED_INCIDENT_NOTIFICATION_COPY: Record<"completed" | "cancelled", { title: string; body: string }> = {
    completed: { title: "Incident completed", body: "This incident has been marked completed." },
    cancelled: { title: "Incident cancelled", body: "This incident has been cancelled." },
};

async function notifyTeammatesOfRosterChange(
    incidentId: string,
    actorId: string,
    actorName: string,
    targetStatus: ResponderRosterStatus,
    allRows: { responderId: string; status: string }[],
) {
    const copy = ROSTER_NOTIFICATION_COPY[targetStatus];
    if (!copy) return;
    const recipients = otherActiveResponderIds(
        allRows.map((r) => ({ responderId: r.responderId, status: r.status as ResponderRosterStatus })),
        actorId,
    );
    if (recipients.length === 0) return;
    await notificationService.createForUsers(recipients, {
        type: "roster_update",
        ...copy(actorName),
        referenceId: incidentId,
    });
}

async function notifyTeammatesOfClosure(
    incidentId: string,
    actorId: string,
    status: "completed" | "cancelled",
    allRows: { responderId: string; status: string }[],
) {
    const recipients = otherActiveResponderIds(
        allRows.map((r) => ({ responderId: r.responderId, status: r.status as ResponderRosterStatus })),
        actorId,
    );
    if (recipients.length === 0) return;
    await notificationService.createForUsers(recipients, {
        type: "roster_update",
        ...CLOSED_INCIDENT_NOTIFICATION_COPY[status],
        referenceId: incidentId,
    });
}

type ResponderRowWithName = {
    id: string;
    responderId: string;
    status: string;
    createdAt: Date;
    responder: { name: string | null; avatarUrl: string | null };
};

function shapeResponders(rows: ResponderRowWithName[]) {
    const activeRows = rows.filter((r) => isActiveStatus(r.status as ResponderRosterStatus));
    return {
        respondersCount: activeRows.length,
        acceptedByResponderId: pickAcceptedByResponderId(
            rows.map((r) => ({
                id: r.id,
                responderId: r.responderId,
                status: r.status as ResponderRosterStatus,
                createdAt: r.createdAt,
            })),
        ),
        activeResponders: activeRows.map((r) => ({
            id: r.responderId,
            name: r.responder.name ?? "Responder",
            status: r.status,
            avatarUrl: r.responder.avatarUrl,
        })),
    };
}

// The full shape any responder-facing endpoint returns for one incident:
// the citizen-safe fields plus the roster summary and the caller's own
// status. Used by updateMyResponderStatus/updateStatus (this file, below)
// and by list()/getById() (Task 6) so every endpoint a responder hits
// returns a consistent, fully-populated shape -- critical for
// updateMyResponderStatus specifically, since the frontend derives its
// next UI phase directly from this response's `myStatus`.
function buildResponderFacingIncident(
    incident: {
        id: string;
        source: string;
        reporterId: string;
        category: string;
        details: string | null;
        photoUrl: string | null;
        locationLabel: string;
        latitude: number | null;
        longitude: number | null;
        urgency: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    },
    responderRows: ResponderRowWithName[],
    requesterId: string,
) {
    const shaped = shapeResponders(responderRows);
    const myRow = responderRows.find((r) => r.responderId === requesterId);
    return {
        id: incident.id,
        source: incident.source,
        reporterId: incident.reporterId,
        category: incident.category,
        details: incident.details,
        photoUrl: incident.photoUrl,
        locationLabel: incident.locationLabel,
        latitude: incident.latitude,
        longitude: incident.longitude,
        urgency: incident.urgency,
        status: incident.status,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
        respondersCount: shaped.respondersCount,
        acceptedByResponderId: shaped.acceptedByResponderId,
        responders: shaped.activeResponders,
        myStatus: myRow?.status ?? "pending",
    };
}

// The reporter's contact for one responder, given their own roster status --
// null unless they're actively on the incident (see reporterContact.ts).
// Only the reporter's name and mobile are read.
async function loadReporterContact(reporterId: string, myStatus: string) {
    if (!isActiveStatus(myStatus as ResponderRosterStatus)) return null;
    const reporter = await prisma.user.findUnique({
        where: { id: reporterId },
        select: { name: true, mobile: true, avatarUrl: true },
    });
    return reporterContactFor(myStatus as ResponderRosterStatus, reporter);
}

// Strips the per-viewer myStatus field buildResponderFacingIncident computes
// and stringifies the dates, shaping its result for emitAdminIncidentUpdate's
// shared-broadcast payload (myStatus can't be broadcast to every admin at
// once the same way it can't be broadcast to every responder -- see
// IncidentBroadcastPayload's comment in realtime/emit.ts).
function toAdminIncidentPayload(
    incident: ReturnType<typeof buildResponderFacingIncident>,
) {
    const { myStatus: _myStatus, createdAt, updatedAt, ...rest } = incident;
    return { ...rest, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

// Pushes an incident's current state to the admin room and to its own
// incident:<id> room (the citizen's tracking screen), for status changes
// made outside a responder/citizen request -- the expiry sweep and admin close.
async function broadcastIncidentState(id: string) {
    const incident = await prisma.incident.findUniqueOrThrow({
        where: { id },
        include: { responders: { include: { responder: { select: { name: true, avatarUrl: true } } } } },
    });
    const { responders, ...rest } = incident;
    const shaped = buildResponderFacingIncident(rest, responders, "");
    emitAdminIncidentUpdate(toAdminIncidentPayload(shaped));
    emitIncidentUpdate(id, {
        id,
        status: shaped.status,
        responders: shaped.responders,
        respondersCount: shaped.respondersCount,
        acceptedByResponderId: shaped.acceptedByResponderId,
        updatedAt: shaped.updatedAt.toISOString(),
    });
    return rest;
}

export const incidentService = {
    async create(
        reporterId: string,
        data: {
            category: string;
            details?: string;
            locationLabel: string;
            latitude: number;
            longitude: number;
            markedUrgent?: boolean;
            photoUrl?: string;
        }
    ) {
        if (data.photoUrl && !isIncidentPhotoUrl(data.photoUrl)) {
            throw new AppError("That photo wasn't uploaded through Cordova RiskQ", 400);
        }
        const incident = await prisma.incident.create({
            data: {
                source: "report",
                reporterId,
                category: data.category,
                details: data.details,
                // "" (an empty field) means no photo, same as leaving it out.
                photoUrl: data.photoUrl || null,
                locationLabel: data.locationLabel,
                latitude: data.latitude,
                longitude: data.longitude,
                urgency: resolveUrgency(data.category, data.markedUrgent),
            },
        });
        await notifyRespondersOfNewIncident(incident, {
            title: "New incident reported",
            body: `A ${data.category} incident was reported near ${data.locationLabel}.`,
        });
        emitAdminIncidentUpdate({
            ...incident,
            createdAt: incident.createdAt.toISOString(),
            updatedAt: incident.updatedAt.toISOString(),
            acceptedByResponderId: null,
            responders: [],
        });
        // Separate from the incident-list broadcast above -- this is what
        // actually reaches the admin Notifications bell (see
        // realtime/emit.ts's emitAdminActivity); without it a citizen's
        // report updated the Live Incidents list/map but never notified
        // anyone, unlike an SOS trigger which already fires this in
        // sos.service.ts.
        emitAdminActivity({
            type: "incident_reported",
            title: "New incident reported",
            detail: incident.locationLabel,
            occurredAt: incident.createdAt.toISOString(),
        });
        return incident;
    },

    // Write-only: runs inside sosService.trigger's per-user transaction, so
    // the admin broadcast and responder push live in announceSosIncident /
    // notifyRespondersOfSos and fire only after that transaction commits.
    async createFromSos(
        reporterId: string,
        sosAlertId: string,
        data: { latitude?: number; longitude?: number; locationLabel?: string },
        db: DbTransactionClient = prisma
    ) {
        return db.incident.create({
            data: {
                source: "sos",
                reporterId,
                sosAlertId,
                category: "sos",
                // Falls back to the old placeholder only when no location was
                // available at trigger time (e.g. permission denied) -- the
                // frontend computes a real nearest-barangay label whenever it
                // has device coordinates, same as the citizen report flow.
                locationLabel: data.locationLabel ?? "SOS Alert",
                latitude: data.latitude,
                longitude: data.longitude,
                urgency: "high",
            },
        });
    },

    announceSosIncident(incident: Incident) {
        emitAdminIncidentUpdate({
            ...incident,
            createdAt: incident.createdAt.toISOString(),
            updatedAt: incident.updatedAt.toISOString(),
            acceptedByResponderId: null,
            responders: [],
        });
    },

    notifyRespondersOfSos(incident: Incident) {
        return notifyRespondersOfNewIncident(incident, {
            title: "SOS alert",
            body: "An SOS alert was triggered nearby.",
        });
    },

    async list(responderId: string) {
        const incidents = await prisma.incident.findMany({
            where: {
                status: { in: NON_TERMINAL_STATUSES },
                responders: { none: { responderId, status: "declined" } },
            },
            orderBy: { createdAt: "desc" },
            include: { responders: { include: { responder: { select: { name: true, avatarUrl: true } } } } },
        });
        const scope = await loadScopeContext(responderId);
        const now = new Date();

        return incidents.map(({ responders, ...incident }) => {
            const shaped = shapeResponders(responders);
            const myRow = responders.find((r) => r.responderId === responderId);
            return {
                ...incident,
                acceptedByResponderId: shaped.acceptedByResponderId,
                respondersCount: shaped.respondersCount,
                responders: shaped.activeResponders,
                myStatus: myRow?.status ?? "pending",
                // canRespond: whether this caller may accept/decline it. The
                // full list stays visible (the Live Map is read-only
                // situational awareness); the app only alerts on, and offers
                // actions for, these. escalated: open to them only because
                // nobody in scope took it in time.
                ...scopeFlags(scope, incident, now),
            };
        });
    },

    async listByReporter(reporterId: string) {
        return prisma.incident.findMany({
            where: { reporterId },
            orderBy: { createdAt: "desc" },
        });
    },

    async listCompletedByResponder(responderId: string) {
        return prisma.incident.findMany({
            where: {
                status: "completed",
                responders: { some: { responderId, status: { not: "declined" } } },
            },
            orderBy: { updatedAt: "desc" },
        });
    },

    async getById(id: string, requesterId: string) {
        const incident = await prisma.incident.findUnique({
            where: { id },
            include: { responders: { include: { responder: { select: { name: true, avatarUrl: true } } } } },
        });
        if (!incident) throw new AppError("Incident not found", 404);

        const requester = await prisma.user.findUnique({ where: { id: requesterId } });
        if (!canViewIncident(requester?.role, incident.reporterId, requesterId)) {
            throw new AppError("Not your report", 403);
        }

        if (requester?.role === "citizen") {
            const shaped = shapeResponders(incident.responders);
            return {
                id: incident.id,
                category: incident.category,
                details: incident.details,
                photoUrl: incident.photoUrl,
                locationLabel: incident.locationLabel,
                latitude: incident.latitude,
                longitude: incident.longitude,
                urgency: incident.urgency,
                status: incident.status,
                createdAt: incident.createdAt,
                updatedAt: incident.updatedAt,
                respondersCount: shaped.respondersCount,
            };
        }

        const result = buildResponderFacingIncident(incident, incident.responders, requesterId);
        return {
            ...result,
            reporterContact: await loadReporterContact(incident.reporterId, result.myStatus),
            ...scopeFlags(await loadScopeContext(requesterId), incident),
        };
    },

    async updateMyResponderStatus(
        id: string,
        responderId: string,
        targetStatus: ResponderRosterStatus,
    ) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);
        // A stale responder screen could otherwise join a closed or expired
        // incident and re-derive it back to "lobby".
        if (targetStatus === "joined" && !NON_TERMINAL_STATUSES.includes(incident.status)) {
            throw new AppError("This incident is already closed", 409);
        }

        const existingRow = await prisma.incidentResponder.findUnique({
            where: { incidentId_responderId: { incidentId: id, responderId } },
        });
        const currentStatus = (existingRow?.status as ResponderRosterStatus | undefined) ?? null;

        if (!isRosterTransitionAllowed(currentStatus, targetStatus)) {
            throw new AppError(
                `Cannot move from ${currentStatus ?? "no status"} to ${targetStatus}`,
                409,
            );
        }

        // Accepting or declining needs this responder to be in scope for the
        // incident (their own User row, server-side); someone already on the
        // roster may keep going or leave. See responderScope.ts.
        if (!(currentStatus && isActiveStatus(currentStatus))) {
            const { canRespond } = scopeFlags(await loadScopeContext(responderId), incident);
            if (!isResponseActionAllowed(currentStatus, canRespond)) {
                throw new AppError("This incident is outside your assigned barangay", 403);
            }
        }

        await prisma.incidentResponder.upsert({
            where: { incidentId_responderId: { incidentId: id, responderId } },
            update: { status: targetStatus },
            create: { incidentId: id, responderId, status: targetStatus },
        });

        const allRows = await prisma.incidentResponder.findMany({
            where: { incidentId: id },
            include: { responder: { select: { name: true, avatarUrl: true } } },
        });
        const activeStatuses = allRows
            .filter((r) => isActiveStatus(r.status as ResponderRosterStatus))
            .map((r) => r.status as ResponderRosterStatus);
        const newStatus = deriveIncidentStatus(activeStatuses);

        let updatedIncident = incident;
        if (newStatus !== incident.status) {
            updatedIncident = await prisma.incident.update({ where: { id }, data: { status: newStatus } });
            await notifyStatusChange(
                updatedIncident.reporterId,
                updatedIncident.id,
                updatedIncident.status,
                updatedIncident.source,
            );
        }

        const myRow = allRows.find((r) => r.responderId === responderId);
        const actorName = myRow?.responder.name ?? "A responder";
        await notifyTeammatesOfRosterChange(id, responderId, actorName, targetStatus, allRows);

        if (targetStatus === "joined") {
            emitAdminActivity({
                type: "responder_joined",
                title: `${actorName} joined an incident`,
                detail: incident.locationLabel,
                // The row's createdAt, not "now" -- GET /admin/activity
                // (admin.service.ts) stamps this same event with it, and the
                // admin panel keys read state on occurredAt, so a mismatch
                // made a read notification come back unread after reload.
                occurredAt: (myRow?.createdAt ?? new Date()).toISOString(),
            });
        }

        const result = buildResponderFacingIncident(updatedIncident, allRows, responderId);
        emitAdminIncidentUpdate(toAdminIncidentPayload(result));
        // Added after the admin broadcast, so the reporter's number only ever
        // goes back to this responder -- never into a shared payload.
        return {
            ...result,
            reporterContact: await loadReporterContact(updatedIncident.reporterId, result.myStatus),
        };
    },

    async updateStatus(id: string, responderId: string, status: "completed" | "cancelled") {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);

        const myRow = await prisma.incidentResponder.findUnique({
            where: { incidentId_responderId: { incidentId: id, responderId } },
        });
        if (myRow?.status !== "arrived") {
            throw new AppError("You must be on-scene to close this incident", 403);
        }

        // No-op a retried/duplicate PATCH that doesn't actually change the
        // status -- avoids re-updating updatedAt and re-notifying the
        // reporter/teammates for a status they were already notified about.
        const statusChanged = incident.status !== status;
        let updatedIncident = incident;
        if (statusChanged) {
            updatedIncident = await prisma.incident.update({
                where: { id },
                data: { status },
            });
            await notifyStatusChange(
                updatedIncident.reporterId,
                updatedIncident.id,
                updatedIncident.status,
                updatedIncident.source,
            );
            if (status === "completed") {
                emitAdminActivity({
                    type: "incident_resolved",
                    title: "Incident resolved",
                    detail: updatedIncident.locationLabel,
                    occurredAt: updatedIncident.updatedAt.toISOString(),
                });
            }
        }

        const allRows = await prisma.incidentResponder.findMany({
            where: { incidentId: id },
            include: { responder: { select: { name: true, avatarUrl: true } } },
        });

        if (statusChanged) {
            await notifyTeammatesOfClosure(id, responderId, status, allRows);
        }

        const result = buildResponderFacingIncident(updatedIncident, allRows, responderId);
        emitAdminIncidentUpdate(toAdminIncidentPayload(result));
        return result;
    },

    // Citizen-facing cancel -- the counterpart to updateStatus above, which
    // is responder-only and gated on being "arrived". This one is gated the
    // opposite way: only the original reporter, and only before anyone has
    // joined (see canCancelIncident). No notification is sent since by
    // definition no responder is assigned yet.
    async cancelByReporter(id: string, reporterId: string) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);

        if (incident.reporterId !== reporterId) {
            throw new AppError("Not your report", 403);
        }
        if (!canCancelIncident(incident.reporterId, reporterId, incident.status)) {
            throw new AppError("This report can no longer be cancelled", 409);
        }

        const updatedIncident = await prisma.incident.update({
            where: { id },
            data: { status: "cancelled" },
        });

        const allRows = await prisma.incidentResponder.findMany({
            where: { incidentId: id },
            include: { responder: { select: { name: true, avatarUrl: true } } },
        });

        const result = buildResponderFacingIncident(updatedIncident, allRows, reporterId);
        emitAdminIncidentUpdate(toAdminIncidentPayload(result));
        return result;
    },

    // Pages every on-duty MDRRMO not yet alerted about an incident once it has
    // gone ESCALATE_AFTER_MS with nobody joining (see responderScope.ts): the
    // municipal backup takes over. Other barangays' BDRRMO are never paged. Once per
    // incident: an escalation alert already sent is found by its title, and
    // anyone who already got an alert for it or is on its roster is skipped,
    // so this needs no extra column. Run on an interval by
    // incidentEscalationPolling.ts. Returns how many incidents escalated.
    async escalateUnattendedIncidents(now = new Date()) {
        const due = await prisma.incident.findMany({
            where: {
                status: "pending",
                createdAt: {
                    lte: new Date(now.getTime() - ESCALATE_AFTER_MS),
                    gte: new Date(now.getTime() - ESCALATION_LOOKBACK_MS),
                },
            },
            select: {
                id: true,
                source: true,
                locationLabel: true,
                latitude: true,
                longitude: true,
                responders: { select: { responderId: true } },
            },
        });
        if (due.length === 0) return 0;

        // Every new_incident alert already sent for these incidents: who got
        // one (not alerted twice), and which already escalated.
        const sent = await prisma.notification.findMany({
            where: { type: "new_incident", referenceId: { in: due.map((i) => i.id) } },
            select: { referenceId: true, userId: true, title: true },
        });
        const alreadyEscalated = new Set(sent.filter((n) => n.title === ESCALATION_TITLE).map((n) => n.referenceId));

        const onDuty = await loadOnDutyResponders();
        let escalated = 0;
        for (const incident of due) {
            if (alreadyEscalated.has(incident.id)) continue;
            const exclude = new Set([
                ...incident.responders.map((r) => r.responderId),
                ...sent.filter((n) => n.referenceId === incident.id).map((n) => n.userId),
            ]);
            const recipients = selectEscalationRecipients(onDuty, exclude);
            if (recipients.length === 0) continue;
            await notificationService.createForUsers(recipients, {
                type: "new_incident",
                title: ESCALATION_TITLE,
                body: `${incident.source === "sos" ? "An SOS alert" : "A reported incident"} near ${incident.locationLabel} has had no responder for 2 minutes. You can respond.`,
                referenceId: incident.id,
            });
            escalated++;
        }
        return escalated;
    },

    // Moves every SOS incident still "pending" (no responder ever joined)
    // after maxAgeMs to "expired", so the admin panel shows it as Unattended
    // instead of New forever. Run on an interval by sosExpiryPolling.ts.
    async expireStaleSos(maxAgeMs: number, now = new Date()) {
        const stale = await prisma.incident.findMany({
            where: {
                source: "sos",
                status: "pending",
                createdAt: { lt: new Date(now.getTime() - maxAgeMs) },
            },
            select: { id: true },
        });

        let expiredCount = 0;
        for (const { id } of stale) {
            // Conditional on still being pending -- a responder may have
            // joined between the findMany above and this write.
            const { count } = await prisma.incident.updateMany({
                where: { id, status: "pending" },
                data: { status: "expired" },
            });
            if (count === 0) continue;
            expiredCount++;

            const incident = await broadcastIncidentState(id);
            if (now.getTime() - incident.createdAt.getTime() < EXPIRY_NOTIFY_WINDOW_MS) {
                await notifyStatusChange(incident.reporterId, incident.id, incident.status, incident.source);
            }
        }
        return expiredCount;
    },

    // Admin-side close for an SOS nobody has joined (New or Unattended) --
    // e.g. handled by phone outside the app ("resolved"), or a false alarm
    // or duplicate ("dismissed"). See canAdminCloseSosIncident.
    async closeSosByAdmin(sosAlertId: string, status: "completed" | "cancelled") {
        const incident = await prisma.incident.findFirst({ where: { sosAlertId } });
        if (!incident) throw new AppError("This SOS alert has no linked incident to close", 404);

        const { count } = await prisma.incident.updateMany({
            where: { id: incident.id, status: { in: ["pending", "expired"] } },
            data: { status },
        });
        if (count === 0) {
            throw new AppError("Only New or Unattended SOS alerts can be closed by an admin", 409);
        }

        const updated = await broadcastIncidentState(incident.id);
        await notifyStatusChange(updated.reporterId, updated.id, updated.status, updated.source);
        if (status === "completed") {
            emitAdminActivity({
                type: "incident_resolved",
                title: "SOS alert resolved by admin",
                detail: updated.locationLabel,
                occurredAt: updated.updatedAt.toISOString(),
            });
        }
        return updated;
    },

    // Lets a reporter clear a closed report out of their own history. Only
    // terminal (completed/cancelled) reports qualify -- an active one is
    // cancelled via cancelByReporter above, never deleted outright, so
    // responders already en route can't have the report vanish under them.
    // IncidentResponder rows have no cascade rule on their incidentId FK, so
    // they're cleared first in the same transaction.
    async removeOwnReport(id: string, reporterId: string) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident || incident.reporterId !== reporterId) {
            throw new AppError("Report not found", 404);
        }
        if (NON_TERMINAL_STATUSES.includes(incident.status)) {
            throw new AppError("Only a completed or cancelled report can be deleted", 409);
        }

        // An SOS's admin-facing status is derived from this incident -- stamp
        // the final outcome onto the SosAlert first, or deleting the incident
        // would make the alert read as never handled (see sosAlertStatus.ts).
        const outcome = incidentStatusToAlertOutcome(incident.status);
        await prisma.$transaction([
            ...(incident.sosAlertId && outcome
                ? [prisma.sosAlert.update({ where: { id: incident.sosAlertId }, data: { status: outcome } })]
                : []),
            prisma.incidentResponder.deleteMany({ where: { incidentId: id } }),
            prisma.incident.delete({ where: { id } }),
        ]);
    },

    async ringTeam(id: string, responderId: string) {
        const incident = await prisma.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError("Incident not found", 404);

        const allRows = await prisma.incidentResponder.findMany({
            where: { incidentId: id },
            include: { responder: { select: { name: true } } },
        });

        const myRow = allRows.find((r) => r.responderId === responderId);
        if (!myRow || !isActiveStatus(myRow.status as ResponderRosterStatus)) {
            throw new AppError("You must be helping this incident to ring the team", 403);
        }

        const recipients = otherActiveResponderIds(
            allRows.map((r) => ({ responderId: r.responderId, status: r.status as ResponderRosterStatus })),
            responderId,
        );
        if (recipients.length === 0) return;

        await notificationService.createForUsers(recipients, {
            type: "team_ring",
            title: "Team ring",
            body: `${myRow.responder.name ?? "A responder"} is calling for backup on this incident.`,
            referenceId: id,
        });
    },
};
