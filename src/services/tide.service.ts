// src/services/tide.service.ts
import { CORDOVA_CENTER } from "@/constants/location";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

const STORMGLASS_BASE_URL = "https://api.stormglass.io/v2";

// Skip a redundant Stormglass call if we already have a recent reading --
// guards against `tsx watch` restarting the server (and re-polling) on
// every file save during development, and against overlapping polls
// burning quota if a previous run is slow.
const FRESHNESS_WINDOW_MS = 60 * 60 * 1000; // 1 hour

type StormglassSeaLevelResponse = {
    data: { time: string; sg: number }[];
};

type StormglassExtremesResponse = {
    data: { time: string; type: "high" | "low"; height: number }[];
};

// Response shapes per Stormglass v2 docs (tide/sea-level/point and
// tide/extremes/point). If your account returns a different source key
// than "sg" for sea level, adjust seaLevelPoint.sg below after checking
// the raw response in Task 4/5's manual verification step.
async function fetchFromStormglass(): Promise<{
    seaLevelM: number;
    nextExtremeAt: Date | null;
    nextExtremeType: "high" | "low" | null;
}> {
    const apiKey = process.env.STORMGLASS_API_KEY;
    if (!apiKey) {
        throw new AppError("STORMGLASS_API_KEY is not set", 500);
    }

    const now = new Date();
    const oneHourOut = new Date(now.getTime() + 60 * 60 * 1000);
    const twoDaysOut = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const headers = { Authorization: apiKey };

    const seaLevelUrl =
        `${STORMGLASS_BASE_URL}/tide/sea-level/point` +
        `?lat=${CORDOVA_CENTER.latitude}&lng=${CORDOVA_CENTER.longitude}` +
        `&start=${now.toISOString()}&end=${oneHourOut.toISOString()}`;
    const extremesUrl =
        `${STORMGLASS_BASE_URL}/tide/extremes/point` +
        `?lat=${CORDOVA_CENTER.latitude}&lng=${CORDOVA_CENTER.longitude}` +
        `&start=${now.toISOString()}&end=${twoDaysOut.toISOString()}`;

    const [seaLevelRes, extremesRes] = await Promise.all([
        fetch(seaLevelUrl, { headers, signal: AbortSignal.timeout(15_000) }),
        fetch(extremesUrl, { headers, signal: AbortSignal.timeout(15_000) }),
    ]);

    if (!seaLevelRes.ok || !extremesRes.ok) {
        throw new AppError(
            `Stormglass request failed (sea-level ${seaLevelRes.status}, extremes ${extremesRes.status})`,
            502,
        );
    }

    const seaLevelBody = (await seaLevelRes.json()) as StormglassSeaLevelResponse;
    const extremesBody = (await extremesRes.json()) as StormglassExtremesResponse;

    const seaLevelPoint = seaLevelBody.data?.[0];
    if (!seaLevelPoint || typeof seaLevelPoint.sg !== "number") {
        throw new AppError("Stormglass returned malformed sea-level data", 502);
    }

    const nextExtreme = Array.isArray(extremesBody.data) ? extremesBody.data[0] : undefined;

    return {
        seaLevelM: seaLevelPoint.sg,
        nextExtremeAt: nextExtreme ? new Date(nextExtreme.time) : null,
        nextExtremeType: nextExtreme ? nextExtreme.type : null,
    };
}

// Placeholder thresholds -- not calibrated against real Cordova flood-stage
// data yet. Retune once MDRRMO/PAGASA figures are available.
function deriveFloodRiskLevel(seaLevelM: number): "normal" | "watch" | "warning" {
    if (seaLevelM > 1.0) return "warning";
    if (seaLevelM > 0.6) return "watch";
    return "normal";
}

async function refreshTideStatus(): Promise<void> {
    const existing = await prisma.tideStatus.findUnique({ where: { id: "current" } });
    if (existing && Date.now() - existing.updatedAt.getTime() < FRESHNESS_WINDOW_MS) {
        return;
    }

    const { seaLevelM, nextExtremeAt, nextExtremeType } = await fetchFromStormglass();
    const floodRiskLevel = deriveFloodRiskLevel(seaLevelM);
    const fetchedAt = new Date();

    await prisma.tideStatus.upsert({
        where: { id: "current" },
        create: {
            id: "current",
            seaLevelM,
            nextExtremeAt,
            nextExtremeType,
            floodRiskLevel,
            fetchedAt,
        },
        update: {
            seaLevelM,
            nextExtremeAt,
            nextExtremeType,
            floodRiskLevel,
            fetchedAt,
        },
    });
}

async function getLatest(): Promise<{
    seaLevelM: number;
    nextExtremeAt: Date | null;
    nextExtremeType: string | null;
    floodRiskLevel: string;
    updatedAt: Date;
}> {
    const row = await prisma.tideStatus.findUnique({ where: { id: "current" } });
    if (!row) {
        throw new AppError("Tide data not yet available", 503);
    }

    return {
        seaLevelM: row.seaLevelM,
        nextExtremeAt: row.nextExtremeAt,
        nextExtremeType: row.nextExtremeType,
        floodRiskLevel: row.floodRiskLevel,
        updatedAt: row.updatedAt,
    };
}

export const tideService = { refreshTideStatus, getLatest };
