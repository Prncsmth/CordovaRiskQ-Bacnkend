// src/services/tide.service.ts
import { CORDOVA_CENTER } from "@/constants/location";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { notificationService } from "@/services/notification.service";

const STORMGLASS_BASE_URL = "https://api.stormglass.io/v2";
const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";

// Skip a redundant Stormglass call if we already have a recent reading --
// guards against `tsx watch` restarting the server (and re-polling) on
// every file save during development, and against overlapping polls
// burning quota if a previous run is slow. startTidePolling() polls
// immediately on every server boot, and the tide poll interval is 8 hours
// (see tidePolling.ts), so this window is kept just under that: a
// restart within 7 hours of the last successful poll is free, while a
// restart after a longer gap, or the regular 8h scheduled tick, still
// triggers a real Stormglass call. Weather now comes from Open-Meteo
// (no comparable daily quota), so this guard only ever gates the tide half.
const TIDE_FRESHNESS_WINDOW_MS = 7 * 60 * 60 * 1000; // 7 hours

type StormglassSeaLevelResponse = {
    data: { time: string; sg: number }[];
};

type StormglassExtremesResponse = {
    data: { time: string; type: "high" | "low"; height: number }[];
};

// Response shapes per Stormglass v2 docs (tide/sea-level/point,
// tide/extremes/point). If your account returns a different source key
// than "sg" for any parameter, adjust the extraction below after checking
// the raw response.
async function fetchTideFromStormglass(): Promise<{
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

// Open-Meteo's free "current" block -- no API key, no daily-quota ceiling
// like Stormglass, so this can poll far more often (see tidePolling.ts).
type OpenMeteoCurrentResponse = {
    current?: {
        temperature_2m: number;
        cloud_cover: number;
        precipitation: number;
    };
};

async function fetchWeatherFromOpenMeteo(): Promise<{
    airTemperatureC: number;
    cloudCoverPct: number;
    precipitationMm: number;
}> {
    const url =
        `${OPEN_METEO_BASE_URL}?latitude=${CORDOVA_CENTER.latitude}&longitude=${CORDOVA_CENTER.longitude}` +
        `&current=temperature_2m,cloud_cover,precipitation`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
        throw new AppError(`Open-Meteo request failed (${res.status})`, 502);
    }

    const body = (await res.json()) as OpenMeteoCurrentResponse;
    const current = body.current;
    if (
        !current ||
        typeof current.temperature_2m !== "number" ||
        typeof current.cloud_cover !== "number" ||
        typeof current.precipitation !== "number"
    ) {
        throw new AppError("Open-Meteo returned malformed current-weather data", 502);
    }

    return {
        airTemperatureC: current.temperature_2m,
        cloudCoverPct: current.cloud_cover,
        precipitationMm: current.precipitation,
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

const RISK_SEVERITY: Record<string, number> = { normal: 0, watch: 1, warning: 2 };

const RISK_NOTIFICATION_COPY: Record<"watch" | "warning", { title: string; body: string }> = {
    watch: { title: "Flood risk: Watch", body: "Water levels are elevated — stay alert." },
    warning: {
        title: "Flood risk: Warning",
        body: "Flood risk in low-lying areas — avoid the causeway.",
    },
};

// Placeholder weather values for the (rare) case this creates the row
// before refreshWeather() ever has -- overwritten within one Open-Meteo
// poll interval, never user-facing in practice since both polls fire
// immediately on server boot.
const PLACEHOLDER_WEATHER = { airTemperatureC: 0, weatherDescription: "Weather unavailable" };

async function refreshTide(): Promise<void> {
    const existing = await prisma.tideStatus.findUnique({ where: { id: "current" } });
    if (existing && Date.now() - existing.fetchedAt.getTime() < TIDE_FRESHNESS_WINDOW_MS) {
        return;
    }

    const { seaLevelM, nextExtremeAt, nextExtremeType } = await fetchTideFromStormglass();
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
            ...PLACEHOLDER_WEATHER,
        },
        update: {
            seaLevelM,
            nextExtremeAt,
            nextExtremeType,
            floodRiskLevel,
            fetchedAt,
        },
    });

    const isEscalation =
        existing !== null && RISK_SEVERITY[floodRiskLevel] > RISK_SEVERITY[existing.floodRiskLevel];

    if (isEscalation && (floodRiskLevel === "watch" || floodRiskLevel === "warning")) {
        const copy = RISK_NOTIFICATION_COPY[floodRiskLevel];
        await notificationService.createForAllCitizens({
            type: "tide_risk",
            title: copy.title,
            body: copy.body,
        });
    }
}

// Placeholder tide values for the (rare) case this creates the row before
// refreshTide() ever has -- see refreshTide's PLACEHOLDER_WEATHER comment,
// same reasoning the other way around.
const PLACEHOLDER_TIDE = {
    seaLevelM: 0,
    nextExtremeAt: null,
    nextExtremeType: null,
    floodRiskLevel: "normal",
    fetchedAt: new Date(0),
};

async function refreshWeather(): Promise<void> {
    const { airTemperatureC, cloudCoverPct, precipitationMm } = await fetchWeatherFromOpenMeteo();
    const weatherDescription = deriveWeatherDescription(cloudCoverPct, precipitationMm);

    await prisma.tideStatus.upsert({
        where: { id: "current" },
        create: {
            id: "current",
            airTemperatureC,
            weatherDescription,
            ...PLACEHOLDER_TIDE,
        },
        update: {
            airTemperatureC,
            weatherDescription,
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

export const tideService = { refreshTide, refreshWeather, getLatest };
