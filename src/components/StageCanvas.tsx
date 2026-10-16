import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  CameraMode,
  GpxTrackData,
  HudConfig,
  InterpolatedFrame,
  MapStyleId,
  SpeedMultiplier,
} from '../types/gpx';
import { MAP_STYLE_OPTIONS } from '../utils/mapStyles';
import {
  renderRouteAndHud,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from '../utils/hudRenderer';
import { interpolateAtElapsedSec } from '../utils/gpxParser';

export interface StageCanvasHandle {
  renderCompositeFrameAtRideSec: (rideElapsedSec: number) => Promise<HTMLCanvasElement>;
  fitRouteBounds: () => void;
}

interface StageCanvasProps {
  track: GpxTrackData;
  currentFrame: InterpolatedFrame;
  cameraMode: CameraMode;
  mapStyleId: MapStyleId;
  hudConfig: HudConfig;
  speedMultiplier: SpeedMultiplier;
  onUserZoomChange?: (zoom: number) => void;
  onEffectiveZoomChange?: (zoom: number) => void;
}

export const StageCanvas = forwardRef<StageCanvasHandle, StageCanvasProps>(
  (
    {
      track,
      currentFrame,
      cameraMode,
      mapStyleId,
      hudConfig,
      speedMultiplier,
      onUserZoomChange,
      onEffectiveZoomChange,
    },
    ref
  ) => {
    const outerWrapperRef = useRef<HTMLDivElement | null>(null);
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const hudCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const lastReportedZoomRef = useRef<number | null>(null);

    const [scale, setScale] = useState(0.5);

    // Keep latest props in refs for imperative offline video rendering
    const stateRef = useRef({
      track,
      currentFrame,
      cameraMode,
      hudConfig,
      speedMultiplier,
      onUserZoomChange,
      onEffectiveZoomChange,
    });
    stateRef.current = {
      track,
      currentFrame,
      cameraMode,
      hudConfig,
      speedMultiplier,
      onUserZoomChange,
      onEffectiveZoomChange,
    };

    // Scale the native 1920x1080 stage smoothly to fit any responsive container width
    useEffect(() => {
      const el = outerWrapperRef.current;
      if (!el) return;
      const updateScale = () => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) {
          setScale(rect.width / VIDEO_WIDTH);
        }
      };
      updateScale();
      const ro = new ResizeObserver(updateScale);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    const fitRouteBounds = useCallback(() => {
      const map = mapRef.current;
      if (!map || track.points.length === 0) return;
      const { minLon, minLat, maxLon, maxLat } = track.bounds;
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        {
          padding: {
            top: 140,
            bottom: hudConfig.showElevationChart ? 210 : 100,
            left: 120,
            right: 380,
          },
          duration: 0,
          maxZoom: 16,
        }
      );
    }, [track, hudConfig.showElevationChart]);

    const drawHudOverlay = useCallback(
      (frameToDraw: InterpolatedFrame) => {
        const hudCanvas = hudCanvasRef.current;
        const map = mapRef.current;
        if (!hudCanvas || !map) return;

        const ctx = hudCanvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
        const { track: curTrack, hudConfig: curHud, speedMultiplier: curMult } =
          stateRef.current;

        renderRouteAndHud(
          ctx,
          curTrack,
          frameToDraw,
          curHud,
          curMult,
          (lon, lat) => {
            const pt = map.project([lon, lat]);
            return { x: pt.x, y: pt.y };
          }
        );
      },
      []
    );

    // Initialize MapLibre GL at native 1920x1080 resolution with preserveDrawingBuffer: true
    useEffect(() => {
      if (!mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: MAP_STYLE_OPTIONS[mapStyleId].style,
        center: [track.points[0]?.lon || 6.4072, track.points[0]?.lat || 45.0608],
        zoom: 13.5,
        pixelRatio: 1,
        attributionControl: false,
        interactive: true,
         fadeDuration: 0,
        canvasContextAttributes: {
          preserveDrawingBuffer: true,
          antialias: true,
        },
      });

      mapRef.current = map;

      const reportEffectiveZoom = () => {
        const rounded = Math.round(map.getZoom() * 10) / 10;
        if (lastReportedZoomRef.current !== rounded) {
          lastReportedZoomRef.current = rounded;
          stateRef.current.onEffectiveZoomChange?.(rounded);
        }
      };

      const onMapRender = () => {
        drawHudOverlay(stateRef.current.currentFrame);
        reportEffectiveZoom();
      };

      const onMapZoom = (e: maplibregl.MapLibreEvent<MouseEvent | TouchEvent | WheelEvent | undefined>) => {
        reportEffectiveZoom();
        if (e.originalEvent) {
          const rounded = Math.round(map.getZoom() * 10) / 10;
          stateRef.current.onUserZoomChange?.(rounded);
        }
      };

      map.on('render', onMapRender);
      map.on('zoom', onMapZoom);
      map.once('load', () => {
        map.resize();
        fitRouteBounds();
        reportEffectiveZoom();
        drawHudOverlay(stateRef.current.currentFrame);
      });

      return () => {
        map.off('render', onMapRender);
        map.off('zoom', onMapZoom);
        map.remove();
        mapRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update map style when mapStyleId changes
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      map.setStyle(MAP_STYLE_OPTIONS[mapStyleId].style);
    }, [mapStyleId]);

    // Refit bounds when track or trim range changes or when switching to overview mode
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      if (cameraMode === 'overview') {
        fitRouteBounds();
      } else {
        map.jumpTo({
          center: [currentFrame.lon, currentFrame.lat],
          zoom: hudConfig.followZoom,
        });
      }
      drawHudOverlay(currentFrame);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      track.name,
      track.trimRange.startIndex,
      track.trimRange.endIndex,
      cameraMode,
      fitRouteBounds,
    ]);

    // Sync camera and redraw HUD on frame or HUD config changes
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      if (cameraMode === 'follow') {
        map.jumpTo({
          center: [currentFrame.lon, currentFrame.lat],
          zoom: hudConfig.followZoom,
        });
      }
      drawHudOverlay(currentFrame);
    }, [currentFrame, cameraMode, hudConfig, speedMultiplier, drawHudOverlay]);

    // Expose offline frame-by-frame compositor for 1920x1080 video export
    useImperativeHandle(
      ref,
      () => ({
        fitRouteBounds,
        renderCompositeFrameAtRideSec: async (rideElapsedSec: number) => {
          const map = mapRef.current;
          const {
            track: curTrack,
            cameraMode: curCam,
            hudConfig: curHud,
          } = stateRef.current;

          const frame = interpolateAtElapsedSec(curTrack, rideElapsedSec);

          if (map) {
            if (curCam === 'follow') {
              map.jumpTo({
                center: [frame.lon, frame.lat],
                zoom: curHud.followZoom,
              });
            }

            const forceSyncMapRender = () => {
              map.triggerRepaint();
              const internalMap = map as unknown as {
                _render?: (paintStartTimeStamp?: number) => void;
              };
              if (typeof internalMap._render === 'function') {
                internalMap._render(performance.now());
              }
            };

            // Initial synchronous render pass to trigger tile requests for the new camera center
            forceSyncMapRender();

            // Wait until tiles for the new camera view are loaded (works even when tab is unfocused)
            const waitStart = performance.now();
            while (
              (!map.loaded() || !map.areTilesLoaded()) &&
              performance.now() - waitStart < 1500
            ) {
              await new Promise<void>((resolve) => setTimeout(resolve, 16));
              forceSyncMapRender();
            }

            // Final synchronous WebGL paint right before capturing map.getCanvas()
            forceSyncMapRender();
          }

          drawHudOverlay(frame);

          if (!compositeCanvasRef.current) {
            const c = document.createElement('canvas');
            c.width = VIDEO_WIDTH;
            c.height = VIDEO_HEIGHT;
            compositeCanvasRef.current = c;
          }

          const compCanvas = compositeCanvasRef.current;
          const compCtx = compCanvas.getContext('2d')!;

          // 1. Base background fill
          compCtx.fillStyle = '#090d16';
          compCtx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);

          // 2. Draw MapLibre 1920x1080 WebGL canvas
          if (map) {
            try {
              const mapCanvas = map.getCanvas();
              compCtx.drawImage(mapCanvas, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
            } catch {
              // Ignore if WebGL context is unavailable in headless environment
            }
          }

          // 3. Draw 1920x1080 HUD & Route overlay canvas
          if (hudCanvasRef.current) {
            compCtx.drawImage(
              hudCanvasRef.current,
              0,
              0,
              VIDEO_WIDTH,
              VIDEO_HEIGHT
            );
          }

          return compCanvas;
        },
      }),
      [drawHudOverlay, fitRouteBounds]
    );

    return (
      <div
        ref={outerWrapperRef}
        className="relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl"
      >
        <div
          style={{
            width: `${VIDEO_WIDTH}px`,
            height: `${VIDEO_HEIGHT}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          className="relative select-none"
        >
          {/* Layer 1: Native 1920x1080 MapLibre GL Canvas */}
          <div
            ref={mapContainerRef}
            style={{ width: `${VIDEO_WIDTH}px`, height: `${VIDEO_HEIGHT}px` }}
            className="absolute inset-0"
          />

          {/* Layer 2: Native 1920x1080 2D Telemetry & Route Overlay Canvas */}
          <canvas
            ref={hudCanvasRef}
            width={VIDEO_WIDTH}
            height={VIDEO_HEIGHT}
            className="pointer-events-none absolute inset-0"
          />
        </div>
      </div>
    );
  }
);
