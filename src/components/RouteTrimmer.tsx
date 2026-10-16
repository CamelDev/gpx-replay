import React, { useMemo } from 'react';
import { Scissors, RotateCcw, Clock, Route, TrendingUp } from 'lucide-react';
import { GpxTrackData, SpeedMultiplier, TrimRange, UnitSystem } from '../types/gpx';
import { formatDurationHms } from '../utils/gpxParser';

interface RouteTrimmerProps {
  track: GpxTrackData;
  onTrimChange: (newTrim: TrimRange) => void;
  speedMultiplier: SpeedMultiplier;
  unitSystem: UnitSystem;
  disabled?: boolean;
}

export const RouteTrimmer: React.FC<RouteTrimmerProps> = ({
  track,
  onTrimChange,
  speedMultiplier,
  unitSystem,
  disabled = false,
}) => {
  const rawPts = track.rawPoints;
  const maxIndex = Math.max(1, rawPts.length - 1);
  const { startIndex, endIndex } = track.trimRange;
  const isTrimmed = startIndex > 0 || endIndex < maxIndex;

  const isImperial = unitSystem === 'imperial';
  const distVal = isImperial
    ? track.totalDistanceKm * 0.621371
    : track.totalDistanceKm;
  const distUnit = isImperial ? 'mi' : 'km';
  const eleGainVal = isImperial
    ? track.totalElevationGainM * 3.28084
    : track.totalElevationGainM;
  const eleUnit = isImperial ? 'ft' : 'm';

  const startPct = (startIndex / maxIndex) * 100;
  const endPct = (endIndex / maxIndex) * 100;

  // Build SVG path for raw elevation profile so user can visually trim climbs/descents
  const svgElevationPath = useMemo(() => {
    if (rawPts.length < 2) return '';
    let minE = Infinity;
    let maxE = -Infinity;
    for (const p of rawPts) {
      if (p.ele < minE) minE = p.ele;
      if (p.ele > maxE) maxE = p.ele;
    }
    const span = Math.max(10, maxE - minE);
    const step = Math.max(1, Math.floor(rawPts.length / 120));
    const coords: string[] = ['M 0 100'];

    for (let i = 0; i < rawPts.length; i += step) {
      const x = (i / maxIndex) * 100;
      const y = 92 - ((rawPts[i].ele - minE) / span) * 80;
      coords.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    const lastY = 92 - ((rawPts[maxIndex].ele - minE) / span) * 80;
    coords.push(`L 100 ${lastY.toFixed(2)}`);
    coords.push('L 100 100 Z');
    return coords.join(' ');
  }, [rawPts, maxIndex]);

  const handleStartChange = (val: number) => {
    const nextStart = Math.max(0, Math.min(val, endIndex - 1));
    onTrimChange({ startIndex: nextStart, endIndex });
  };

  const handleEndChange = (val: number) => {
    const nextEnd = Math.min(maxIndex, Math.max(val, startIndex + 1));
    onTrimChange({ startIndex, endIndex: nextEnd });
  };

  const videoDurationSec = track.totalDurationSec / speedMultiplier;

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-emerald-400" />
          <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
            Trim GPX Route
          </h2>
        </div>
        {isTrimmed && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onTrimChange({ startIndex: 0, endIndex: maxIndex })}
            className="flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-xs font-medium text-emerald-300 transition hover:bg-slate-700 disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            Reset Trim
          </button>
        )}
      </div>

      {/* Visual Elevation Range Preview */}
      <div className="relative h-16 w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950/90">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full"
        >
          <path d={svgElevationPath} fill="rgba(16, 185, 129, 0.28)" />
        </svg>

        {/* Dimmed cropped-out left region */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-slate-950/80 border-r-2 border-emerald-400"
          style={{ width: `${startPct}%` }}
        />

        {/* Dimmed cropped-out right region */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-slate-950/80 border-l-2 border-rose-400"
          style={{ width: `${100 - endPct}%` }}
        />

        <div className="pointer-events-none absolute inset-x-2 top-1.5 flex justify-between text-[10px] font-semibold text-slate-300">
          <span className="rounded bg-slate-900/90 px-1.5 py-0.5 text-emerald-300">
            Start: {formatDurationHms(rawPts[startIndex]?.elapsedSec || 0)}
          </span>
          <span className="rounded bg-slate-900/90 px-1.5 py-0.5 text-rose-300">
            End: {formatDurationHms(rawPts[endIndex]?.elapsedSec || 0)}
          </span>
        </div>
      </div>

      {/* Dual Range Sliders for Start & End Trim */}
      <div className="mt-3 space-y-2.5">
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-slate-400">Trim Start Point</span>
            <span className="font-mono text-emerald-300">
              Pt #{startIndex + 1} ({((startIndex / maxIndex) * 100).toFixed(0)}%)
            </span>
          </div>
          <input
            type="range"
            aria-label="Trim Start Point"
            min={0}
            max={maxIndex - 1}
            value={startIndex}
            disabled={disabled}
            onChange={(e) => handleStartChange(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-emerald-400 disabled:opacity-50"
          />
        </div>

        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-slate-400">Trim End Point</span>
            <span className="font-mono text-rose-300">
              Pt #{endIndex + 1} ({((endIndex / maxIndex) * 100).toFixed(0)}%)
            </span>
          </div>
          <input
            type="range"
            aria-label="Trim End Point"
            min={1}
            max={maxIndex}
            value={endIndex}
            disabled={disabled}
            onChange={(e) => handleEndChange(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-rose-400 disabled:opacity-50"
          />
        </div>
      </div>

      {/* Trimmed Segment Summary Metrics */}
      <div className="mt-3.5 grid grid-cols-3 gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5 text-center">
        <div>
          <div className="flex items-center justify-center gap-1 text-[10px] font-medium text-slate-400">
            <Route className="h-3 w-3 text-emerald-400" />
            DISTANCE
          </div>
          <div className="mt-0.5 text-xs font-bold text-slate-100">
            {distVal.toFixed(2)} {distUnit}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-center gap-1 text-[10px] font-medium text-slate-400">
            <TrendingUp className="h-3 w-3 text-sky-400" />
            ELEV GAIN
          </div>
          <div className="mt-0.5 text-xs font-bold text-slate-100">
            +{Math.round(eleGainVal)} {eleUnit}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-center gap-1 text-[10px] font-medium text-slate-400">
            <Clock className="h-3 w-3 text-amber-400" />
            RIDE TIME
          </div>
          <div className="mt-0.5 text-xs font-bold text-slate-100">
            {formatDurationHms(track.totalDurationSec)}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-slate-400">
        <span>Output Video @ {speedMultiplier}x speed:</span>
        <span className="font-mono font-semibold text-emerald-300">
          {formatDurationHms(videoDurationSec)} (1920×1080)
        </span>
      </div>
    </div>
  );
};
