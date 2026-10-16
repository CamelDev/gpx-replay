import {
  GpxTrackData,
  InterpolatedFrame,
  RawTrackPoint,
  TrackPoint,
  TrimRange,
} from '../types/gpx';

const EARTH_RADIUS_KM = 6371.0088;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Calculates great-circle distance between two coordinates in kilometers.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Calculates initial compass bearing (0..360) from point 1 to point 2.
 */
export function calculateBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (toDegrees(θ) + 360) % 360;
}

/**
 * Shortest-arc angular interpolation between two bearings in degrees.
 */
export function interpolateBearingDeg(b1: number, b2: number, t: number): number {
  const diff = ((((b2 - b1) % 360) + 540) % 360) - 180;
  return (b1 + diff * t + 360) % 360;
}

function extractNumericTagValue(parent: Element, localNames: string[]): number | undefined {
  const children = parent.getElementsByTagName('*');
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const local = (el.localName || el.tagName.split(':').pop() || '').toLowerCase();
    if (localNames.includes(local)) {
      const val = parseFloat(el.textContent?.trim() || '');
      if (!Number.isNaN(val)) {
        return val;
      }
    }
  }
  return undefined;
}

/**
 * Parses a GPX XML string into enriched GpxTrackData.
 */
export function parseGpxXml(xmlString: string, fallbackName = 'Uploaded Ride'): GpxTrackData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Invalid GPX XML file format.');
  }

  const nameNode =
    doc.querySelector('trk > name') ||
    doc.querySelector('rte > name') ||
    doc.querySelector('metadata > name');
  const trackName = nameNode?.textContent?.trim() || fallbackName;

  let ptElements = Array.from(doc.getElementsByTagName('trkpt'));
  if (ptElements.length === 0) {
    ptElements = Array.from(doc.getElementsByTagName('rtept'));
  }
  if (ptElements.length === 0) {
    ptElements = Array.from(doc.getElementsByTagName('wpt'));
  }

  if (ptElements.length < 2) {
    throw new Error('GPX file must contain at least 2 track points.');
  }

  const rawPoints: RawTrackPoint[] = [];
  let validTimestampCount = 0;

  for (let i = 0; i < ptElements.length; i++) {
    const pt = ptElements[i];
    const lat = parseFloat(pt.getAttribute('lat') || '');
    const lon = parseFloat(pt.getAttribute('lon') || '');
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

    const eleNode = pt.getElementsByTagName('ele')[0];
    const ele = eleNode ? parseFloat(eleNode.textContent?.trim() || '0') : 0;

    const timeNode = pt.getElementsByTagName('time')[0];
    let timeMs = NaN;
    if (timeNode?.textContent) {
      timeMs = Date.parse(timeNode.textContent.trim());
      if (!Number.isNaN(timeMs)) {
        validTimestampCount++;
      }
    }

    const extensionsNode = pt.getElementsByTagName('extensions')[0];
    let heartRate: number | undefined;
    let cadence: number | undefined;
    let power: number | undefined;
    let temperature: number | undefined;

    if (extensionsNode) {
      heartRate = extractNumericTagValue(extensionsNode, ['hr', 'heartrate', 'heart_rate']);
      cadence = extractNumericTagValue(extensionsNode, ['cad', 'cadence']);
      power = extractNumericTagValue(extensionsNode, ['power', 'watts', 'pwr']);
      temperature = extractNumericTagValue(extensionsNode, ['atemp', 'temp', 'temperature']);
    }

    rawPoints.push({
      index: rawPoints.length,
      lat,
      lon,
      ele: Number.isNaN(ele) ? 0 : ele,
      timeMs,
      heartRate,
      cadence,
      power,
      temperature,
    });
  }

  if (rawPoints.length < 2) {
    throw new Error('Not enough valid coordinate points found in GPX file.');
  }

  const hasTimestamps = validTimestampCount >= rawPoints.length * 0.5;

  // Fill or synthesize timestamps if missing or partially missing
  if (!hasTimestamps) {
    const syntheticStartMs = Date.UTC(2026, 6, 15, 7, 0, 0);
    let currentMs = syntheticStartMs;
    rawPoints[0].timeMs = currentMs;

    for (let i = 1; i < rawPoints.length; i++) {
      const prev = rawPoints[i - 1];
      const curr = rawPoints[i];
      const distKm = haversineDistanceKm(prev.lat, prev.lon, curr.lat, curr.lon);
      const dEleM = curr.ele - prev.ele;
      const grade = distKm > 0.001 ? (dEleM / (distKm * 1000)) * 100 : 0;
      // Synthetic cycling speed: ~28 km/h flat, slower uphill, faster downhill
      const syntheticSpeedKmh = Math.max(8, Math.min(62, 28 - grade * 1.8));
      const dtSec = distKm > 0 ? (distKm / syntheticSpeedKmh) * 3600 : 1;
      currentMs += Math.max(1000, Math.round(dtSec * 1000));
      curr.timeMs = currentMs;
    }
  } else {
    // Ensure monotonic timestamps even if GPS log has identical/missing timestamps on a few points
    let lastValidMs = !Number.isNaN(rawPoints[0].timeMs) ? rawPoints[0].timeMs : Date.now();
    rawPoints[0].timeMs = lastValidMs;
    for (let i = 1; i < rawPoints.length; i++) {
      if (Number.isNaN(rawPoints[i].timeMs) || rawPoints[i].timeMs <= lastValidMs) {
        rawPoints[i].timeMs = lastValidMs + 1000;
      }
      lastValidMs = rawPoints[i].timeMs;
    }
  }

  const enrichedPoints = computePointMetrics(rawPoints);
  const fullTrim: TrimRange = {
    startIndex: 0,
    endIndex: enrichedPoints.length - 1,
  };

  return buildTrackData(trackName, enrichedPoints, fullTrim, hasTimestamps);
}

