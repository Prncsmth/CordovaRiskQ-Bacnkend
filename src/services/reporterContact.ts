// The citizen who reported an incident (or sent the SOS), as a contact the
// responders helping with it can call -- e.g. to ask exactly where they are.
// Pure so the access rule is unit-tested without a database.
//
// Only a responder ACTIVELY on that incident's roster (joined, on_the_way or
// arrived) gets it: never a responder just browsing the incident list, one
// who declined or left, or anyone else. That mirrors the citizen side, where
// only the incident's own reporter can call its primary responder (see
// trackingContact.ts). The app dials the number but never shows it as text.
import { isActiveStatus, type ResponderRosterStatus } from "@/services/incidentRoster";

export type ReporterContact = {
    name: string | null;
    // Null when the reporter has no usable number saved -- the app then shows
    // Call as unavailable.
    mobile: string | null;
};

export function reporterContactFor(
    requesterRosterStatus: ResponderRosterStatus | null | undefined,
    reporter: { name: string | null; mobile: string | null } | null | undefined,
): ReporterContact | null {
    if (!requesterRosterStatus || !isActiveStatus(requesterRosterStatus) || !reporter) return null;
    const mobile = reporter.mobile?.trim() ?? "";
    const name = reporter.name?.trim() ?? "";
    return {
        name: name.length > 0 ? name : null,
        // Same "is this dialable" rule as the primary responder's contact.
        mobile: mobile.replace(/\D/g, "").length >= 7 ? mobile : null,
    };
}
