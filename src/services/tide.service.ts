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

// NOTE: unlike tide/sea-level/point and tide/extremes/point (which nest
// readings under a "data" array), weather/point nests readings under an
// "hours" array -- confirmed against the live response (see Task 2 Step 1).
type StormglassWeatherResponse = {
    hours: {
        time: string;
        airTemperature: { sg: number };
        cloudCover: { sg: number };
        precipitation: { sg: number };
    }[];
};

// Response shapes per Stormglass v2 docs (tide/sea-level/point,
// tide/extremes/point, weather/point). If your account returns a different
// source key than "sg" for any parameter, adjust the extraction below after
// checking the raw response (see this task's Step 1).
async function fetchFromStormglass(): Promise<{
    seaLevelM: number;
    nextExtremeAt: Date | null;
    nextExtremeType: "high" | "low" | null;
    airTemperatureC: number;
    cloudCoverPct: number;
    precipitationMm: number;
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
    const weatherUrl =
        `${STORMGLASS_BASE_URL}/weather/point` +
        `?lat=${CORDOVA_CENTER.latitude}&lng=${CORDOVA_CENTER.longitude}` +
        `&start=${now.toISOString()}&end=${oneHourOut.toISOString()}` +
        `&params=airTemperature,cloudCover,precipitation`;

    const [seaLevelRes, extremesRes, weatherRes] = await Promise.all([
        fetch(seaLevelUrl, { headers, signal: AbortSignal.timeout(15_000) }),
        fetch(extremesUrl, { headers, signal: AbortSignal.timeout(15_000) }),
        fetch(weatherUrl, { headers, signal: AbortSignal.timeout(15_000) }),
    ]);

    if (!seaLevelRes.ok || !extremesRes.ok || !weatherRes.ok) {
        throw new AppError(
            `Stormglass request failed (sea-level ${seaLevelRes.status}, extremes ${extremesRes.status}, weather ${weatherRes.status})`,
            502,
        );
    }

    const seaLevelBody = (await seaLevelRes.json()) as StormglassSeaLevelResponse;
    const extremesBody = (await extremesRes.json()) as StormglassExtremesResponse;
    const weatherBody = (await weatherRes.json()) as StormglassWeatherResponse;

    const seaLevelPoint = seaLevelBody.data?.[0];
    if (!seaLevelPoint || typeof seaLevelPoint.sg !== "number") {
        throw new AppError("Stormglass returned malformed sea-level data", 502);
    }

    const weatherPoint = weatherBody.hours?.[0];
    if (
        !weatherPoint ||
        typeof weatherPoint.airTemperature?.sg !== "number" ||
        typeof weatherPoint.cloudCover?.sg !== "number" ||
        typeof weatherPoint.precipitation?.sg !== "number"
    ) {
        throw new AppError("Stormglass returned malformed weather data", 502);
    }

    const nextExtreme = Array.isArray(extremesBody.data) ? extremesBody.data[0] : undefined;

    return {
        seaLevelM: seaLevelPoint.sg,
        nextExtremeAt: nextExtreme ? new Date(nextExtreme.time) : null,
        nextExtremeType: nextExtreme ? nextExtreme.type : null,
        airTemperatureC: weatherPoint.airTemperature.sg,
        cloudCoverPct: weatherPoint.cloudCover.sg,
        precipitationMm: weatherPoint.precipitation.sg,
    };
}

// Placeholder thresholds -- not calibrated against real Cordova flood-stage
// data yet. Retune once MDRRMO/PAGASA figures are available.
function deriveFloodRiskLevel(seaLevelM: number): "normal" | "watch" | "warning" {
    if (seaLevelM > 1.0) return "warning";
    if (seaLevelM > 0.6) return "watch";
    return "normal";
}

// Placeholder thresholds -- not calibrated against real conditions. Retune
// once real weather-condition data is available to compare against.
function deriveWeatherDescription(cloudCoverPct: number, precipitationMm: number): string {
    if (precipitationMm > 4) return "Heavy rain";
    if (precipitationMm > 0.5) return "Light rain";
    if (cloudCoverPct > 70) return "Cloudy";
    if (cloudCoverPct > 30) return "Partly cloudy";
    return "Clear skies";
}

async function refreshTideStatus(): Promise<void> {
    const existing = await prisma.tideStatus.findUnique({ where: { id: "current" } });
    if (existing && Date.now() - existing.updatedAt.getTime() < FRESHNESS_WINDOW_MS) {
        return;
    }

    const { seaLevelM, nextExtremeAt, nextExtremeType, airTemperatureC, cloudCoverPct, precipitationMm } =
        await fetchFromStormglass();
    const floodRiskLevel = deriveFloodRiskLevel(seaLevelM);
    const weatherDescription = deriveWeatherDescription(cloudCoverPct, precipitationMm);
    const fetchedAt = new Date();

    await prisma.tideStatus.upsert({
        where: { id: "current" },
        create: {
            id: "current",
            seaLevelM,
            nextExtremeAt,
            nextExtremeType,
            floodRiskLevel,
            airTemperatureC,
            weatherDescription,
            fetchedAt,
        },
        update: {
            seaLevelM,
            nextExtremeAt,
            nextExtremeType,
            floodRiskLevel,
            airTemperatureC,
            weatherDescription,
            fetchedAt,
        },
    });
}

async function getLatest(): Promise<{
    seaLevelM: number;
    nextExtremeAt: Date | null;
    nextExtremeType: string | null;
    floodRiskLevel: string;
    airTemperatureC: number;
    weatherDescription: string;
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
        airTemperatureC: row.airTemperatureC,
        weatherDescription: row.weatherDescription,
        updatedAt: row.updatedAt,
    };
}

export const tideService = { refreshTideStatus, getLatest };
