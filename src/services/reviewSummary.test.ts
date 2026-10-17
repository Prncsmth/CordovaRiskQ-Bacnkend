import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeRatings } from "@/services/reviewSummary";

test("no reviews has no average and an all-zero breakdown", () => {
    const summary = summarizeRatings([]);
    assert.equal(summary.count, 0);
    assert.equal(summary.average, null);
    assert.deepEqual(
        summary.breakdown.map((b) => b.count),
        [0, 0, 0, 0, 0],
    );
});

test("averages the ratings to one decimal and counts each star level", () => {
    const summary = summarizeRatings([
        { rating: 5, count: 3 },
        { rating: 4, count: 1 },
        { rating: 2, count: 1 },
    ]);
    assert.equal(summary.count, 5);
    assert.equal(summary.average, 4.2);
    assert.deepEqual(summary.breakdown, [
        { stars: 5, count: 3 },
        { stars: 4, count: 1 },
        { stars: 3, count: 0 },
        { stars: 2, count: 1 },
        { stars: 1, count: 0 },
    ]);
});

test("ignores ratings outside 1-5", () => {
    const summary = summarizeRatings([
        { rating: 0, count: 4 },
        { rating: 6, count: 2 },
        { rating: 3, count: 2 },
    ]);
    assert.equal(summary.count, 2);
    assert.equal(summary.average, 3);
});
