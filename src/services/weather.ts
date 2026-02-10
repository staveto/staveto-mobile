import AsyncStorage from "@react-native-async-storage/async-storage";

export type WeatherRiskLevel = "OK" | "RISK" | "PROBLEM";

export type DayRiskType = "NONE" | "RAIN" | "WIND" | "FROST" | "HEAT";

export type DailyWeatherRisk = {
  date: string;
  label: "DNES" | "ZAJTRA" | "POZAJTRA";
  tempMaxC: number | null;
  tempMinC: number | null;
  windMaxKmh: number | null;
  rainChancePercent: number;
  rainSumMm: number;
  type: DayRiskType;
  level: WeatherRiskLevel;
  badge: string;
};

export type ProjectWeatherSnapshot = {
  updatedAt: string;
  locationLabel: string;
  detailUrl: string;
  daily: DailyWeatherRisk[];
  temperatureC: number | null;
  windKmh: number | null;
  rainNowMm: number | null;
  rainChanceNext3h: number;
  rainChanceNext6h: number;
  rainTotalNext6h: number;
  level: WeatherRiskLevel;
  reason: string;
  recommendation: string;
};

type WeatherResult = {
  snapshot: ProjectWeatherSnapshot;
  fromCache: boolean;
  stale: boolean;
};

const WEATHER_TTL_MS = 60 * 60 * 1000; // 60 min

function cacheKey(projectId: string) {
  return `@staveto:weather:${projectId}`;
}

function toNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clampPercent(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function toFixedNumber(v: number, digits = 1): number {
  if (!Number.isFinite(v)) return 0;
  return Number(v.toFixed(digits));
}

function normalizeDailyEntry(input: any): DailyWeatherRisk | null {
  if (!input || typeof input !== "object") return null;
  const label = input.label === "ZAJTRA" || input.label === "POZAJTRA" ? input.label : "DNES";
  const type: DayRiskType =
    input.type === "RAIN" || input.type === "WIND" || input.type === "FROST" || input.type === "HEAT"
      ? input.type
      : "NONE";
  const level: WeatherRiskLevel = input.level === "PROBLEM" || input.level === "RISK" ? input.level : "OK";
  return {
    date: typeof input.date === "string" ? input.date : "",
    label,
    tempMaxC: toNumberOrNull(input.tempMaxC),
    tempMinC: toNumberOrNull(input.tempMinC),
    windMaxKmh: toNumberOrNull(input.windMaxKmh),
    rainChancePercent: clampPercent(typeof input.rainChancePercent === "number" ? input.rainChancePercent : 0),
    rainSumMm: toFixedNumber(typeof input.rainSumMm === "number" ? input.rainSumMm : 0),
    type,
    level,
    badge: typeof input.badge === "string" && input.badge.trim() ? input.badge : level === "OK" ? "OK" : "RIZIKO",
  };
}

function normalizeSnapshot(input: any): ProjectWeatherSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const locationLabel = typeof input.locationLabel === "string" ? input.locationLabel : "";
  if (!locationLabel) return null;
  const dailyRaw = Array.isArray(input.daily) ? input.daily : [];
  const parsedDaily = dailyRaw.map((entry) => normalizeDailyEntry(entry)).filter(Boolean) as DailyWeatherRisk[];
  const labels: Array<"DNES" | "ZAJTRA" | "POZAJTRA"> = ["DNES", "ZAJTRA", "POZAJTRA"];
  const daily: DailyWeatherRisk[] = labels.map((label, idx) => {
    return (
      parsedDaily[idx] ?? {
        date: "",
        label,
        tempMaxC: null,
        tempMinC: null,
        windMaxKmh: null,
        rainChancePercent: 0,
        rainSumMm: 0,
        type: "NONE",
        level: "OK",
        badge: "OK",
      }
    );
  });
  const detailUrl =
    typeof input.detailUrl === "string" && input.detailUrl.trim()
      ? input.detailUrl
      : `https://www.google.com/search?q=${encodeURIComponent(`počasie ${locationLabel}`)}`;

  return {
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
    locationLabel,
    detailUrl,
    daily,
    temperatureC: toNumberOrNull(input.temperatureC),
    windKmh: toNumberOrNull(input.windKmh),
    rainNowMm: toNumberOrNull(input.rainNowMm),
    rainChanceNext3h: clampPercent(typeof input.rainChanceNext3h === "number" ? input.rainChanceNext3h : 0),
    rainChanceNext6h: clampPercent(typeof input.rainChanceNext6h === "number" ? input.rainChanceNext6h : 0),
    rainTotalNext6h: toFixedNumber(typeof input.rainTotalNext6h === "number" ? input.rainTotalNext6h : 0),
    level: input.level === "PROBLEM" || input.level === "RISK" ? input.level : "OK",
    reason: typeof input.reason === "string" ? input.reason : "",
    recommendation: typeof input.recommendation === "string" ? input.recommendation : "",
  };
}

