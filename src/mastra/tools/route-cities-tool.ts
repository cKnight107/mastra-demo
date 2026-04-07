import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { chinaMajorCities, type MajorCity } from '../data/china-major-cities';

const routeCitySchema = z.object({
  city: z.string(),
  province: z.string(),
  progressPercent: z.number(),
  distanceToRouteKm: z.number(),
});

const inputSchema = z.object({
  origin: z.string().describe('出发城市，例如“郑州”'),
  destination: z.string().describe('目的地城市，例如“北京”'),
  maxCities: z.number().int().min(1).max(12).default(6).describe('最多返回多少个沿线主要城市'),
});

const outputSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  routeDistanceKm: z.number(),
  analysisMethod: z.string(),
  cities: z.array(routeCitySchema),
});

type Coordinate = {
  latitude: number;
  longitude: number;
};

type RouteCandidate = MajorCity & {
  progress: number;
  distanceToRouteKm: number;
  score: number;
};

const CHINESE_SUFFIXES = [
  '特别行政区',
  '维吾尔自治区',
  '壮族自治区',
  '回族自治区',
  '自治区',
  '省',
  '市',
  '地区',
  '盟',
] as const;

export const routeCitiesTool = createTool({
  id: 'route-cities-tool',
  description: '分析中国两座城市之间沿线可能经过的主要城市，并按路线顺序返回结果',
  inputSchema,
  outputSchema,
  execute: async ({ origin, destination, maxCities }) => {
    const originCity = findCity(origin);
    const destinationCity = findCity(destination);

    if (!originCity) {
      throw new Error(`暂不支持识别出发地“${origin}”。请改用常见中文城市名，例如“郑州”或“北京”。`);
    }

    if (!destinationCity) {
      throw new Error(`暂不支持识别目的地“${destination}”。请改用常见中文城市名，例如“上海”或“广州”。`);
    }

    if (originCity.name === destinationCity.name) {
      throw new Error('出发地和目的地不能相同。');
    }

    const routeDistanceKm = haversineKm(originCity, destinationCity);
    const cities = findRouteCities(originCity, destinationCity, maxCities, routeDistanceKm);

    return {
      origin: originCity.name,
      destination: destinationCity.name,
      routeDistanceKm: round(routeDistanceKm, 1),
      analysisMethod: '基于主要城市坐标与起终点连线走廊的近似分析，不等同于实时地图导航结果。',
      cities: cities.map(city => ({
        city: city.name,
        province: city.province,
        progressPercent: round(city.progress * 100, 1),
        distanceToRouteKm: round(city.distanceToRouteKm, 1),
      })),
    };
  },
});

function findRouteCities(origin: MajorCity, destination: MajorCity, limit: number, routeDistanceKm: number): RouteCandidate[] {
  const corridorWidthKm = clamp(routeDistanceKm * 0.12, 60, 160);
  const minEndpointDistanceKm = clamp(routeDistanceKm * 0.08, 25, 80);
  const progressGap = clamp((routeDistanceKm / Math.max(limit, 1)) * 0.4 / routeDistanceKm, 0.07, 0.18);

  const candidates = chinaMajorCities
    .filter(city => city.name !== origin.name && city.name !== destination.name)
    .map(city => {
      const metrics = getRouteMetrics(origin, destination, city);
      const distanceFromOrigin = haversineKm(origin, city);
      const distanceFromDestination = haversineKm(destination, city);
      const score = city.importance * 100 - metrics.distanceToRouteKm * 0.7 - Math.abs(metrics.progress - 0.5) * 8;

      return {
        ...city,
        progress: metrics.progress,
        distanceToRouteKm: metrics.distanceToRouteKm,
        score,
        distanceFromOrigin,
        distanceFromDestination,
      };
    })
    .filter(candidate =>
      candidate.progress > 0.04 &&
      candidate.progress < 0.96 &&
      candidate.distanceToRouteKm <= corridorWidthKm &&
      candidate.distanceFromOrigin >= minEndpointDistanceKm &&
      candidate.distanceFromDestination >= minEndpointDistanceKm,
    );

  const selected = selectSpacedCities(candidates, limit, progressGap);
  if (selected.length > 0) {
    return selected;
  }

  const fallback = chinaMajorCities
    .filter(city => city.name !== origin.name && city.name !== destination.name)
    .map(city => {
      const metrics = getRouteMetrics(origin, destination, city);
      return {
        ...city,
        progress: metrics.progress,
        distanceToRouteKm: metrics.distanceToRouteKm,
        score: city.importance * 100 - metrics.distanceToRouteKm * 0.9,
      };
    })
    .filter(candidate => candidate.progress > 0.05 && candidate.progress < 0.95)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .sort((left, right) => left.progress - right.progress);

  return fallback;
}

function selectSpacedCities(candidates: Array<RouteCandidate & {
  distanceFromOrigin: number;
  distanceFromDestination: number;
}>, limit: number, progressGap: number): RouteCandidate[] {
  const selected: RouteCandidate[] = [];

  const ranked = [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.distanceToRouteKm - right.distanceToRouteKm;
  });

  for (const candidate of ranked) {
    const tooClose = selected.some(selectedCity => Math.abs(selectedCity.progress - candidate.progress) < progressGap);
    if (tooClose) {
      continue;
    }

    selected.push(candidate);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected.sort((left, right) => left.progress - right.progress);
}

function findCity(input: string): MajorCity | undefined {
  const normalizedInput = normalizeCityName(input);
  return chinaMajorCities.find(city => {
    const aliases = city.aliases ?? [];
    return [city.name, ...aliases].some(name => normalizeCityName(name) === normalizedInput);
  });
}

function normalizeCityName(input: string): string {
  let normalized = input.trim().toLowerCase().replace(/\s+/g, '');
  for (const suffix of CHINESE_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length);
      break;
    }
  }
  return normalized;
}

function getRouteMetrics(origin: Coordinate, destination: Coordinate, city: Coordinate) {
  const averageLatitude = (origin.latitude + destination.latitude) / 2;
  const originPoint = toProjectedPoint(origin, averageLatitude);
  const destinationPoint = toProjectedPoint(destination, averageLatitude);
  const cityPoint = toProjectedPoint(city, averageLatitude);

  const segmentX = destinationPoint.x - originPoint.x;
  const segmentY = destinationPoint.y - originPoint.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (segmentLengthSquared === 0) {
    return { progress: 0, distanceToRouteKm: haversineKm(origin, city) };
  }

  const relativeX = cityPoint.x - originPoint.x;
  const relativeY = cityPoint.y - originPoint.y;
  const rawProgress = (relativeX * segmentX + relativeY * segmentY) / segmentLengthSquared;
  const progress = clamp(rawProgress, 0, 1);
  const projectionX = originPoint.x + segmentX * progress;
  const projectionY = originPoint.y + segmentY * progress;
  const distanceToRouteKm = Math.hypot(cityPoint.x - projectionX, cityPoint.y - projectionY);

  return { progress, distanceToRouteKm };
}

function toProjectedPoint(coordinate: Coordinate, referenceLatitude: number) {
  const latRad = (referenceLatitude * Math.PI) / 180;
  return {
    x: coordinate.longitude * 111.32 * Math.cos(latRad),
    y: coordinate.latitude * 110.574,
  };
}

function haversineKm(from: Coordinate, to: Coordinate): number {
  const earthRadiusKm = 6371;
  const lat1 = degreesToRadians(from.latitude);
  const lat2 = degreesToRadians(to.latitude);
  const deltaLat = degreesToRadians(to.latitude - from.latitude);
  const deltaLon = degreesToRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
