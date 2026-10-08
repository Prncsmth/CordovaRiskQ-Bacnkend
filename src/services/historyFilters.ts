// Prisma where-fragment for GET /admin/history?responderId=: the incidents a
// responder was actually on. "declined" rows are excluded -- a responder who
// said no never handled the incident. "left" rows are kept: they did respond,
// and the admin panel marks them as having left early.
export function responderHistoryFilter(responderId: string | undefined) {
    if (!responderId) return {};
    return { responders: { some: { responderId, status: { not: "declined" } } } };
}
