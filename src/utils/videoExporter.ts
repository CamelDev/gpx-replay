import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from './hudRenderer';

export type VideoResolutionId = '720p' | '1080p';
export type VideoQualityPreset = 'standard' | 'high' | 'ultra';

export const VIDEO_RESOLUTION_CONFIG: Record<
  VideoResolutionId,
  { label: string; shortLabel: string; width: number; height: number }
> = {
  '720p': {
    label: '1280 × 720 (HD)',
    shortLabel: '720p HD',
    width: 1280,
    height: 720,
  },
  '1080p': {
    label: '1920 × 1080 (Full HD)',
    shortLabel: '1080p Full HD',
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
  },
};

export const VIDEO_QUALITY_CONFIG: Record<
  VideoQualityPreset,
  {
    label: string;
    bitrateByRes: Record<VideoResolutionId, number>;
    keyframeIntervalSec: number;
  }
> = {
  standard: {
    label: 'Standard',
    bitrateByRes: {
      '720p': 6_000_000,
      '1080p': 12_000_000,
    },
    keyframeIntervalSec: 2,
  },
  high: {
    label: 'High',
    bitrateByRes: {
      '720p': 14_000_000,
      '1080p': 25_000_000,
    },
    keyframeIntervalSec: 1,
  },
  ultra: {
    label: 'Ultra',
    bitrateByRes: {
      '720p': 25_000_000,
      '1080p': 45_000_000,
    },
    keyframeIntervalSec: 0.5,
  },
};

export interface VideoExportProgress {
  phase: 'preparing' | 'rendering' | 'finalizing' | 'completed' | 'cancelled' | 'error';
  renderedFrames: number;
  totalFrames: number;
  progressPct: number;
  elapsedRenderSec: number;
  estimatedRemainingSec: number;
  format: 'mp4' | 'webm';
}

export interface VideoExportOptions {
  fps?: number;
  resolution?: VideoResolutionId;
  quality?: VideoQualityPreset;
  totalVideoDurationSec: number;
  renderFrameAtVideoTime: (videoTimeSec: number) => Promise<HTMLCanvasElement>;
  onProgress: (progress: VideoExportProgress) => void;
  signal: AbortSignal;
}

const AVC_CODEC_CANDIDATES = [
  'avc1.64002a', // High Profile Level 4.2
  'avc1.640028', // High Profile Level 4.0
  'avc1.4d002a', // Main Profile Level 4.2
  'avc1.4d0028', // Main Profile Level 4.0
  'avc1.420028', // Baseline Profile Level 4.0
];

async function resolveSupportedEncoderConfig(
  width: number,
  height: number,
  bitrate: number,
  fps: number
): Promise<VideoEncoderConfig | null> {
  if (typeof window === 'undefined' || !('VideoEncoder' in window)) {
    return null;
  }

  // Try with latencyMode: 'quality' first for sharper offline encoding, then fallback to default
  const latencyModes: (LatencyMode | undefined)[] = ['quality', undefined];

  for (const latencyMode of latencyModes) {
    for (const codec of AVC_CODEC_CANDIDATES) {
      const candidate: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        ...(latencyMode ? { latencyMode } : {}),
      };
      try {
        const support = await VideoEncoder.isConfigSupported(candidate);
        if (support.supported) {
          return candidate;
        }
      } catch {
        // try next candidate
      }
    }
  }

  return null;
}

/**
 * Checks whether the browser supports offline WebCodecs H.264 MP4 encoding.
 */
export async function supportsWebCodecsMp4(
  fps = 30,
  resolution: VideoResolutionId = '1080p',
  quality: VideoQualityPreset = 'high'
): Promise<boolean> {
  const resCfg = VIDEO_RESOLUTION_CONFIG[resolution];
  const bitrate = VIDEO_QUALITY_CONFIG[quality].bitrateByRes[resolution];
  const config = await resolveSupportedEncoderConfig(
    resCfg.width,
    resCfg.height,
    bitrate,
    fps
  );
  return config !== null;
}

