export type SpeedMultiplier = 1 | 2 | 5 | 10;

export type CameraMode = 'follow' | 'overview';

export type MapStyleId = 'dark' | 'topo' | 'satellite' | 'street';

export type UnitSystem = 'metric' | 'imperial';

export type RouteColorMode = 'speed' | 'elevation' | 'solid';

export interface RawTrackPoint {
  index: number;
  lat: number;
  lon: number;
  ele: number;
  timeMs: number;
  heartRate?: number;
  cadence?: number;
  power?: number;
  temperature?: number;
}

export interface TrackPoint extends RawTrackPoint {
  elapsedSec: number;
  distanceKm: number;
  segmentDistanceKm: number;
  instantSpeedKmh: number;
  smoothedSpeedKmh: number;
  gradePct: number;
  elevationGainM: number;
  bearingDeg: number;
}

export interface TrimRange {
  startIndex: number;
  endIndex: number;
}

export interface GpxTrackData {
  name: string;
  rawPoints: TrackPoint[];
  points: TrackPoint[];
  trimRange: TrimRange;
  totalDistanceKm: number;
  totalDurationSec: number;
  movingDurationSec: number;
  totalElevationGainM: number;
  totalElevationLossM: number;
  minEle: number;
  maxEle: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  hasTimestamps: boolean;
  hasHeartRate: boolean;
  hasCadence: boolean;
  hasPower: boolean;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

export interface InterpolatedFrame {
  lat: number;
  lon: number;
  ele: number;
  elapsedSec: number;
  timestampMs: number;
  distanceKm: number;
  speedKmh: number;
  gradePct: number;
  elevationGainM: number;
  bearingDeg: number;
  progress: number; // 0..1 across trimmed track time
  distanceProgress: number; // 0..1 across trimmed track distance
  currentPointIndex: number;
  heartRate?: number;
  cadence?: number;
  power?: number;
  temperature?: number;
}

export interface HudConfig {
  showSpeed: boolean;
  showAltitude: boolean;
  showDistance: boolean;
  showTime: boolean;
  showElevationChart: boolean;
  showSensors: boolean;
  routeColorMode: RouteColorMode;
  unitSystem: UnitSystem;
  followZoom: number;
}
