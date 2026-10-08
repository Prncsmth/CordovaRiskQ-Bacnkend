import assert from "node:assert/strict";
import { test } from "node:test";

import { responderHistoryFilter } from "@/services/historyFilters";

test("a responder's history matches incidents they were on, but not ones they declined", () => {
    assert.deepEqual(responderHistoryFilter("responder-1"), {
        responders: { some: { responderId: "responder-1", status: { not: "declined" } } },
    });
});

test("no responderId means no responder filter at all", () => {
    assert.deepEqual(responderHistoryFilter(undefined), {});
});
