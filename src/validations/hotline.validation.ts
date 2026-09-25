import { z } from "zod";

export const updateHotlineSchema = z.object({
    name: z.string().min(1).optional(),
    number: z.string().min(1).optional(),
    category: z.enum(["police", "fire", "medical", "maritime"]).optional(),
});