function computeRisk(input: {
  chance3h: number;
  chance6h: number;
  rain6h: number;
  rainNow: number | null;
  windKmh: number | null;
}): { level: WeatherRiskLevel; reason: string; recommendation: string } {
  const { chance3h, chance6h, rain6h, rainNow, windKmh } = input;

  if ((rainNow ?? 0) >= 0.6 || chance3h >= 70 || rain6h >= 3) {
    return {
      level: "PROBLEM",
      reason: "Vysoké riziko dažďa v najbližších hodinách.",
      recommendation: "Presuň práce vonku na neskôr a priprav krytie materiálu.",
    };
  }

  if (chance6h >= 40 || rain6h >= 1 || (windKmh ?? 0) >= 35) {
    return {
      level: "RISK",
      reason: "Počasie je nestabilné, môže prísť dážď alebo silnejší vietor.",
      recommendation: "Naplánuj práce flexibilne a priebežne kontroluj podmienky.",
    };
  }

  return {
    level: "OK",
    reason: "Bez výrazného rizika počasia na najbližšie hodiny.",
    recommendation: "Podmienky sú vhodné na plánované práce.",
  };
}

async function readCache(projectId: string): Promise<ProjectWeatherSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeSnapshot(parsed);
  } catch {
    return null;
  }
}

async function writeCache(projectId: string, snapshot: ProjectWeatherSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(projectId), JSON.stringify(snapshot));
  } catch {
    // ignore cache write errors
  }
}

async function geocodeAddress(addressText: string): Promise<{ lat: number; lon: number; label: string }> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    addressText
  )}&count=1&language=sk&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ latitude: number; longitude: number; name?: string; country?: string }>;
  };
  const first = data.results?.[0];
  if (!first) throw new Error("Lokalitu sa nepodarilo nájsť.");
  return {
    lat: first.latitude,
    lon: first.longitude,
    label: [first.name, first.country].filter(Boolean).join(", ") || addressText,
  };
}

function computeDayRisk(input: {
  rainChance: number;
  rainSum: number;
  windMax: number | null;
  tMin: number | null;
  tMax: number | null;
}): { type: DayRiskType; level: WeatherRiskLevel; badge: string } {
  const { rainChance, rainSum, windMax, tMin, tMax } = input;
  if ((tMin ?? 99) <= -2) return { type: "FROST", level: "PROBLEM", badge: "RIZIKO: MRÁZ" };
  if ((rainChance >= 70 && rainSum >= 2) || rainSum >= 4) return { type: "RAIN", level: "PROBLEM", badge: "POZOR: DÁŽĎ" };
  if ((windMax ?? 0) >= 45) return { type: "WIND", level: "PROBLEM", badge: "POZOR: VIETOR" };
  if ((tMax ?? -99) >= 33) return { type: "HEAT", level: "RISK", badge: "RIZIKO: TEPLO" };
  if (rainChance >= 45 || rainSum >= 1 || (windMax ?? 0) >= 30 || (tMin ?? 99) <= 0) {
    if ((tMin ?? 99) <= 0) return { type: "FROST", level: "RISK", badge: "RIZIKO: CHLAD" };
    if ((windMax ?? 0) >= 30) return { type: "WIND", level: "RISK", badge: "RIZIKO: VIETOR" };
    if (rainChance >= 45 || rainSum >= 1) return { type: "RAIN", level: "RISK", badge: "RIZIKO: DÁŽĎ" };
  }
  return { type: "NONE", level: "OK", badge: "OK" };
}

