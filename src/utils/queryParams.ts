// src/utils/queryParams.ts
// Small parsers for Express req.query values (always string | string[] |
// ParsedQs | undefined) into the primitive types controllers actually want.
export function queryString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function queryDate(value: unknown): Date | undefined {
    const str = queryString(value);
    if (!str) return undefined;
    const date = new Date(str);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

export function queryInt(value: unknown): number | undefined {
    const str = queryString(value);
    if (!str) return undefined;
    const n = Number.parseInt(str, 10);
    return Number.isNaN(n) ? undefined : n;
}
