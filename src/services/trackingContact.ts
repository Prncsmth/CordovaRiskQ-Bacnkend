// The one contact the citizen's Track Responder(s) screen may call: the
// PRIMARY responder only (the first-accepted active responder, see
// pickAcceptedByResponderId). Pure so it's unit-tested without a database.
//
// Only ever applied to the primary responder's user row -- the per-responder
// `responders` list never carries a phone number, so a citizen can't collect
// every responder's number from one incident.
export type PrimaryContact = {
    // Null when the responder has no usable number saved; the app then shows
    // Call Responder as unavailable and offers the emergency hotline instead.
    mobile: string | null;
    unit: string | null;
};

export function primaryContact(
    user: { mobile: string | null; unit: string | null } | null | undefined,
): PrimaryContact {
    const mobile = user?.mobile?.trim() ?? "";
    // A number needs at least 7 digits to be dialable; anything shorter is
    // treated as missing rather than handed to the dialer.
    const digits = mobile.replace(/\D/g, "");
    const unit = user?.unit?.trim() ?? "";
    return {
        mobile: digits.length >= 7 ? mobile : null,
        unit: unit.length > 0 ? unit : null,
    };
}
