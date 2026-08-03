import { z } from "zod";

export const updateProfileSchema = z.object({
    name: z.string().optional(),
    email: z.string().email("Invalid email address"),
    mobile: z.string().optional(),
});
