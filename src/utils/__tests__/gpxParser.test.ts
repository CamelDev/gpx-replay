import { describe, expect, it } from 'vitest';
import {
  applyTrimToTrack,
  formatDurationHms,
  haversineDistanceKm,
  interpolateAtElapsedSec,
  parseGpxXml,
} from '../gpxParser';
import { generateSampleGpxXml } from '../sampleGpx';

describe('gpxParser & time interpolation engine', () => {
  it('parses the sample GPX with accurate timestamps, distance, elevation, and extensions', () => {
    const xml = generateSampleGpxXml();
    const track = parseGpxXml(xml);

    expect(track.name).toBe('Col du Galibier Summit Attack');
    expect(track.hasTimestamps).toBe(true);
    expect(track.points.length).toBe(180);
    // 180 points at 2s intervals = 179 * 2 = 358 seconds
    expect(track.totalDurationSec).toBe(358);
    expect(track.totalDistanceKm).toBeGreaterThan(2);
    expect(track.totalElevationGainM).toBeGreaterThan(100);
    expect(track.hasHeartRate).toBe(true);
    expect(track.hasCadence).toBe(true);
    expect(track.hasPower).toBe(true);
  });

  it('accurately trims a GPX track and rebases elapsed time, distance, and elevation gain to zero', () => {
    const xml = generateSampleGpxXml();
    const fullTrack = parseGpxXml(xml);

    const trimmed = applyTrimToTrack(fullTrack, {
      startIndex: 20,
      endIndex: 100,
    });

    expect(trimmed.points.length).toBe(81);
    expect(trimmed.points[0].elapsedSec).toBe(0);
    expect(trimmed.points[0].distanceKm).toBe(0);
    expect(trimmed.points[0].elevationGainM).toBe(0);
    // 80 intervals * 2s = 160s
    expect(trimmed.totalDurationSec).toBe(160);
    expect(trimmed.totalDistanceKm).toBeLessThan(fullTrack.totalDistanceKm);
  });

  it('interpolates intermediate coordinates and telemetry at 1x, 2x, 5x, and 10x time steps', () => {
    const xml = generateSampleGpxXml();
    const track = parseGpxXml(xml);

    // Midpoint between point 0 (0s) and point 1 (2s) -> t = 1.0s
    const midFrame = interpolateAtElapsedSec(track, 1.0);
    const p0 = track.points[0];
    const p1 = track.points[1];

    expect(midFrame.lat).toBeCloseTo((p0.lat + p1.lat) / 2, 6);
    expect(midFrame.lon).toBeCloseTo((p0.lon + p1.lon) / 2, 6);
    expect(midFrame.ele).toBeCloseTo((p0.ele + p1.ele) / 2, 4);
    expect(midFrame.elapsedSec).toBe(1.0);

    // Verify speed multipliers advance ride clock proportionally
    const wallSec = 10;
    const f1x = interpolateAtElapsedSec(track, wallSec * 1);
    const f2x = interpolateAtElapsedSec(track, wallSec * 2);
    const f5x = interpolateAtElapsedSec(track, wallSec * 5);
    const f10x = interpolateAtElapsedSec(track, wallSec * 10);

    expect(f1x.elapsedSec).toBe(10);
    expect(f2x.elapsedSec).toBe(20);
    expect(f5x.elapsedSec).toBe(50);
    expect(f10x.elapsedSec).toBe(100);
    expect(f10x.distanceKm).toBeGreaterThan(f5x.distanceKm);
    expect(f5x.distanceKm).toBeGreaterThan(f2x.distanceKm);
    expect(f2x.distanceKm).toBeGreaterThan(f1x.distanceKm);
  });

  it('synthesizes realistic timestamps when a GPX file lacks <time> tags', () => {
    const timelessGpx = `<?xml version="1.0"?>
      <gpx version="1.1">
        <trk>
          <name>Timeless Route</name>
          <trkseg>
            <trkpt lat="45.0000" lon="6.0000"><ele>1000</ele></trkpt>
            <trkpt lat="45.0050" lon="6.0050"><ele>1020</ele></trkpt>
            <trkpt lat="45.0100" lon="6.0100"><ele>1040</ele></trkpt>
          </trkseg>
        </trk>
      </gpx>`;

    const track = parseGpxXml(timelessGpx);
    expect(track.hasTimestamps).toBe(false);
    expect(track.totalDurationSec).toBeGreaterThan(0);
    expect(track.points[2].elapsedSec).toBeGreaterThan(track.points[1].elapsedSec);
  });

  it('formats durations and computes Haversine distance accurately', () => {
    expect(formatDurationHms(65)).toBe('01:05');
    expect(formatDurationHms(3661)).toBe('01:01:01');
    const d = haversineDistanceKm(45.0, 6.0, 45.01, 6.01);
    expect(d).toBeGreaterThan(1.2);
    expect(d).toBeLessThan(1.5);
  });
});
