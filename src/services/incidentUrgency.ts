export type Urgency = "low" | "medium" | "high";

const URGENCY_BY_CATEGORY: Record<string, Urgency> = {
    fire: "high",
    medical: "high",
    flood: "medium",
    "road-accident": "medium",
    other: "low",
};

const NEXT_URGENCY: Record<Urgency, Urgency> = {
    low: "medium",
    medium: "high",
    high: "high",
};

export function bumpUrgency(urgency: Urgency): Urgency {
    return NEXT_URGENCY[urgency];
}

// The category sets the baseline urgency; a reporter marking the incident
// urgent can only raise it one level (capped at high), never lower it.
export function resolveUrgency(category: string, markedUrgent = false): Urgency {
    const base = URGENCY_BY_CATEGORY[category] ?? "low";
    return markedUrgent ? bumpUrgency(base) : base;
}