/**
 * Computes distance, speed, smoothed speed, grade, elevation gain, and bearing across raw points.
 */
export function computePointMetrics(rawPoints: RawTrackPoint[]): TrackPoint[] {
  const n = rawPoints.length;
  const points: TrackPoint[] = [];
  const startTimeMs = rawPoints[0].timeMs;

  let cumulativeDistKm = 0;
  let cumulativeEleGainM = 0;
  let lastReferenceEle = rawPoints[0].ele;
  let lastValidBearing = 0;

  // First pass: distance, instant speed, cumulative elevation gain, bearing
  for (let i = 0; i < n; i++) {
    const curr = rawPoints[i];
    const elapsedSec = Math.max(0, (curr.timeMs - startTimeMs) / 1000);

    let segDistKm = 0;
    let instantSpeedKmh = 0;
    let bearingDeg = lastValidBearing;

    if (i > 0) {
      const prev = rawPoints[i - 1];
      segDistKm = haversineDistanceKm(prev.lat, prev.lon, curr.lat, curr.lon);
      cumulativeDistKm += segDistKm;

      const dtSec = (curr.timeMs - prev.timeMs) / 1000;
      if (dtSec > 0) {
        instantSpeedKmh = Math.min(130, (segDistKm / dtSec) * 3600);
      }

      if (segDistKm > 0.0005) {
        bearingDeg = calculateBearingDeg(prev.lat, prev.lon, curr.lat, curr.lon);
        lastValidBearing = bearingDeg;
      }

      // Elevation hysteresis threshold (1.2m) to avoid GPS vertical jitter inflating gain
      const eleDiff = curr.ele - lastReferenceEle;
      if (eleDiff >= 1.2) {
        cumulativeEleGainM += eleDiff;
        lastReferenceEle = curr.ele;
      } else if (eleDiff <= -1.2) {
        lastReferenceEle = curr.ele;
      }
    } else if (n > 1) {
      bearingDeg = calculateBearingDeg(curr.lat, curr.lon, rawPoints[1].lat, rawPoints[1].lon);
      lastValidBearing = bearingDeg;
    }

    points.push({
      ...curr,
      index: i,
      elapsedSec,
      distanceKm: cumulativeDistKm,
      segmentDistanceKm: segDistKm,
      instantSpeedKmh,
      smoothedSpeedKmh: instantSpeedKmh,
      gradePct: 0,
      elevationGainM: cumulativeEleGainM,
      bearingDeg,
    });
  }

  // Second pass: smoothed speed (5-point rolling window) and smoothed grade %
  for (let i = 0; i < n; i++) {
    const winStart = Math.max(0, i - 2);
    const winEnd = Math.min(n - 1, i + 2);
    const dDistKm = points[winEnd].distanceKm - points[winStart].distanceKm;
    const dtSec = points[winEnd].elapsedSec - points[winStart].elapsedSec;

    if (dtSec > 0 && dDistKm >= 0) {
      points[i].smoothedSpeedKmh = Math.min(130, (dDistKm / dtSec) * 3600);
    } else {
      points[i].smoothedSpeedKmh = points[i].instantSpeedKmh;
    }

    // Look back/ahead at least 20 meters for stable road gradient calculation
    let gStart = i;
    while (gStart > 0 && points[i].distanceKm - points[gStart].distanceKm < 0.015) {
      gStart--;
    }
    let gEnd = i;
    while (gEnd < n - 1 && points[gEnd].distanceKm - points[i].distanceKm < 0.015) {
      gEnd++;
    }
    const horizDistM = (points[gEnd].distanceKm - points[gStart].distanceKm) * 1000;
    if (horizDistM >= 8) {
      const rawGrade = ((points[gEnd].ele - points[gStart].ele) / horizDistM) * 100;
      points[i].gradePct = Math.max(-35, Math.min(35, rawGrade));
    } else {
      points[i].gradePct = i > 0 ? points[i - 1].gradePct : 0;
    }
  }

  return points;
}

