import {
  GpxTrackData,
  HudConfig,
  InterpolatedFrame,
  SpeedMultiplier,
} from '../types/gpx';
import { formatDurationHms } from './gpxParser';

export type ProjectFn = (lon: number, lat: number) => { x: number; y: number };

export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.closePath();
}

function getSpeedColor(speedKmh: number, maxSpeedKmh: number): string {
  const ratio = Math.max(0, Math.min(1, speedKmh / Math.max(35, maxSpeedKmh)));
  if (ratio < 0.35) return '#38bdf8'; // sky-400 (climbing / slow)
  if (ratio < 0.65) return '#10b981'; // emerald-500 (cruising)
  if (ratio < 0.85) return '#f59e0b'; // amber-500 (fast)
  return '#f43f5e'; // rose-500 (sprint / descent)
}

function getElevationColor(ele: number, minEle: number, maxEle: number): string {
  const span = Math.max(10, maxEle - minEle);
  const ratio = Math.max(0, Math.min(1, (ele - minEle) / span));
  if (ratio < 0.33) return '#10b981';
  if (ratio < 0.66) return '#38bdf8';
  return '#a855f7';
}

function getGradeBadgeColor(gradePct: number): { bg: string; text: string } {
  if (gradePct >= 8) return { bg: 'rgba(244, 63, 94, 0.25)', text: '#fda4af' };
  if (gradePct >= 4) return { bg: 'rgba(245, 158, 11, 0.25)', text: '#fcd34d' };
  if (gradePct <= -5) return { bg: 'rgba(56, 189, 248, 0.25)', text: '#7dd3fc' };
  return { bg: 'rgba(16, 185, 129, 0.22)', text: '#6ee7b7' };
}

/**
 * Renders both the projected GPX route + animated rider marker AND the broadcast telemetry HUD
 * onto a 1920x1080 2D canvas context.
 */
