import type { ResponderRosterStatus } from "@/services/incidentRoster";

// Copy shown to a responder's teammates (never the actor) when the actor's
// own roster row changes on an incident they're already helping with.
// Titled "Teammate ..." rather than "Responder ..." so these can't be
// mistaken for the reporter-facing incident_status notifications
// ("Responder en route", "Responder arrived") in incident.service.ts.
// "declined" is intentionally absent: a decline never leaves any prior row
// for anyone else to have seen the responder join in the first place, so it
// has nobody to notify.
export const ROSTER_NOTIFICATION_COPY: Partial<
    Record<ResponderRosterStatus, (name: string) => { title: string; body: string }>
> = {
    joined: (name) => ({ title: "Teammate joined", body: `${name} joined this incident.` }),
    on_the_way: (name) => ({ title: "Teammate en route", body: `${name} is on the way.` }),
    arrived: (name) => ({ title: "Teammate arrived", body: `${name} arrived on scene.` }),
    left: (name) => ({ title: "Teammate left", body: `${name} left this incident.` }),
};
