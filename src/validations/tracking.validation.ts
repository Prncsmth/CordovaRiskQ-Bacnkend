import { z } from "zod";

export const updateResponderLocationSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
});
