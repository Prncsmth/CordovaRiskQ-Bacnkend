import { z } from "zod";

export const triggerSosSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    locationLabel: z.string().optional(),
});
