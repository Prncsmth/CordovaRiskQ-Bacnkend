import { z } from "zod";

export const triggerSosSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    locationLabel: z.string().optional(),
});

export const closeSosAlertSchema = z.object({
    outcome: z.enum(["resolved", "dismissed"]),
});
