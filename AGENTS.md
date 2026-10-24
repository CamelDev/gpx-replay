# AGENTS.md — GPX Replay Studio

## Project Overview
**GPX Replay Studio** is a 100% client-side (zero-backend) web application for animating GPX cycling/running routes on a map with live telemetry overlays and exporting **Full HD (`1920×1080`)** MP4/WebM videos directly in the browser.

## Tech Stack
- **Framework**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`) + `lucide-react` icons
- **Map Engine**: `maplibre-gl` (WebGL map canvas rendered at native `1920×1080` with `preserveDrawingBuffer: true`)
- **Video Encoding**:
  - Primary: `WebCodecs` API (`VideoEncoder` + `VideoFrame` with H.264 High Profile `avc1.640028`) muxed into `.mp4` via `mp4-muxer`
  - Fallback: `HTMLCanvasElement.captureStream()` + `MediaRecorder` (`.webm` / `.mp4`)
- **Testing**: Vitest (`npm test -- --run`)

## Commands
- **Install dependencies**: `npm install`
- **Start dev server**: `npm run dev`
- **Typecheck & production build**: `npm run build`
- **Run unit tests**: `npm test -- --run`

## Directory Structure
- `src/types/gpx.ts` — Core TypeScript interfaces (`GpxPoint`, `GpxTrackData`, `TrimRange`, `InterpolatedFrame`, `HudConfig`, `SpeedMultiplier`, `CameraMode`, `MapStyleId`).
- `src/utils/gpxParser.ts` — Browser `DOMParser` GPX 1.1 parser (`<trkpt>` + Garmin `TrackPointExtension` heart rate, cadence, power), Haversine distance, rolling-window speed/grade smoothing, trim recalculation (`applyTrimToTrack`), and O(log N) binary-search timestamp interpolation (`interpolateAtElapsedSec`).
- `src/utils/mapStyles.ts` — Keyless, watermark-free raster tile style definitions for MapLibre GL (`Esri Dark Gray Canvas`, `Esri World Topo`, `Esri World Imagery`, `Esri World Street Map`).
- `src/utils/hudRenderer.ts` — Pure 2D canvas renderer at `1920×1080` drawing the route polyline (colored by speed, altitude, or solid emerald), animated rider marker, telemetry cards, and bottom elevation profile chart.
- `src/utils/videoExporter.ts` — Frame-by-frame offline `1920×1080` video exporter with `AbortSignal` support and unthrottled `MessageChannel` yielding.
- `src/components/StageCanvas.tsx` — Dual-layer `1920×1080` stage combining the MapLibre GL canvas and the 2D HUD overlay canvas, plus imperative frame rendering for offline video export.
- `src/components/PlaybackControls.tsx` — Timeline scrubber, transport controls, speed multiplier selector (`1x`, `2x`, `5x`, `10x`), camera mode & zoom controls, and HUD toggles.
- `src/components/RouteTrimmer.tsx` — Dual-handle start/end GPX range trimmer over the elevation profile with live recalculated metrics.
- `src/components/GpxUploader.tsx` — Drag-and-drop `.gpx` file uploader and built-in Alpine climb sample loader.

## Critical Architectural Invariants (Read Before Modifying)
1. **Background-Tab Safe Offline Video Rendering**:
   - Browsers pause `window.requestAnimationFrame()` and throttle `setTimeout(..., 0)` to `1000ms` when a tab loses focus.
   - Never rely on `requestAnimationFrame` or `map.once('render')` inside the video export loop (`StageCanvas.renderCompositeFrameAtRideSec`).
   - Always trigger synchronous WebGL repaints (`map._render(performance.now())`), poll `map.areTilesLoaded()` with short intervals while tiles load for the new camera center, and yield on the main thread in `videoExporter.ts` using `MessageChannel` instead of `setTimeout(0)`.
2. **Tile Providers & Rate Limits**:
   - **Do not use direct OpenStreetMap tile servers** (`tile.openstreetmap.org`): OSM's volunteer-run servers strictly enforce an automated usage policy (`osm.wiki/Blocked`). Fast scrubbing, multi-speed playback, or frame-by-frame video rendering triggers rate-limiting and returns `403 Access blocked` image tiles.
   - **Do not use CARTO** (`basemaps.cartocdn.com`) raster tiles without an API key, as they inject `"API KEY REQUIRED"` watermarks onto tiles.
   - **Stick to robust keyless providers** in `src/utils/mapStyles.ts`: Use Esri ArcGIS online services (`World_Dark_Gray_Base`, `World_Topo_Map`, `World_Imagery`, `World_Street_Map`) which reliably support fast rendering and video export without rate limits or watermarks.
3. **WebGL Canvas Compositing**:
   - The `maplibregl.Map` instance in `StageCanvas.tsx` **must** keep `canvasContextAttributes: { preserveDrawingBuffer: true }` and `pixelRatio: 1` at fixed `1920×1080` dimensions so `compCtx.drawImage(map.getCanvas(), 0, 0, 1920, 1080)` never captures a blank WebGL buffer.
4. **Accurate Ride-Time Multipliers**:
   - Playback and video export must strictly honor `SpeedMultiplier` (`1`, `2`, `5`, `10`) where `rideElapsedSec = videoTimeSec * speedMultiplier`.
5. **Render Parameter Change Detection**:
   - `App.tsx` computes `currentRenderSignature` across all parameters affecting video output (track, trim range, speed multiplier, FPS, camera mode, zoom level, map style, and HUD config). Any new setting that changes the visual video output should be included in `currentRenderSignature` so the user is warned before overriding an already-rendered video.