export function renderRouteAndHud(
  ctx: CanvasRenderingContext2D,
  track: GpxTrackData,
  frame: InterpolatedFrame,
  hudConfig: HudConfig,
  speedMultiplier: SpeedMultiplier,
  project: ProjectFn
): void {
  const pts = track.points;
  if (pts.length === 0) return;

  ctx.save();

  // 1. Draw full trimmed route ghost path
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Dark outer casing for contrast on any map style
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = project(pts[i].lon, pts[i].lat);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)';
  ctx.lineWidth = 10;
  ctx.stroke();

  // Subtle inner ghost path for upcoming route
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 5;
  ctx.stroke();

  // 2. Draw completed route path up to current interpolated frame
  const activeIdx = Math.min(pts.length - 1, frame.currentPointIndex);
  const currentPos = project(frame.lon, frame.lat);

  // Outer glow along completed route
  ctx.beginPath();
  for (let i = 0; i <= activeIdx; i++) {
    const p = project(pts[i].lon, pts[i].lat);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(currentPos.x, currentPos.y);
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.32)';
  ctx.lineWidth = 14;
  ctx.stroke();

  if (hudConfig.routeColorMode === 'solid') {
    ctx.beginPath();
    for (let i = 0; i <= activeIdx; i++) {
      const p = project(pts[i].lon, pts[i].lat);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(currentPos.x, currentPos.y);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 6;
    ctx.stroke();
  } else {
    // Segment-by-segment coloring for speed or elevation
    ctx.lineWidth = 6;
    for (let i = 0; i <= activeIdx; i++) {
      const p0 = project(pts[i].lon, pts[i].lat);
      const p1 =
        i < activeIdx ? project(pts[i + 1].lon, pts[i + 1].lat) : currentPos;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle =
        hudConfig.routeColorMode === 'speed'
          ? getSpeedColor(pts[i].smoothedSpeedKmh, track.maxSpeedKmh)
          : getElevationColor(pts[i].ele, track.minEle, track.maxEle);
      ctx.stroke();
    }
  }

  // 3. Draw Start & Finish Markers
  const startScreen = project(pts[0].lon, pts[0].lat);
  const endScreen = project(pts[pts.length - 1].lon, pts[pts.length - 1].lat);

  // Start dot (emerald)
  ctx.beginPath();
  ctx.arc(startScreen.x, startScreen.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#10b981';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Finish checkered/target dot (rose)
  ctx.beginPath();
  ctx.arc(endScreen.x, endScreen.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#f43f5e';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // 4. Draw Current Rider Marker with directional heading indicator
  ctx.save();
  ctx.translate(currentPos.x, currentPos.y);

  // Outer pulse halo
  const haloGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, 26);
  haloGrad.addColorStop(0, 'rgba(16, 185, 129, 0.55)');
  haloGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fillStyle = haloGrad;
  ctx.fill();

  // Heading arrow
  const rad = ((frame.bearingDeg - 90) * Math.PI) / 180;
  ctx.save();
  ctx.rotate(rad);
  ctx.beginPath();
  ctx.moveTo(19, 0);
  ctx.lineTo(7, -7);
  ctx.lineTo(10, 0);
  ctx.lineTo(7, 7);
  ctx.closePath();
  ctx.fillStyle = '#34d399';
  ctx.fill();
  ctx.restore();

  // Rider center puck
  ctx.beginPath();
  ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
  ctx.fillStyle = '#10b981';
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();

  // 5. Render Telemetry HUD Overlay
  renderHudWidgets(ctx, track, frame, hudConfig, speedMultiplier);

  ctx.restore();
}

function renderHudWidgets(
  ctx: CanvasRenderingContext2D,
  track: GpxTrackData,
  frame: InterpolatedFrame,
  hudConfig: HudConfig,
  speedMultiplier: SpeedMultiplier
) {
  const isImperial = hudConfig.unitSystem === 'imperial';
  const speedVal = isImperial ? frame.speedKmh * 0.621371 : frame.speedKmh;
  const maxSpeedVal = isImperial ? track.maxSpeedKmh * 0.621371 : track.maxSpeedKmh;
  const avgSpeedVal = isImperial ? track.avgSpeedKmh * 0.621371 : track.avgSpeedKmh;
  const speedUnit = isImperial ? 'MPH' : 'KM/H';

  const eleVal = isImperial ? frame.ele * 3.28084 : frame.ele;
  const eleGainVal = isImperial ? frame.elevationGainM * 3.28084 : frame.elevationGainM;
  const eleUnit = isImperial ? 'FT' : 'M';

  const distVal = isImperial ? frame.distanceKm * 0.621371 : frame.distanceKm;
  const totalDistVal = isImperial ? track.totalDistanceKm * 0.621371 : track.totalDistanceKm;
  const distUnit = isImperial ? 'MI' : 'KM';

  // --- TOP LEFT: Track Title & Playback Multiplier Badge ---
  ctx.save();
  drawRoundedRect(ctx, 40, 36, 520, 74, 16);
  ctx.fillStyle = 'rgba(9, 13, 22, 0.82)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.stroke();

  // Speed multiplier pill
  drawRoundedRect(ctx, 56, 52, 68, 42, 10);
  ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
  ctx.stroke();

  ctx.fillStyle = '#34d399';
  ctx.font = '700 20px Inter, system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${speedMultiplier}x`, 90, 73);

  // Track Name & Ride Timestamp
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 21px Inter, system-ui, -apple-system, sans-serif';
  const truncatedTitle =
    track.name.length > 28 ? track.name.slice(0, 27) + '…' : track.name;
  ctx.fillText(truncatedTitle, 140, 62);

  const dateObj = new Date(frame.timestampMs);
  const timeClockStr = dateObj.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 14px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText(`GPS TELEMETRY • ${timeClockStr}`, 140, 88);
  ctx.restore();

  // --- TOP RIGHT: Primary Telemetry Cards Stack ---
  let cardY = 36;
  const cardX = VIDEO_WIDTH - 340;
  const cardW = 300;

  // 1) SPEED CARD
  if (hudConfig.showSpeed) {
    ctx.save();
    drawRoundedRect(ctx, cardX, cardY, cardW, 132, 18);
    ctx.fillStyle = 'rgba(9, 13, 22, 0.84)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText('LIVE SPEED', cardX + 22, cardY + 28);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#64748b';
    ctx.font = '600 12px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `AVG ${avgSpeedVal.toFixed(1)} • MAX ${maxSpeedVal.toFixed(1)}`,
      cardX + cardW - 22,
      cardY + 28
    );

    // Big Speed Readout
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 52px Inter, system-ui, -apple-system, sans-serif';
    const speedText = speedVal.toFixed(1);
    ctx.fillText(speedText, cardX + 22, cardY + 84);

    const speedWidth = ctx.measureText(speedText).width;
    ctx.fillStyle = '#34d399';
    ctx.font = '700 16px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText(speedUnit, cardX + 30 + speedWidth, cardY + 82);

    // Speed bar
    const barX = cardX + 22;
    const barY = cardY + 104;
    const barW = cardW - 44;
    drawRoundedRect(ctx, barX, barY, barW, 8, 4);
    ctx.fillStyle = 'rgba(51, 65, 85, 0.7)';
    ctx.fill();

    const fillRatio = Math.max(0.03, Math.min(1, speedVal / Math.max(10, maxSpeedVal)));
    drawRoundedRect(ctx, barX, barY, barW * fillRatio, 8, 4);
    ctx.fillStyle = getSpeedColor(frame.speedKmh, track.maxSpeedKmh);
    ctx.fill();

    ctx.restore();
    cardY += 148;
  }

  // 2) ALTITUDE & GRADE CARD
  if (hudConfig.showAltitude) {
    ctx.save();
    drawRoundedRect(ctx, cardX, cardY, cardW, 126, 18);
    ctx.fillStyle = 'rgba(9, 13, 22, 0.84)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText('ALTITUDE & GRADE', cardX + 22, cardY + 28);

    // Grade pill on top right of card
    const gradeStyle = getGradeBadgeColor(frame.gradePct);
    drawRoundedRect(ctx, cardX + cardW - 92, cardY + 14, 70, 26, 8);
    ctx.fillStyle = gradeStyle.bg;
    ctx.fill();
    ctx.fillStyle = gradeStyle.text;
    ctx.textAlign = 'center';
    ctx.font = '700 14px Inter, system-ui, -apple-system, sans-serif';
    const gradeSign = frame.gradePct > 0 ? '+' : '';
    ctx.fillText(`${gradeSign}${frame.gradePct.toFixed(1)}%`, cardX + cardW - 57, cardY + 31);

    // Altitude number
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 44px Inter, system-ui, -apple-system, sans-serif';
    const eleStr = Math.round(eleVal).toString();
    ctx.fillText(eleStr, cardX + 22, cardY + 78);

    const eleWidth = ctx.measureText(eleStr).width;
    ctx.fillStyle = '#38bdf8';
    ctx.font = '700 16px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText(eleUnit, cardX + 30 + eleWidth, cardY + 76);

    // Cumulative Elevation Gain
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `CLIMBED +${Math.round(eleGainVal)} ${eleUnit}  •  PEAK ${Math.round(
        isImperial ? track.maxEle * 3.28084 : track.maxEle
      )} ${eleUnit}`,
      cardX + 22,
      cardY + 106
    );

    ctx.restore();
    cardY += 142;
  }

  // 3) DISTANCE & RIDE TIME CARD
  if (hudConfig.showDistance || hudConfig.showTime) {
    ctx.save();
    drawRoundedRect(ctx, cardX, cardY, cardW, 118, 18);
    ctx.fillStyle = 'rgba(9, 13, 22, 0.84)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.stroke();

    if (hudConfig.showDistance) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText('DISTANCE', cardX + 22, cardY + 28);

      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 30px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText(`${distVal.toFixed(2)}`, cardX + 22, cardY + 64);

      ctx.fillStyle = '#64748b';
      ctx.font = '600 13px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText(`/ ${totalDistVal.toFixed(2)} ${distUnit}`, cardX + 22, cardY + 90);
    }

    if (hudConfig.showTime) {
      const colX = hudConfig.showDistance ? cardX + 158 : cardX + 22;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText('RIDE TIME', colX, cardY + 28);

      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 28px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText(formatDurationHms(frame.elapsedSec), colX, cardY + 64);

      ctx.fillStyle = '#34d399';
      ctx.font = '600 13px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText(`${Math.round(frame.progress * 100)}% COMPLETE`, colX, cardY + 90);
    }

    ctx.restore();
    cardY += 134;
  }

  // 4) SENSOR PILLS (Heart Rate, Cadence, Power)
  if (
    hudConfig.showSensors &&
    (typeof frame.heartRate === 'number' ||
      typeof frame.cadence === 'number' ||
      typeof frame.power === 'number')
  ) {
    ctx.save();
    drawRoundedRect(ctx, cardX, cardY, cardW, 82, 16);
    ctx.fillStyle = 'rgba(9, 13, 22, 0.84)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.stroke();

    const sensors: { label: string; value: string; unit: string; color: string }[] = [];
    if (typeof frame.heartRate === 'number') {
      sensors.push({
        label: 'HEART RATE',
        value: `${frame.heartRate}`,
        unit: 'BPM',
        color: '#fb7185',
      });
    }
    if (typeof frame.cadence === 'number') {
      sensors.push({
        label: 'CADENCE',
        value: `${frame.cadence}`,
        unit: 'RPM',
        color: '#38bdf8',
      });
    }
    if (typeof frame.power === 'number') {
      sensors.push({
        label: 'POWER',
        value: `${frame.power}`,
        unit: 'W',
        color: '#facc15',
      });
    }

    const colW = (cardW - 32) / Math.max(1, sensors.length);
    sensors.forEach((s, idx) => {
      const sx = cardX + 20 + idx * colW;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 10px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText(s.label, sx, cardY + 24);

      ctx.fillStyle = s.color;
      ctx.font = '800 24px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText(s.value, sx, cardY + 54);

      ctx.fillStyle = '#64748b';
      ctx.font = '600 11px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText(s.unit, sx, cardY + 70);
    });

    ctx.restore();
  }

  // --- BOTTOM: Live Synchronized Elevation Profile Ribbon ---
  if (hudConfig.showElevationChart && track.points.length > 1) {
    const chartX = 40;
    const chartY = VIDEO_HEIGHT - 166;
    const chartW = VIDEO_WIDTH - 80;
    const chartH = 130;

    ctx.save();
    drawRoundedRect(ctx, chartX, chartY, chartW, chartH, 18);
    ctx.fillStyle = 'rgba(9, 13, 22, 0.82)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.stroke();

    const innerX = chartX + 24;
    const innerY = chartY + 32;
    const innerW = chartW - 48;
    const innerH = chartH - 48;

    const minE = track.minEle;
    const maxE = Math.max(minE + 10, track.maxEle);
    const totalDist = Math.max(0.001, track.totalDistanceKm);

    const pts = track.points;
    const step = Math.max(1, Math.floor(pts.length / 360));

    // Full elevation contour path
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += step) {
      const px = innerX + (pts[i].distanceKm / totalDist) * innerW;
      const py = innerY + innerH - ((pts[i].ele - minE) / (maxE - minE)) * innerH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    const lastPt = pts[pts.length - 1];
    ctx.lineTo(
      innerX + innerW,
      innerY + innerH - ((lastPt.ele - minE) / (maxE - minE)) * innerH
    );

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Active completed elevation area fill
    const activeX = innerX + frame.distanceProgress * innerW;
    const activeY = innerY + innerH - ((frame.ele - minE) / (maxE - minE)) * innerH;

    ctx.save();
    ctx.beginPath();
    ctx.rect(innerX, innerY - 6, Math.max(0, activeX - innerX), innerH + 12);
    ctx.clip();

    ctx.beginPath();
    ctx.moveTo(innerX, innerY + innerH);
    for (let i = 0; i < pts.length; i += step) {
      const px = innerX + (pts[i].distanceKm / totalDist) * innerW;
      const py = innerY + innerH - ((pts[i].ele - minE) / (maxE - minE)) * innerH;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(
      innerX + innerW,
      innerY + innerH - ((lastPt.ele - minE) / (maxE - minE)) * innerH
    );
    ctx.lineTo(innerX + innerW, innerY + innerH);
    ctx.closePath();

    const areaGrad = ctx.createLinearGradient(0, innerY, 0, innerY + innerH);
    areaGrad.addColorStop(0, 'rgba(16, 185, 129, 0.48)');
    areaGrad.addColorStop(1, 'rgba(16, 185, 129, 0.04)');
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Highlighted top ridge line
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += step) {
      const px = innerX + (pts[i].distanceKm / totalDist) * innerW;
      const py = innerY + innerH - ((pts[i].ele - minE) / (maxE - minE)) * innerH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Current position vertical cursor + glowing dot on elevation chart
    ctx.beginPath();
    ctx.moveTo(activeX, innerY);
    ctx.lineTo(activeX, innerY + innerH);
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(activeX, activeY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Labels on Elevation Profile
    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 12px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `ELEVATION PROFILE (${Math.round(isImperial ? minE * 3.28084 : minE)} – ${Math.round(
        isImperial ? maxE * 3.28084 : maxE
      )} ${eleUnit})`,
      innerX,
      chartY + 20
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(
      `${distVal.toFixed(1)} / ${totalDistVal.toFixed(1)} ${distUnit}`,
      innerX + innerW,
      chartY + 20
    );

    ctx.restore();
  }
}