/**
 * Slices and rebases a GPX track to the selected TrimRange so distance, elapsed time, and elevation gain start at 0.
 */
export function applyTrimToTrack(track: GpxTrackData, trimRange: TrimRange): GpxTrackData {
  return buildTrackData(track.name, track.rawPoints, trimRange, track.hasTimestamps);
}

function buildTrackData(
  name: string,
  rawPoints: TrackPoint[],
  trimRange: TrimRange,
  hasTimestamps: boolean
): GpxTrackData {
  const clampedStart = Math.max(0, Math.min(trimRange.startIndex, rawPoints.length - 2));
  const clampedEnd = Math.max(clampedStart + 1, Math.min(trimRange.endIndex, rawPoints.length - 1));

  const basePoint = rawPoints[clampedStart];
  const sliced: TrackPoint[] = [];

  let minEle = Infinity;
  let maxEle = -Infinity;
  let maxSpeedKmh = 0;
  let movingDurationSec = 0;
  let totalElevationLossM = 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (let i = clampedStart; i <= clampedEnd; i++) {
    const p = rawPoints[i];
    const rebased: TrackPoint = {
      ...p,
      index: i - clampedStart,
      elapsedSec: Math.max(0, p.elapsedSec - basePoint.elapsedSec),
      distanceKm: Math.max(0, p.distanceKm - basePoint.distanceKm),
      elevationGainM: Math.max(0, p.elevationGainM - basePoint.elevationGainM),
    };
    sliced.push(rebased);

    if (rebased.ele < minEle) minEle = rebased.ele;
    if (rebased.ele > maxEle) maxEle = rebased.ele;
    if (rebased.smoothedSpeedKmh > maxSpeedKmh) maxSpeedKmh = rebased.smoothedSpeedKmh;
    if (rebased.lat < minLat) minLat = rebased.lat;
    if (rebased.lat > maxLat) maxLat = rebased.lat;
    if (rebased.lon < minLon) minLon = rebased.lon;
    if (rebased.lon > maxLon) maxLon = rebased.lon;

    if (sliced.length > 1) {
      const prev = sliced[sliced.length - 2];
      const dt = rebased.elapsedSec - prev.elapsedSec;
      if (rebased.smoothedSpeedKmh > 1.5 && dt > 0 && dt < 300) {
        movingDurationSec += dt;
      }
      const dEle = rebased.ele - prev.ele;
      if (dEle < 0) {
        totalElevationLossM += Math.abs(dEle);
      }
    }
  }

  const lastPoint = sliced[sliced.length - 1];
  const totalDistanceKm = lastPoint.distanceKm;
  const totalDurationSec = Math.max(1, lastPoint.elapsedSec);
  const totalElevationGainM = lastPoint.elevationGainM;
  const avgSpeedKmh = totalDurationSec > 0 ? (totalDistanceKm / totalDurationSec) * 3600 : 0;

  const hasHeartRate = sliced.some((p) => typeof p.heartRate === 'number');
  const hasCadence = sliced.some((p) => typeof p.cadence === 'number');
  const hasPower = sliced.some((p) => typeof p.power === 'number');

  return {
    name,
    rawPoints,
    points: sliced,
    trimRange: { startIndex: clampedStart, endIndex: clampedEnd },
    totalDistanceKm,
    totalDurationSec,
    movingDurationSec: movingDurationSec > 0 ? movingDurationSec : totalDurationSec,
    totalElevationGainM,
    totalElevationLossM,
    minEle: Number.isFinite(minEle) ? minEle : 0,
    maxEle: Number.isFinite(maxEle) ? maxEle : 100,
    maxSpeedKmh,
    avgSpeedKmh,
    hasTimestamps,
    hasHeartRate,
    hasCadence,
    hasPower,
    bounds: {
      minLat,
      maxLat,
      minLon,
      maxLon,
    },
  };
}

