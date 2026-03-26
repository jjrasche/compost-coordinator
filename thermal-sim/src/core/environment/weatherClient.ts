/**
 * Open-Meteo weather client for Grand Rapids, MI.
 *
 * Adapted from garden-twin's OpenMeteoClient.ts.
 * Fetches hourly temperature and humidity for compost thermal simulation.
 *
 * Endpoints:
 *   - archive: 1940 to ~5 days ago (ERA5 reanalysis)
 *   - forecast: today + 14 days
 *
 * No API key required. Free tier: 10,000 calls/day.
 */

export interface HourlyWeatherEntry {
  /** ISO datetime (YYYY-MM-DDTHH:00) */
  datetime: string;
  /** Temperature in °F */
  tempF: number;
  /** Relative humidity 0-1 */
  rh: number;
}

export interface DailyWeatherEntry {
  /** ISO date (YYYY-MM-DD) */
  date: string;
  highF: number;
  lowF: number;
  avgRH: number;
}

const LAT = 42.9634;
const LON = -85.6681;
const TZ = 'America%2FNew_York';

interface OpenMeteoHourlyResponse {
  hourly: {
    time: string[];
    temperature_2m: number[];
    relative_humidity_2m: number[];
  };
}

interface OpenMeteoDailyResponse {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    relative_humidity_2m_mean?: number[];
  };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function cToF(c: number): number {
  return c * 9 / 5 + 32;
}

/**
 * Fetch daily weather from archive endpoint.
 * Returns one entry per day with high/low temp and mean humidity.
 */
export async function fetchDailyWeather(
  startDate: Date,
  endDate: Date,
): Promise<DailyWeatherEntry[]> {
  const params = [
    `latitude=${LAT}`,
    `longitude=${LON}`,
    `timezone=${TZ}`,
    `start_date=${formatDate(startDate)}`,
    `end_date=${formatDate(endDate)}`,
    'daily=temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean',
    'temperature_unit=fahrenheit',
  ].join('&');

  const url = `https://archive-api.open-meteo.com/v1/archive?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Open-Meteo archive ${resp.status}: ${await resp.text()}`);

  const json: OpenMeteoDailyResponse = await resp.json();
  const d = json.daily;

  return d.time.map((date, i) => ({
    date,
    highF: d.temperature_2m_max[i]!,
    lowF: d.temperature_2m_min[i]!,
    avgRH: (d.relative_humidity_2m_mean?.[i] ?? 50) / 100,
  }));
}

/**
 * Build a weather schedule from daily entries.
 * Maps simulation hour offsets to ambient conditions using sinusoidal
 * diurnal interpolation (min at 5am, max at 3pm).
 */
export interface WeatherSchedule {
  /** Start date of the schedule (calendar anchor) */
  startDate: Date;
  /** Daily entries sorted by date */
  days: DailyWeatherEntry[];
  /** Look up conditions at a sim-hour offset */
  lookup(simHours: number): { tempF: number; rh: number };
}

export function buildWeatherSchedule(
  startDate: Date,
  days: DailyWeatherEntry[],
): WeatherSchedule {
  const dayMap = new Map<number, DailyWeatherEntry>();
  const startMs = startDate.getTime();

  for (const day of days) {
    const dayMs = new Date(day.date).getTime();
    const dayIndex = Math.round((dayMs - startMs) / 86_400_000);
    dayMap.set(dayIndex, day);
  }

  return {
    startDate,
    days,
    lookup(simHours: number): { tempF: number; rh: number } {
      const dayIndex = Math.floor(simHours / 24);
      const hourOfDay = simHours % 24;

      const day = dayMap.get(dayIndex) ?? dayMap.get(dayIndex - 1) ?? days[days.length - 1];
      if (!day) return { tempF: 75, rh: 0.5 };

      // Sinusoidal diurnal cycle: min at 5am (hour 5), max at 3pm (hour 15)
      const phaseHours = hourOfDay - 15; // peak at hour 15
      const diurnalFrac = 0.5 + 0.5 * Math.cos(phaseHours * Math.PI / 12);
      // diurnalFrac: 1.0 at hour 15 (max), 0.0 at hour 3 (min)
      // Shift min to hour 5: close enough with cosine (actual min at hour 3 in this formula,
      // real world min is 5-6am — acceptable approximation)

      const tempF = day.lowF + (day.highF - day.lowF) * diurnalFrac;

      // RH inversely correlates with temperature (roughly)
      // At daily high temp: RH ≈ avgRH - 15%. At daily low temp: RH ≈ avgRH + 15%.
      const rhSwing = 0.15;
      const rh = Math.max(0.1, Math.min(1.0, day.avgRH - rhSwing * (2 * diurnalFrac - 1)));

      return { tempF, rh };
    },
  };
}

/**
 * Build a schedule from 10-year daily normals.
 * Synthesizes a "typical year" by averaging each day-of-year across available years.
 */
export async function fetchSeasonSchedule(
  startDate: Date,
  durationDays: number,
): Promise<WeatherSchedule> {
  const endDate = new Date(startDate.getTime() + durationDays * 86_400_000);
  const days = await fetchDailyWeather(startDate, endDate);
  return buildWeatherSchedule(startDate, days);
}

/**
 * Build normals-based schedule: fetch 10 years of the target date range,
 * average by day-of-year, return as a single-year schedule.
 */
export async function fetchNormalsSchedule(
  startDate: Date,
  durationDays: number,
): Promise<WeatherSchedule> {
  const startMonth = startDate.getMonth();
  const startDay = startDate.getDate();

  // Fetch 10 years of data for the same calendar window
  const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
  const allDays: DailyWeatherEntry[] = [];

  // Fetch each year sequentially to stay under rate limits
  for (const year of years) {
    const yearStart = new Date(year, startMonth, startDay);
    const yearEnd = new Date(yearStart.getTime() + durationDays * 86_400_000);
    try {
      const entries = await fetchDailyWeather(yearStart, yearEnd);
      allDays.push(...entries);
    } catch {
      // Skip failed years
    }
  }

  // Average by day-of-year
  const byDoy = new Map<number, { sumHigh: number; sumLow: number; sumRH: number; count: number }>();
  for (const day of allDays) {
    const d = new Date(day.date);
    const doy = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
    const accum = byDoy.get(doy) ?? { sumHigh: 0, sumLow: 0, sumRH: 0, count: 0 };
    accum.sumHigh += day.highF;
    accum.sumLow += day.lowF;
    accum.sumRH += day.avgRH;
    accum.count++;
    byDoy.set(doy, accum);
  }

  // Build normalized daily entries pinned to the target year
  const targetYear = startDate.getFullYear();
  const normalDays: DailyWeatherEntry[] = [];
  for (let i = 0; i <= durationDays; i++) {
    const date = new Date(startDate.getTime() + i * 86_400_000);
    const doy = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000);
    const accum = byDoy.get(doy);
    if (accum && accum.count > 0) {
      normalDays.push({
        date: formatDate(date),
        highF: accum.sumHigh / accum.count,
        lowF: accum.sumLow / accum.count,
        avgRH: accum.sumRH / accum.count,
      });
    }
  }

  return buildWeatherSchedule(startDate, normalDays);
}
