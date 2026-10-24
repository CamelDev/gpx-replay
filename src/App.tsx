import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bike,
  CheckCircle2,
  Compass,
  Download,
  Film,
  Flame,
  Gauge,
  Heart,
  Mountain,
  Sparkles,
  Timer,
  X,
  Zap,
} from 'lucide-react';
import {
  CameraMode,
  GpxTrackData,
  HudConfig,
  MapStyleId,
  SpeedMultiplier,
  TrimRange,
} from './types/gpx';
import {
  applyTrimToTrack,
  formatDurationHms,
  interpolateAtElapsedSec,
  parseGpxXml,
} from './utils/gpxParser';
import { generateSampleGpxXml } from './utils/sampleGpx';
import { GpxUploader } from './components/GpxUploader';
import { RouteTrimmer } from './components/RouteTrimmer';
import { StageCanvas, StageCanvasHandle } from './components/StageCanvas';
import { PlaybackControls } from './components/PlaybackControls';
import {
  exportFullHdVideo,
  VIDEO_QUALITY_CONFIG,
  VIDEO_RESOLUTION_CONFIG,
  VideoExportProgress,
  VideoQualityPreset,
  VideoResolutionId,
} from './utils/videoExporter';

const EXPORT_FPS = 30;

export const App: React.FC = () => {
  const [track, setTrack] = useState<GpxTrackData>(() =>
    parseGpxXml(generateSampleGpxXml(), 'Col du Galibier Summit Attack')
  );
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState<SpeedMultiplier>(5);
  const [cameraMode, setCameraMode] = useState<CameraMode>('overview');
  const [mapStyleId, setMapStyleId] = useState<MapStyleId>('dark');
  const [effectiveZoom, setEffectiveZoom] = useState<number>(13.5);

  const [hudConfig, setHudConfig] = useState<HudConfig>({
    showSpeed: true,
    showAltitude: true,
    showDistance: true,
    showTime: true,
    showElevationChart: true,
    showSensors: true,
    routeColorMode: 'speed',
    unitSystem: 'metric',
    followZoom: 14.5,
  });

  // Video export state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportResolution, setExportResolution] =
    useState<VideoResolutionId>('1080p');
  const [exportQuality, setExportQuality] =
    useState<VideoQualityPreset>('high');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] =
    useState<VideoExportProgress | null>(null);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const [exportedFileExt, setExportedFileExt] = useState<'mp4' | 'webm'>('mp4');
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastRenderedSignature, setLastRenderedSignature] = useState<
    string | null
  >(null);
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);

  const stageRef = useRef<StageCanvasHandle | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  // Signature of all parameters that affect the rendered video output
  const currentRenderSignature = useMemo(
    () =>
      JSON.stringify({
        trackName: track.name,
        rawCount: track.rawPoints.length,
        trimStart: track.trimRange.startIndex,
        trimEnd: track.trimRange.endIndex,
        speedMultiplier,
        exportResolution,
        exportQuality,
        cameraMode,
        overviewZoom: cameraMode === 'overview' ? effectiveZoom : null,
        mapStyleId,
        hudConfig,
      }),
    [
      track.name,
      track.rawPoints.length,
      track.trimRange.startIndex,
      track.trimRange.endIndex,
      speedMultiplier,
      exportResolution,
      exportQuality,
      cameraMode,
      effectiveZoom,
      mapStyleId,
      hudConfig,
    ]
  );

  const hasParamsChangedSinceRender = Boolean(
    exportedVideoUrl &&
      lastRenderedSignature &&
      lastRenderedSignature !== currentRenderSignature
  );

  // Current interpolated telemetry & coordinates
  const currentFrame = useMemo(
    () => interpolateAtElapsedSec(track, elapsedSec),
    [track, elapsedSec]
  );

  // Accurate real-time playback loop scaled by speedMultiplier (1x, 2x, 5x, 10x)
  useEffect(() => {
    if (!isPlaying || isExporting) return;

    let rafId = 0;
    let lastWallTime = performance.now();

    const tick = (now: number) => {
      const dtWallSec = (now - lastWallTime) / 1000;
      lastWallTime = now;

      setElapsedSec((prev) => {
        const next = prev + dtWallSec * speedMultiplier;
        if (next >= track.totalDurationSec) {
          setIsPlaying(false);
          return track.totalDurationSec;
        }
        return next;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, isExporting, speedMultiplier, track.totalDurationSec]);

  const handleLoadGpxString = useCallback((xml: string, fileName: string) => {
    try {
      const parsed = parseGpxXml(xml, fileName);
      setTrack(parsed);
      setElapsedSec(0);
      setIsPlaying(false);
      setUploadError(null);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to parse GPX file.'
      );
    }
  }, []);

  const handleLoadSample = useCallback(() => {
    const sampleXml = generateSampleGpxXml();
    handleLoadGpxString(sampleXml, 'Col du Galibier Summit Attack');
  }, [handleLoadGpxString]);

  const handleTrimChange = useCallback((newTrim: TrimRange) => {
    setIsPlaying(false);
    setTrack((prev) => applyTrimToTrack(prev, newTrim));
    setElapsedSec(0);
  }, []);

  const handleTogglePlay = useCallback(() => {
    if (elapsedSec >= track.totalDurationSec) {
      setElapsedSec(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  }, [elapsedSec, track.totalDurationSec]);

  const handleRestart = useCallback(() => {
    setIsPlaying(false);
    setElapsedSec(0);
  }, []);

  const handleOpenExportModal = useCallback(() => {
    setIsPlaying(false);
    setExportError(null);
    if (
      exportedVideoUrl &&
      lastRenderedSignature &&
      lastRenderedSignature !== currentRenderSignature
    ) {
      setShowOverrideConfirm(true);
    } else {
      setShowOverrideConfirm(false);
    }
    setShowExportModal(true);
  }, [exportedVideoUrl, lastRenderedSignature, currentRenderSignature]);

  const handleStartVideoRender = useCallback(async () => {
    if (!stageRef.current) return;
    setIsPlaying(false);
    setIsExporting(true);
    setExportError(null);
    setShowOverrideConfirm(false);

    if (exportedVideoUrl) {
      URL.revokeObjectURL(exportedVideoUrl);
      setExportedVideoUrl(null);
    }
    setLastRenderedSignature(null);

    const abortController = new AbortController();
    exportAbortRef.current = abortController;

    const totalVideoDurationSec = Math.max(
      1,
      track.totalDurationSec / speedMultiplier
    );

    try {
      const result = await exportFullHdVideo({
        fps: EXPORT_FPS,
        resolution: exportResolution,
        quality: exportQuality,
        totalVideoDurationSec,
        signal: abortController.signal,
        onProgress: (prog) => setExportProgress(prog),
        renderFrameAtVideoTime: async (videoTimeSec: number) => {
          const rideElapsed = Math.min(
            track.totalDurationSec,
            videoTimeSec * speedMultiplier
          );
          setElapsedSec(rideElapsed);
          return stageRef.current!.renderCompositeFrameAtRideSec(rideElapsed);
        },
      });

      const url = URL.createObjectURL(result.blob);
      setExportedVideoUrl(url);
      setExportedFileExt(result.extension);
      setLastRenderedSignature(currentRenderSignature);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        setExportProgress((prev) =>
          prev ? { ...prev, phase: 'cancelled' } : null
        );
      } else {
        setExportError(
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred during video rendering.'
        );
      }
    } finally {
      setIsExporting(false);
      exportAbortRef.current = null;
    }
  }, [
    currentRenderSignature,
    exportQuality,
    exportResolution,
    exportedVideoUrl,
    speedMultiplier,
    track.totalDurationSec,
  ]);

  const handleCancelExport = useCallback(() => {
    exportAbortRef.current?.abort();
  }, []);

  const isImperial = hudConfig.unitSystem === 'imperial';
  const liveSpeed = isImperial
    ? currentFrame.speedKmh * 0.621371
    : currentFrame.speedKmh;
  const speedUnit = isImperial ? 'mph' : 'km/h';
  const liveEle = isImperial ? currentFrame.ele * 3.28084 : currentFrame.ele;
  const eleUnit = isImperial ? 'ft' : 'm';
  const liveDist = isImperial
    ? currentFrame.distanceKm * 0.621371
    : currentFrame.distanceKm;
  const distUnit = isImperial ? 'mi' : 'km';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/90 px-6 py-3.5 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-sky-500 text-slate-950 shadow-lg shadow-emerald-500/20">
              <Bike className="h-6 w-6 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-extrabold tracking-tight text-white">
                  GPX Replay Studio
                </h1>
                <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-300 uppercase border border-emerald-500/30">
                  1080p Full HD Browser Engine
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Accurate ride-time route animator, GPX trimmer & client-side Full HD video generator
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-4 text-xs text-slate-400 md:flex">
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-1.5">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              <span>100% Client-Side • Zero Server Upload</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace Grid */}
      <main className="mx-auto grid max-w-[1680px] grid-cols-1 gap-5 p-5 lg:grid-cols-12">
        {/* Left Sidebar: GPX Upload, Route Trimmer & Live Telemetry Readout */}
        <aside className="space-y-4 lg:col-span-4 xl:col-span-3">
          <GpxUploader
            onLoadGpxString={handleLoadGpxString}
            onLoadSample={handleLoadSample}
            currentTrackName={track.name}
            error={uploadError}
          />

          <RouteTrimmer
            track={track}
            onTrimChange={handleTrimChange}
            speedMultiplier={speedMultiplier}
            unitSystem={hudConfig.unitSystem}
            disabled={isExporting}
          />

          {/* Live Telemetry Inspector Panel */}
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
                  Live GPX Telemetry
                </h2>
              </div>
              <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
                {speedMultiplier}x CLOCK
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {/* Speed */}
              <div className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                  <Gauge className="h-3.5 w-3.5 text-emerald-400" />
                  Speed
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono text-2xl font-extrabold text-white">
                    {liveSpeed.toFixed(1)}
                  </span>
                  <span className="text-xs font-semibold text-emerald-400">
                    {speedUnit}
                  </span>
                </div>
              </div>

              {/* Altitude & Grade */}
              <div className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-3">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Mountain className="h-3.5 w-3.5 text-sky-400" />
                    Altitude
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                      currentFrame.gradePct >= 5
                        ? 'bg-amber-500/20 text-amber-300'
                        : currentFrame.gradePct <= -4
                        ? 'bg-sky-500/20 text-sky-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {currentFrame.gradePct > 0 ? '+' : ''}
                    {currentFrame.gradePct.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono text-2xl font-extrabold text-white">
                    {Math.round(liveEle)}
                  </span>
                  <span className="text-xs font-semibold text-sky-400">
                    {eleUnit}
                  </span>
                </div>
              </div>

              {/* Distance */}
              <div className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                  <Compass className="h-3.5 w-3.5 text-amber-400" />
                  Distance
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono text-xl font-extrabold text-white">
                    {liveDist.toFixed(2)}
                  </span>
                  <span className="text-xs font-semibold text-amber-400">
                    {distUnit}
                  </span>
                </div>
              </div>

              {/* Elapsed Time */}
              <div className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                  <Timer className="h-3.5 w-3.5 text-purple-400" />
                  Elapsed Ride
                </div>
                <div className="mt-1 font-mono text-xl font-extrabold text-white">
                  {formatDurationHms(currentFrame.elapsedSec)}
                </div>
              </div>
            </div>

            {/* Optional GPX Sensor Strip */}
            {(typeof currentFrame.heartRate === 'number' ||
              typeof currentFrame.cadence === 'number' ||
              typeof currentFrame.power === 'number') && (
              <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-xl border border-slate-800/90 bg-slate-950/70 p-2.5 text-center">
                <div>
                  <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400">
                    <Heart className="h-3 w-3 text-rose-400" />
                    HR
                  </div>
                  <div className="font-mono text-sm font-bold text-rose-300">
                    {currentFrame.heartRate ?? '--'} <span className="text-[10px]">bpm</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400">
                    <Flame className="h-3 w-3 text-sky-400" />
                    CADENCE
                  </div>
                  <div className="font-mono text-sm font-bold text-sky-300">
                    {currentFrame.cadence ?? '--'} <span className="text-[10px]">rpm</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400">
                    <Zap className="h-3 w-3 text-amber-400" />
                    POWER
                  </div>
                  <div className="font-mono text-sm font-bold text-amber-300">
                    {currentFrame.power ?? '--'} <span className="text-[10px]">W</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Right Main Area: 1920x1080 Stage Preview & Transport Controls */}
        <section className=" flex flex-col gap-4 lg:col-span-8 xl:col-span-9">
          <StageCanvas
            ref={stageRef}
            track={track}
            currentFrame={currentFrame}
            cameraMode={cameraMode}
            mapStyleId={mapStyleId}
            hudConfig={hudConfig}
            speedMultiplier={speedMultiplier}
            onEffectiveZoomChange={setEffectiveZoom}
            onUserZoomChange={(newZoom) => {
              setEffectiveZoom(newZoom);
              if (cameraMode === 'follow') {
                const clamped = Math.max(10, Math.min(18, newZoom));
                setHudConfig((prev) => ({
                  ...prev,
                  followZoom: clamped,
                }));
              }
            }}
          />

          <PlaybackControls
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            onRestart={handleRestart}
            elapsedSec={elapsedSec}
            totalDurationSec={track.totalDurationSec}
            onSeek={(sec) => {
              setIsPlaying(false);
              setElapsedSec(sec);
            }}
            speedMultiplier={speedMultiplier}
            onSpeedMultiplierChange={setSpeedMultiplier}
            cameraMode={cameraMode}
            onCameraModeChange={setCameraMode}
            effectiveZoom={effectiveZoom}
            onResetOverviewFit={() => stageRef.current?.fitRouteBounds()}
            mapStyleId={mapStyleId}
            onMapStyleChange={setMapStyleId}
            hudConfig={hudConfig}
            onHudConfigChange={setHudConfig}
            onStartExport={handleOpenExportModal}
            isExporting={isExporting}
          />
        </section>
      </main>

      {/* In-Browser Video Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <Film className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-white">
                  Render video file
                </h3>
              </div>
              {!isExporting && (
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Active Tab Performance Warning (shown right below title when rendering starts) */}
            {isExporting && (
              <div className="mt-4 flex animate-pulse items-center gap-2.5 rounded-xl border border-red-500/60 bg-red-500/20 px-3.5 py-2.5 text-xs font-semibold text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span>Keep this browser tab active for best performance</span>
              </div>
            )}

            {/* Export Controls */}
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs">
                <div>
                  <span className="text-slate-400">Resolution:</span>
                  <div className="mt-1 flex gap-1.5">
                    {(['720p', '1080p'] as VideoResolutionId[]).map((resId) => (
                      <button
                        key={resId}
                        type="button"
                        disabled={isExporting}
                        onClick={() => setExportResolution(resId)}
                        className={`rounded-md px-2.5 py-1 font-mono text-xs font-bold transition ${
                          exportResolution === resId
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {VIDEO_RESOLUTION_CONFIG[resId].shortLabel}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400">Playback Speed:</span>
                  <div className="mt-1 flex gap-1.5">
                    {([1, 2, 5, 10] as SpeedMultiplier[]).map((mult) => (
                      <button
                        key={mult}
                        type="button"
                        disabled={isExporting}
                        onClick={() => setSpeedMultiplier(mult)}
                        className={`rounded-md px-2 py-1 font-mono text-xs font-bold transition ${
                          speedMultiplier === mult
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        x{mult}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2 border-t border-slate-800/80 pt-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Video Quality:</span>
                    <span className="font-mono text-[11px] font-semibold text-sky-300">
                      {Math.round(
                        VIDEO_QUALITY_CONFIG[exportQuality].bitrateByRes[
                          exportResolution
                        ] / 1_000_000
                      )}{' '}
                      Mbps
                    </span>
                  </div>
                  <div className="mt-1 flex gap-1.5">
                    {(['standard', 'high', 'ultra'] as VideoQualityPreset[]).map(
                      (qPreset) => (
                        <button
                          key={qPreset}
                          type="button"
                          disabled={isExporting}
                          onClick={() => setExportQuality(qPreset)}
                          className={`flex-1 rounded-md px-2 py-1 font-mono text-xs font-bold transition ${
                            exportQuality === qPreset
                              ? 'bg-sky-500 text-slate-950'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {VIDEO_QUALITY_CONFIG[qPreset].label}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2.5 text-xs">
                <span className="text-emerald-200">
                  Resulting Video Length @ <strong>x{speedMultiplier}</strong>:
                </span>
                <span className="font-mono text-sm font-bold text-emerald-300">
                  {formatDurationHms(track.totalDurationSec / speedMultiplier)}
                </span>
              </div>

              {/* Parameter Change / Override Warning Prompt */}
              {exportedVideoUrl &&
                !isExporting &&
                (hasParamsChangedSinceRender || showOverrideConfirm) && (
                  <div className="space-y-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-xs">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 rounded-lg bg-amber-500/20 p-1.5 text-amber-300">
                        <Film className="h-4 w-4" />
                      </div>
                      <div className="space-y-1">
                        <div className="font-bold text-amber-200">
                          {hasParamsChangedSinceRender
                            ? 'Video parameters changed since last generation'
                            : 'Override previously generated video?'}
                        </div>
                        <p className="text-amber-100/80 leading-relaxed">
                          Generating a new video with the current settings will{' '}
                          <strong className="text-amber-200">
                            remove and override
                          </strong>{' '}
                          your previously rendered video. Make sure to download
                          the old video first if you still need it.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (exportedVideoUrl) {
                            URL.revokeObjectURL(exportedVideoUrl);
                          }
                          setExportedVideoUrl(null);
                          setExportProgress(null);
                          setLastRenderedSignature(null);
                          setShowOverrideConfirm(false);
                        }}
                        className="rounded-lg border border-amber-500/40 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-slate-800"
                      >
                        Remove Old Video Only
                      </button>
                      <button
                        type="button"
                        onClick={handleStartVideoRender}
                        className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-1.5 text-xs font-bold text-slate-950 shadow transition hover:bg-amber-300"
                      >
                        <Film className="h-3.5 w-3.5" />
                        Override &amp; Render New Video
                      </button>
                    </div>
                  </div>
                )}

              {/* Progress Bar during rendering (hidden if stale after parameter change) */}
              {exportProgress &&
                (isExporting || !hasParamsChangedSinceRender) && (
                  <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200 capitalize">
                        {exportProgress.phase === 'rendering'
                          ? `Rendering ${exportResolution.toUpperCase()} Frames (${exportProgress.renderedFrames} / ${exportProgress.totalFrames})`
                          : exportProgress.phase === 'finalizing'
                          ? 'Finalizing MP4 container...'
                          : exportProgress.phase === 'completed'
                          ? `${VIDEO_RESOLUTION_CONFIG[exportResolution].shortLabel} Video Ready!`
                          : exportProgress.phase}
                      </span>
                      <span className="font-mono font-bold text-emerald-400">
                        {exportProgress.progressPct}%
                      </span>
                    </div>

                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-150"
                        style={{ width: `${exportProgress.progressPct}%` }}
                      />
                    </div>

                    {exportProgress.phase === 'rendering' && (
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>
                          Elapsed:{' '}
                          {formatDurationHms(exportProgress.elapsedRenderSec)}
                        </span>
                        <span>
                          Est. Remaining:{' '}
                          {formatDurationHms(
                            exportProgress.estimatedRemainingSec
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}

              {exportError && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                  {exportError}
                </div>
              )}

              {/* Completed Video Preview & Download */}
              {exportedVideoUrl && !isExporting && (
                <div
                  className={`space-y-3 rounded-xl border bg-slate-950 p-3.5 ${
                    hasParamsChangedSinceRender
                      ? 'border-amber-500/30 opacity-85'
                      : 'border-emerald-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span
                      className={`flex items-center gap-2 ${
                        hasParamsChangedSinceRender
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {hasParamsChangedSinceRender
                        ? `Previous Render (${exportedFileExt.toUpperCase()}) — Outdated Settings`
                        : `Rendered ${VIDEO_RESOLUTION_CONFIG[exportResolution].width}×${VIDEO_RESOLUTION_CONFIG[exportResolution].height} (${exportedFileExt.toUpperCase()}) successfully!`}
                    </span>
                  </div>
                  <video
                    src={exportedVideoUrl}
                    controls
                    className="aspect-video w-full rounded-lg border border-slate-800 bg-black"
                  />
                  <a
                    href={exportedVideoUrl}
                    download={`${track.name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')}-${speedMultiplier}x-${exportResolution}.${exportedFileExt}`}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400"
                  >
                    <Download className="h-4 w-4" />
                    Download {hasParamsChangedSinceRender ? 'Previous ' : ''}
                    {VIDEO_RESOLUTION_CONFIG[exportResolution].shortLabel} Video (.{exportedFileExt})
                  </a>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="mt-5 flex items-center justify-end gap-2.5 border-t border-slate-800 pt-4">
              {isExporting ? (
                <button
                  type="button"
                  onClick={handleCancelExport}
                  className="rounded-xl border border-rose-500/50 bg-rose-500/15 px-4 py-2 text-xs font-bold text-rose-300 transition hover:bg-rose-500/25"
                >
                  Cancel Render
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowExportModal(false)}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        exportedVideoUrl &&
                        !hasParamsChangedSinceRender &&
                        !showOverrideConfirm
                      ) {
                        setShowOverrideConfirm(true);
                      } else {
                        void handleStartVideoRender();
                      }
                    }}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-emerald-500 px-5 py-2 text-xs font-bold text-slate-950 shadow-lg transition hover:brightness-110"
                  >
                    <Film className="h-4 w-4" />
                    {exportedVideoUrl
                      ? hasParamsChangedSinceRender || showOverrideConfirm
                        ? `Override & Start New ${exportResolution} Render`
                        : `Re-Render ${exportResolution} Video`
                      : `Start ${exportResolution} Render`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default App;
