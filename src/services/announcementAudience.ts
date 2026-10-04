// Which announcement audiences a viewer of the in-app Announcement Card
// should see. Pure so it's unit-testable without a database.
//
// - Everyone sees "All Users".
// - A citizen whose barangay is known also sees that barangay's
//   "Specific Barangay" announcements.
// - A responder also sees "Responders Only". Only the authenticated responder
//   route asks for this, so the public endpoint never exposes those.
export type AnnouncementAudienceCondition =
    | { audience: "All Users" }
    | { audience: "Responders Only" }
    | {
          audience: "Specific Barangay";
          barangayName: { equals: string; mode: "insensitive" };
      };

export function activeAnnouncementConditions(options: {
    barangayName?: string;
    includeRespondersOnly?: boolean;
}): AnnouncementAudienceCondition[] {
    const conditions: AnnouncementAudienceCondition[] = [{ audience: "All Users" }];

    if (options.includeRespondersOnly) {
        conditions.push({ audience: "Responders Only" });
    }

    if (options.barangayName) {
        conditions.push({
            audience: "Specific Barangay",
            barangayName: { equals: options.barangayName, mode: "insensitive" },
        });
    }

    return conditions;
}

// Who may open one announcement by id (GET /api/announcements/:id). Every
// audience stays public except "Responders Only", which only a signed-in
// responder may read -- a UUID alone is not authorization.
// viewerRole is null for an anonymous (or not currently valid) session.
export function canViewAnnouncement(audience: string, viewerRole: string | null): boolean {
    if (audience === "Responders Only") return viewerRole === "responder";
    return true;
}

// Looks an announcement up for a viewer. A Responders Only announcement the
// viewer may not read comes back as "not found" -- the same answer as an id
// that doesn't exist, so the endpoint never confirms it exists.
export async function findViewableAnnouncement<T extends { audience: string }>(
    id: string,
    viewerRole: string | null,
    findById: (id: string) => Promise<T | null>,
): Promise<T | null> {
    const announcement = await findById(id);
    if (!announcement || !canViewAnnouncement(announcement.audience, viewerRole)) return null;
    return announcement;
}
