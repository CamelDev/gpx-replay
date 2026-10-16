/**
 * Generates a realistic Alpine pass cycling GPX track (Col du Galibier inspired climb + descent)
 * with accurate timestamps, elevation, cadence, heart rate, and power so users can immediately
 * test trimming, 1x/2x/5x/10x playback, and Full HD video export.
 */
export function generateSampleGpxXml(): string {
  const startLat = 45.0608;
  const startLon = 6.4072;
  const startEle = 1980;
  const startTimeMs = Date.UTC(2026, 6, 18, 8, 30, 0);

  const totalPoints = 180; // ~6 minutes of ride time (2s intervals) for snappy demo & video export
  let lat = startLat;
  let lon = startLon;
  let ele = startEle;
  let timeMs = startTimeMs;

  const trkpts: string[] = [];

  for (let i = 0; i < totalPoints; i++) {
    const progress = i / (totalPoints - 1);

    // Winding switchback road up the mountain pass for first 65%, then fast sweeping descent
    const switchbackFreq = progress < 0.65 ? 10 * Math.PI : 4 * Math.PI;
    const isClimbing = progress < 0.65;

    const dLat = isClimbing
      ? 0.00018 + 0.00006 * Math.cos(progress * switchbackFreq)
      : 0.00038 + 0.00012 * Math.cos(progress * switchbackFreq);
    const dLon = isClimbing
      ? 0.00024 * Math.sin(progress * switchbackFreq) + 0.00012
      : 0.00035 * Math.sin(progress * switchbackFreq) + 0.00025;

    if (i > 0) {
      lat += dLat;
      lon += dLon;
    }

    if (progress < 0.65) {
      // Climbing at ~6% to 9% grade
      ele += 1.45 + 0.45 * Math.sin(i * 0.25);
    } else if (progress < 0.7) {
      // Summit plateau around 2155m
      ele += 0.1 * Math.cos(i * 0.5);
    } else {
      // Fast descent
      ele -= 2.6 + 0.4 * Math.cos(i * 0.2);
    }

    const hr = isClimbing
      ? Math.round(162 + 14 * Math.sin(progress * Math.PI) + 3 * Math.sin(i * 0.4))
      : Math.round(135 - 15 * (progress - 0.65) + 2 * Math.cos(i * 0.3));
    const cad = isClimbing
      ? Math.round(78 + 8 * Math.cos(i * 0.3))
      : Math.round(92 + 10 * Math.sin(i * 0.4));
    const power = isClimbing
      ? Math.round(285 + 45 * Math.sin(i * 0.35))
      : Math.round(140 + 60 * Math.max(0, Math.cos(i * 0.5)));

    const isoTime = new Date(timeMs).toISOString();
    trkpts.push(
      `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">
        <ele>${ele.toFixed(1)}</ele>
        <time>${isoTime}</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>${hr}</gpxtpx:hr>
            <gpxtpx:cad>${cad}</gpxtpx:cad>
          </gpxtpx:TrackPointExtension>
          <power>${power}</power>
        </extensions>
      </trkpt>`
    );

    timeMs += 2000; // 2 seconds per GPS sample
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GPX Replay Studio" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata>
    <name>Col du Galibier Summit Attack</name>
  </metadata>
  <trk>
    <name>Col du Galibier Summit Attack</name>
    <trkseg>
${trkpts.join('\n')}
    </trkseg>
  </trk>
</gpx>`;
}
