import { z } from "zod";

export const triggerSosSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    locationLabel: z.string().max(300, "Location must be 300 characters or fewer").optional(),
});

export const closeSosAlertSchema = z.object({
    outcome: z.enum(["resolved", "dismissed"]),
});
