import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Video,
  Navigation,
  Maximize2,
  Map as MapIcon,
  Gauge,
} from 'lucide-react';
import {
  CameraMode,
  HudConfig,
  MapStyleId,
  RouteColorMode,
  SpeedMultiplier,
  UnitSystem,
} from '../types/gpx';
import { formatDurationHms } from '../utils/gpxParser';
import { MAP_STYLE_OPTIONS } from '../utils/mapStyles';

const SPEED_MULTIPLIERS: SpeedMultiplier[] = [1, 2, 5, 10];

interface PlaybackControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  elapsedSec: number;
  totalDurationSec: number;
  onSeek: (newElapsedSec: number) => void;
  speedMultiplier: SpeedMultiplier;
  onSpeedMultiplierChange: (mult: SpeedMultiplier) => void;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
  effectiveZoom: number;
  onResetOverviewFit: () => void;
  mapStyleId: MapStyleId;
  onMapStyleChange: (style: MapStyleId) => void;
  hudConfig: HudConfig;
  onHudConfigChange: (next: HudConfig) => void;
  onStartExport: () => void;
  isExporting: boolean;
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  onTogglePlay,
  onRestart,
  elapsedSec,
  totalDurationSec,
  onSeek,
  speedMultiplier,
  onSpeedMultiplierChange,
  cameraMode,
  onCameraModeChange,
  effectiveZoom,
  onResetOverviewFit,
  mapStyleId,
  onMapStyleChange,
  hudConfig,
  onHudConfigChange,
  onStartExport,
  isExporting,
}) => {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-4 backdrop-blur-md">
      {/* Timeline Scrubber */}
      <div className="mb-4 flex items-center gap-3">
        <span className="w-16 font-mono text-xs font-semibold text-emerald-400">
          {formatDurationHms(elapsedSec)}
        </span>
        <input
          type="range"
          aria-label="Ride Timeline Scrubber"
          min={0}
          max={Math.max(1, totalDurationSec)}
          step={0.1}
          value={Math.min(elapsedSec, totalDurationSec)}
          disabled={isExporting}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-slate-800 accent-emerald-400 disabled:opacity-50"
        />
        <span className="w-16 text-right font-mono text-xs text-slate-400">
          {formatDurationHms(totalDurationSec)}
        </span>
      </div>

      {/* Main Transport + Speed Multiplier + Video Export Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Play / Pause / Restart & Accurate Speed Multipliers (1x, 2x, 5x, 10x) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isExporting}
            onClick={onTogglePlay}
            className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {isPlaying ? (
              <>
                <Pause className="h-4 w-4 fill-current" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" />
                Play Ride
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={onRestart}
            title="Restart from trimmed start"
            className="rounded-xl border border-slate-700/80 bg-slate-800/80 p-2.5 text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          {/* Speed Multiplier Selector: Strictly 1x, 2x, 5x, 10x */}
          <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950/80 p-1">
            <span className="px-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              Speed
            </span>
            {SPEED_MULTIPLIERS.map((mult) => {
              const active = speedMultiplier === mult;
              return (
                <button
                  key={mult}
                  type="button"
                  disabled={isExporting}
                  onClick={() => onSpeedMultiplierChange(mult)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    active
                      ? 'bg-emerald-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  x{mult}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center: Camera Mode & Map Style */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950/80 p-1">
            <button
              type="button"
              disabled={isExporting}
              onClick={() => onCameraModeChange('overview')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                cameraMode === 'overview'
                  ? 'bg-slate-800 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Overview
            </button>
            <button
              type="button"
              disabled={isExporting}
              onClick={() => onCameraModeChange('follow')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                cameraMode === 'follow'
                  ? 'bg-slate-800 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Navigation className="h-3.5 w-3.5" />
              Follow Rider
            </button>
          </div>

          {cameraMode === 'follow' ? (
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-2.5 py-1.5 text-xs">
              <span className="text-slate-400">Zoom</span>
              <input
                type="range"
                aria-label="Follow Rider Zoom Level"
                min={10}
                max={18}
                step={0.1}
                value={hudConfig.followZoom}
                disabled={isExporting}
                onChange={(e) =>
                  onHudConfigChange({
                    ...hudConfig,
                    followZoom: Number(e.target.value),
                  })
                }
                className="h-1.5 w-20 cursor-pointer appearance-none rounded bg-slate-800 accent-emerald-400"
              />
              <span className="w-10 text-right font-mono text-[11px] font-bold text-emerald-300">
                {hudConfig.followZoom.toFixed(1)}z
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-2.5 py-1.5 text-xs">
              <span className="text-slate-400">Zoom</span>
              <span className="font-mono text-[11px] font-bold text-emerald-300">
                {effectiveZoom.toFixed(1)}z
              </span>
              <button
                type="button"
                disabled={isExporting}
                onClick={onResetOverviewFit}
                title="Re-fit camera to full trimmed route bounds"
                className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 transition hover:bg-slate-700 hover:text-white disabled:opacity-50"
              >
                Auto-Fit
              </button>
            </div>
          )}

          {/* Map Style Selector */}
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 px-2.5 py-1.5">
            <MapIcon className="h-3.5 w-3.5 text-emerald-400" />
            <select
              aria-label="Map Style"
              value={mapStyleId}
              disabled={isExporting}
              onChange={(e) => onMapStyleChange(e.target.value as MapStyleId)}
              className="bg-transparent text-xs font-semibold text-slate-200 focus:outline-none"
            >
              {Object.values(MAP_STYLE_OPTIONS).map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-slate-900 text-slate-100">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right: Generate Full HD (1920x1080) Video Button */}
        <button
          type="button"
          disabled={isExporting}
          onClick={onStartExport}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-sky-500/15 transition hover:brightness-110 disabled:opacity-50"
        >
          <Video className="h-4 w-4" />
          Generate Full HD Video (1080p)
        </button>
      </div>

      {/* Bottom HUD Customization Strip */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1 font-semibold text-slate-400">
            <Gauge className="h-3.5 w-3.5 text-emerald-400" />
            HUD Overlays:
          </span>
          {(
            [
              ['showSpeed', 'Speed'],
              ['showAltitude', 'Altitude & Grade'],
              ['showDistance', 'Distance'],
              ['showTime', 'Ride Time'],
              ['showElevationChart', 'Elevation Chart'],
              ['showSensors', 'HR / Cadence / Power'],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-1.5 text-slate-300 select-none hover:text-white"
            >
              <input
                type="checkbox"
                checked={hudConfig[key]}
                onChange={(e) =>
                  onHudConfigChange({ ...hudConfig, [key]: e.target.checked })
                }
                className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0"
              />
              {label}
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Route Color Mode"
            value={hudConfig.routeColorMode}
            onChange={(e) =>
              onHudConfigChange({
                ...hudConfig,
                routeColorMode: e.target.value as RouteColorMode,
              })
            }
            className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs font-medium text-slate-300"
          >
            <option value="speed">Trail Color: By Speed</option>
            <option value="elevation">Trail Color: By Altitude</option>
            <option value="solid">Trail Color: Solid Emerald</option>
          </select>

          <button
            type="button"
            onClick={() =>
              onHudConfigChange({
                ...hudConfig,
                unitSystem:
                  hudConfig.unitSystem === 'metric'
                    ? ('imperial' as UnitSystem)
                    : ('metric' as UnitSystem),
              })
            }
            className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:text-white"
          >
            {hudConfig.unitSystem === 'metric' ? 'Metric (km/h, m)' : 'Imperial (mph, ft)'}
          </button>
        </div>
      </div>
    </div>
  );
};
