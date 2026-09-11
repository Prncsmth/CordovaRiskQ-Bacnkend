import { z } from "zod";

export const triggerSosSchema = z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    locationLabel: z.string().optional(),
});