/**
 * Exports a video in the browser using WebCodecs + mp4-muxer (offline frame-by-frame)
 * with an automatic fallback to MediaRecorder if WebCodecs is unsupported.
 */
export async function exportFullHdVideo(
  options: VideoExportOptions
): Promise<{ blob: Blob; extension: 'mp4' | 'webm' }> {
  const fps = options.fps ?? 30;
  const resolution = options.resolution ?? '1080p';
  const quality = options.quality ?? 'high';
  const resCfg = VIDEO_RESOLUTION_CONFIG[resolution];
  const bitrate = VIDEO_QUALITY_CONFIG[quality].bitrateByRes[resolution];

  const encoderConfig = await resolveSupportedEncoderConfig(
    resCfg.width,
    resCfg.height,
    bitrate,
    fps
  );
  if (encoderConfig) {
    return exportWithWebCodecsMp4(options, encoderConfig, resCfg.width, resCfg.height, fps, quality);
  }
  return exportWithMediaRecorder(options, resCfg.width, resCfg.height, bitrate, fps);
}

function createScaledFrameCanvas(
  sourceCanvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  reuseCanvas: HTMLCanvasElement | null
): HTMLCanvasElement {
  if (
    sourceCanvas.width === targetWidth &&
    sourceCanvas.height === targetHeight
  ) {
    return sourceCanvas;
  }
  let scaled = reuseCanvas;
  if (!scaled || scaled.width !== targetWidth || scaled.height !== targetHeight) {
    scaled = document.createElement('canvas');
    scaled.width = targetWidth;
    scaled.height = targetHeight;
  }
  const ctx = scaled.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
  return scaled;
}

async function exportWithWebCodecsMp4(
  options: VideoExportOptions,
  encoderConfig: VideoEncoderConfig,
  targetWidth: number,
  targetHeight: number,
  fps: number,
  quality: VideoQualityPreset
): Promise<{ blob: Blob; extension: 'mp4' }> {
  const { totalVideoDurationSec, renderFrameAtVideoTime, onProgress, signal } = options;
  const totalFrames = Math.max(1, Math.ceil(totalVideoDurationSec * fps));
  const startWallMs = performance.now();

  onProgress({
    phase: 'preparing',
    renderedFrames: 0,
    totalFrames,
    progressPct: 0,
    elapsedRenderSec: 0,
    estimatedRemainingSec: 0,
    format: 'mp4',
  });

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: targetWidth,
      height: targetHeight,
    },
    fastStart: 'in-memory',
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  encoder.configure(encoderConfig);

  const frameDurationMicros = Math.round(1_000_000 / fps);
  const keyframeIntervalSec = VIDEO_QUALITY_CONFIG[quality].keyframeIntervalSec;
  const keyFrameEvery = Math.max(1, Math.round(fps * keyframeIntervalSec));
  let scaleCanvas: HTMLCanvasElement | null = null;

  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    if (signal.aborted) {
      try {
        encoder.close();
      } catch {
        // ignore
      }
      throw new DOMException('Video export cancelled by user', 'AbortError');
    }
    if (encoderError) {
      throw encoderError;
    }

    const videoTimeSec = Math.min(totalVideoDurationSec, frameIdx / fps);
    const compositeCanvas = await renderFrameAtVideoTime(videoTimeSec);
    const frameSourceCanvas = createScaledFrameCanvas(
      compositeCanvas,
      targetWidth,
      targetHeight,
      scaleCanvas
    );
    if (frameSourceCanvas !== compositeCanvas) {
      scaleCanvas = frameSourceCanvas;
    }

    // Backpressure relief if hardware encoder queue gets full
    while (encoder.encodeQueueSize > 10) {
      await new Promise((r) => setTimeout(r, 4));
    }

    const timestampMicros = frameIdx * frameDurationMicros;
    const videoFrame = new VideoFrame(frameSourceCanvas, {
      timestamp: timestampMicros,
      duration: frameDurationMicros,
    });

    const isKeyFrame = frameIdx % keyFrameEvery === 0;
    encoder.encode(videoFrame, { keyFrame: isKeyFrame });
    videoFrame.close();

    const renderedFrames = frameIdx + 1;
    const elapsedRenderSec = (performance.now() - startWallMs) / 1000;
    const rate = renderedFrames / Math.max(0.1, elapsedRenderSec);
    const remainingFrames = totalFrames - renderedFrames;

    onProgress({
      phase: 'rendering',
      renderedFrames,
      totalFrames,
      progressPct: Math.round((renderedFrames / totalFrames) * 100),
      elapsedRenderSec,
      estimatedRemainingSec: remainingFrames / Math.max(0.1, rate),
      format: 'mp4',
    });

    // Yield briefly to keep UI responsive without triggering 1000ms background-tab setTimeout throttling
    if (frameIdx % 5 === 0) {
      await new Promise<void>((resolve) => {
        if (typeof MessageChannel !== 'undefined') {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => resolve();
          channel.port2.postMessage(null);
        } else {
          setTimeout(resolve, 0);
        }
      });
    }
  }

  onProgress({
    phase: 'finalizing',
    renderedFrames: totalFrames,
    totalFrames,
    progressPct: 99,
    elapsedRenderSec: (performance.now() - startWallMs) / 1000,
    estimatedRemainingSec: 0,
    format: 'mp4',
  });

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  onProgress({
    phase: 'completed',
    renderedFrames: totalFrames,
    totalFrames,
    progressPct: 100,
    elapsedRenderSec: (performance.now() - startWallMs) / 1000,
    estimatedRemainingSec: 0,
    format: 'mp4',
  });

  return { blob, extension: 'mp4' };
}

