// src/services/reviewSummary.ts
// Pure average/count/breakdown for the public rating summary. No Prisma --
// unit-tested directly; review.service.ts feeds it a groupBy of approved reviews.

export interface ReviewSummary {
    count: number;
    /** Mean rating rounded to one decimal, or null when there are no reviews. */
    average: number | null;
    /** How many reviews gave each star rating, 5 down to 1. */
    breakdown: { stars: number; count: number }[];
}

export function summarizeRatings(groups: { rating: number; count: number }[]): ReviewSummary {
    const byStars = new Map<number, number>();
    for (const { rating, count } of groups) {
        if (Number.isInteger(rating) && rating >= 1 && rating <= 5 && count > 0) {
            byStars.set(rating, (byStars.get(rating) ?? 0) + count);
        }
    }
    let count = 0;
    let total = 0;
    for (const [stars, n] of byStars) {
        count += n;
        total += stars * n;
    }
    return {
        count,
        average: count ? Math.round((total / count) * 10) / 10 : null,
        breakdown: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: byStars.get(stars) ?? 0 })),
    };
}
