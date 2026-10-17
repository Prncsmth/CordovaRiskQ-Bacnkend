import { z } from "zod";

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

export const createReviewSchema = z.object({
    name: z.string().trim().max(60).optional(),
    title: z.string().trim().max(80).optional(),
    rating: z.number().int().min(1, "Pick a rating from 1 to 5").max(5, "Pick a rating from 1 to 5"),
    comment: z
        .string()
        .trim()
        .min(3, "Please write a short comment")
        .max(500, "Comments are limited to 500 characters"),
    // Honeypot: hidden on the website, so only bots fill it in. A filled one
    // is accepted (so the bot learns nothing) but never saved.
    website: z.string().optional(),
});

export const updateReviewStatusSchema = z.object({
    status: z.enum(REVIEW_STATUSES),
});