/**
 * Binary-searches and linearly interpolates exact position and telemetry at `elapsedSec`
 * within the trimmed GPX track.
 */
export function interpolateAtElapsedSec(
  track: GpxTrackData,
  targetElapsedSec: number
): InterpolatedFrame {
  const pts = track.points;
  const n = pts.length;
  const clampedSec = Math.max(0, Math.min(targetElapsedSec, track.totalDurationSec));

  if (clampedSec <= 0 || n === 1) {
    const first = pts[0];
    return {
      lat: first.lat,
      lon: first.lon,
      ele: first.ele,
      elapsedSec: 0,
      timestampMs: first.timeMs,
      distanceKm: 0,
      speedKmh: first.smoothedSpeedKmh,
      gradePct: first.gradePct,
      elevationGainM: 0,
      bearingDeg: first.bearingDeg,
      progress: 0,
      distanceProgress: 0,
      currentPointIndex: 0,
      heartRate: first.heartRate,
      cadence: first.cadence,
      power: first.power,
      temperature: first.temperature,
    };
  }

  if (clampedSec >= track.totalDurationSec) {
    const last = pts[n - 1];
    return {
      lat: last.lat,
      lon: last.lon,
      ele: last.ele,
      elapsedSec: track.totalDurationSec,
      timestampMs: last.timeMs,
      distanceKm: track.totalDistanceKm,
      speedKmh: last.smoothedSpeedKmh,
      gradePct: last.gradePct,
      elevationGainM: track.totalElevationGainM,
      bearingDeg: last.bearingDeg,
      progress: 1,
      distanceProgress: 1,
      currentPointIndex: n - 1,
      heartRate: last.heartRate,
      cadence: last.cadence,
      power: last.power,
      temperature: last.temperature,
    };
  }

  // Binary search for segment [low, low + 1] containing clampedSec
  let low = 0;
  let high = n - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (pts[mid].elapsedSec <= clampedSec) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const p0 = pts[low];
  const p1 = pts[low + 1];
  const segmentDt = p1.elapsedSec - p0.elapsedSec;

  // If there's a long pause (e.g. coffee stop > 15s with very little movement), rider stays stationary
  const t = segmentDt > 0 ? Math.max(0, Math.min(1, (clampedSec - p0.elapsedSec) / segmentDt)) : 0;

  const lat = p0.lat + (p1.lat - p0.lat) * t;
  const lon = p0.lon + (p1.lon - p0.lon) * t;
  const ele = p0.ele + (p1.ele - p0.ele) * t;
  const distanceKm = p0.distanceKm + (p1.distanceKm - p0.distanceKm) * t;
  const speedKmh = p0.smoothedSpeedKmh + (p1.smoothedSpeedKmh - p0.smoothedSpeedKmh) * t;
  const gradePct = p0.gradePct + (p1.gradePct - p0.gradePct) * t;
  const elevationGainM = p0.elevationGainM + (p1.elevationGainM - p0.elevationGainM) * t;
  const bearingDeg = interpolateBearingDeg(p0.bearingDeg, p1.bearingDeg, t);

  const lerpOpt = (a?: number, b?: number) => {
    if (typeof a === 'number' && typeof b === 'number') return Math.round(a + (b - a) * t);
    return a ?? b;
  };

  return {
    lat,
    lon,
    ele,
    elapsedSec: clampedSec,
    timestampMs: p0.timeMs + (p1.timeMs - p0.timeMs) * t,
    distanceKm,
    speedKmh,
    gradePct,
    elevationGainM,
    bearingDeg,
    progress: track.totalDurationSec > 0 ? clampedSec / track.totalDurationSec : 0,
    distanceProgress: track.totalDistanceKm > 0 ? distanceKm / track.totalDistanceKm : 0,
    currentPointIndex: low,
    heartRate: lerpOpt(p0.heartRate, p1.heartRate),
    cadence: lerpOpt(p0.cadence, p1.cadence),
    power: lerpOpt(p0.power, p1.power),
    temperature: lerpOpt(p0.temperature, p1.temperature),
  };
}

export function formatDurationHms(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
