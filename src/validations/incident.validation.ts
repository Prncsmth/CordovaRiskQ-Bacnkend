import { z } from "zod";

export const createIncidentSchema = z.object({
    category: z.enum(["flood", "fire", "medical", "road-accident", "other"]),
    details: z.string().optional(),
    locationLabel: z.string().min(1, "Location is required"),
    latitude: z.number(),
    longitude: z.number(),
});

export const updateIncidentStatusSchema = z.object({
    status: z.enum(["completed", "cancelled"]),
});

export const updateMyResponderStatusSchema = z.object({
    status: z.enum(["joined", "declined", "on_the_way", "arrived", "left"]),
});
