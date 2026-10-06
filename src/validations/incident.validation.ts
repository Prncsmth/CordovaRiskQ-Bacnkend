import { z } from "zod";

export const createIncidentSchema = z.object({
    category: z.enum(["flood", "fire", "medical", "road-accident", "other"]),
    details: z.string().max(1000, "Details must be 1000 characters or fewer").optional(),
    locationLabel: z
        .string()
        .min(1, "Location is required")
        .max(300, "Location must be 300 characters or fewer"),
    latitude: z.number(),
    longitude: z.number(),
    reporterLatitude: z.number(),
    reporterLongitude: z.number(),
    markedUrgent: z.boolean().optional(),
});

export const updateIncidentStatusSchema = z.object({
    status: z.enum(["completed", "cancelled"]),
});

export const updateMyResponderStatusSchema = z.object({
    status: z.enum(["joined", "declined", "on_the_way", "arrived", "left"]),
});