async function exportWithMediaRecorder(
  options: VideoExportOptions,
  targetWidth: number,
  targetHeight: number,
  bitrate: number,
  fps: number
): Promise<{ blob: Blob; extension: 'mp4' | 'webm' }> {
  const { totalVideoDurationSec, renderFrameAtVideoTime, onProgress, signal } = options;
  const totalFrames = Math.max(1, Math.ceil(totalVideoDurationSec * fps));
  const startWallMs = performance.now();

  const firstComposite = await renderFrameAtVideoTime(0);
  let scaleCanvas: HTMLCanvasElement | null = null;
  const captureCanvas = createScaledFrameCanvas(
    firstComposite,
    targetWidth,
    targetHeight,
    scaleCanvas
  );
  if (captureCanvas !== firstComposite) {
    scaleCanvas = captureCanvas;
  }
  const stream = captureCanvas.captureStream(fps);

  const mimeTypes = [
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const selectedMime =
    mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const extension: 'mp4' | 'webm' = selectedMime.includes('mp4') ? 'mp4' : 'webm';

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: selectedMime,
    videoBitsPerSecond: bitrate,
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: selectedMime }));
    };
    recorder.onerror = (ev) => reject(ev);
  });

  recorder.start(250);

  const frameIntervalMs = 1000 / fps;
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    if (signal.aborted) {
      recorder.stop();
      throw new DOMException('Video export cancelled by user', 'AbortError');
    }
    const videoTimeSec = Math.min(totalVideoDurationSec, frameIdx / fps);
    const comp = await renderFrameAtVideoTime(videoTimeSec);
    createScaledFrameCanvas(comp, targetWidth, targetHeight, scaleCanvas);

    const renderedFrames = frameIdx + 1;
    const elapsedRenderSec = (performance.now() - startWallMs) / 1000;
    onProgress({
      phase: 'rendering',
      renderedFrames,
      totalFrames,
      progressPct: Math.round((renderedFrames / totalFrames) * 100),
      elapsedRenderSec,
      estimatedRemainingSec: ((totalFrames - renderedFrames) * frameIntervalMs) / 1000,
      format: extension,
    });

    await new Promise((r) => setTimeout(r, frameIntervalMs));
  }

  recorder.stop();
  const blob = await stopPromise;

  onProgress({
    phase: 'completed',
    renderedFrames: totalFrames,
    totalFrames,
    progressPct: 100,
    elapsedRenderSec: (performance.now() - startWallMs) / 1000,
    estimatedRemainingSec: 0,
    format: extension,
  });

  return { blob, extension };
}