function indexFromTime(nowIso: string, times: string[]): number {
  const exact = times.indexOf(nowIso);
  if (exact >= 0) return exact;
  if (!times.length) return 0;
  const now = new Date(nowIso).getTime();
  let bestIdx = 0;
  let bestDelta = Number.MAX_SAFE_INTEGER;
  times.forEach((t, idx) => {
    const delta = Math.abs(new Date(t).getTime() - now);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

export async function getProjectWeatherRisk(
  projectId: string,
  addressText: string,
  opts?: { forceRefresh?: boolean }
): Promise<WeatherResult> {
  const normalizedAddress = addressText?.trim();
  if (!normalizedAddress) {
    throw new Error("Projekt nemá zadanú adresu.");
  }

  const cached = await readCache(projectId);
  if (!opts?.forceRefresh && cached) {
    const age = Date.now() - new Date(cached.updatedAt).getTime();
    if (Number.isFinite(age) && age < WEATHER_TTL_MS) {
      return { snapshot: cached, fromCache: true, stale: false };
    }
  }

  try {
    const location = await geocodeAddress(normalizedAddress);
    const forecastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}` +
      `&current=temperature_2m,rain,wind_speed_10m` +
      `&hourly=precipitation_probability,precipitation,temperature_2m,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max` +
      `&timezone=auto&forecast_days=3`;

    const res = await fetch(forecastUrl);
    if (!res.ok) throw new Error(`Forecast HTTP ${res.status}`);
    const data = (await res.json()) as {
      current?: { time?: string; temperature_2m?: number; rain?: number; wind_speed_10m?: number };
      hourly?: {
        time?: string[];
        precipitation_probability?: number[];
        precipitation?: number[];
        temperature_2m?: number[];
        wind_speed_10m?: number[];
      };
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
        precipitation_sum?: number[];
        wind_speed_10m_max?: number[];
      };
    };

    const currentTime = data.current?.time ?? new Date().toISOString();
    const times = data.hourly?.time ?? [];
    const probs = data.hourly?.precipitation_probability ?? [];
    const rain = data.hourly?.precipitation ?? [];
    const startIdx = indexFromTime(currentTime, times);
    const next3 = probs.slice(startIdx, startIdx + 3);
    const next6 = probs.slice(startIdx, startIdx + 6);
    const rain6 = rain.slice(startIdx, startIdx + 6);

    const rainChanceNext3h = clampPercent(Math.max(0, ...next3));
    const rainChanceNext6h = clampPercent(Math.max(0, ...next6));
    const rainTotalNext6h = Number(rain6.reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0).toFixed(1));
    const rainNowMm = toNumberOrNull(data.current?.rain);
    const windKmh = toNumberOrNull(data.current?.wind_speed_10m);
    const temperatureC = toNumberOrNull(data.current?.temperature_2m);
    const dailyTimes = data.daily?.time ?? [];
    const dailyMax = data.daily?.temperature_2m_max ?? [];
    const dailyMin = data.daily?.temperature_2m_min ?? [];
    const dailyRainChance = data.daily?.precipitation_probability_max ?? [];
    const dailyRainSum = data.daily?.precipitation_sum ?? [];
    const dailyWindMax = data.daily?.wind_speed_10m_max ?? [];

    const labels: Array<"DNES" | "ZAJTRA" | "POZAJTRA"> = ["DNES", "ZAJTRA", "POZAJTRA"];
    const daily: DailyWeatherRisk[] = labels.map((label, idx) => {
      const rainChance = clampPercent(dailyRainChance[idx] ?? 0);
      const rainSum = toFixedNumber(dailyRainSum[idx] ?? 0, 1);
      const tMax = toNumberOrNull(dailyMax[idx]);
      const tMin = toNumberOrNull(dailyMin[idx]);
      const windMax = toNumberOrNull(dailyWindMax[idx]);
      const risk = computeDayRisk({
        rainChance,
        rainSum,
        windMax,
        tMin,
        tMax,
      });
      return {
        date: dailyTimes[idx] ?? "",
        label,
        tempMaxC: tMax,
        tempMinC: tMin,
        windMaxKmh: windMax,
        rainChancePercent: rainChance,
        rainSumMm: rainSum,
        type: risk.type,
        level: risk.level,
        badge: risk.badge,
      };
    });

    const risk = computeRisk({
      chance3h: rainChanceNext3h,
      chance6h: rainChanceNext6h,
      rain6h: rainTotalNext6h,
      rainNow: rainNowMm,
      windKmh,
    });

    const snapshot: ProjectWeatherSnapshot = {
      updatedAt: new Date().toISOString(),
      locationLabel: location.label,
      detailUrl: `https://www.google.com/search?q=${encodeURIComponent(`počasie ${location.label}`)}`,
      daily,
      temperatureC,
      windKmh,
      rainNowMm,
      rainChanceNext3h,
      rainChanceNext6h,
      rainTotalNext6h,
      level: risk.level,
      reason: risk.reason,
      recommendation: risk.recommendation,
    };

    await writeCache(projectId, snapshot);
    return { snapshot, fromCache: false, stale: false };
  } catch (error) {
    if (cached) {
      return { snapshot: cached, fromCache: true, stale: true };
    }
    throw error;
  }
}
