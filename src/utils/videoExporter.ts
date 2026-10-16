import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { VIDEO_HEIGHT, VIDEO_WIDTH } from './hudRenderer';

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
  fps: 30 | 60;
  totalVideoDurationSec: number;
  renderFrameAtVideoTime: (videoTimeSec: number) => Promise<HTMLCanvasElement>;
  onProgress: (progress: VideoExportProgress) => void;
  signal: AbortSignal;
}

/**
 * Checks whether the browser supports offline WebCodecs H.264 MP4 encoding at 1920x1080.
 */
export async function supportsWebCodecsMp4(fps: number): Promise<boolean> {
  if (typeof window === 'undefined' || !('VideoEncoder' in window)) {
    return false;
  }
  const codecsToTry = [
    'avc1.640028', // High Profile Level 4.0 (1080p60 capable)
    'avc1.4d0028', // Main Profile Level 4.0
    'avc1.420028', // Baseline Profile Level 4.0
  ];
  for (const codec of codecsToTry) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
        bitrate: 12_000_000,
        framerate: fps,
      });
      if (support.supported) return true;
    } catch {
      // try next profile
    }
  }
  return false;
}

async function resolveSupportedAvcCodec(fps: number): Promise<string> {
  const codecsToTry = ['avc1.640028', 'avc1.4d0028', 'avc1.420028'];
  for (const codec of codecsToTry) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
        bitrate: 12_000_000,
        framerate: fps,
      });
      if (support.supported) return codec;
    } catch {
      // continue
    }
  }
  return 'avc1.420028';
}

/**
 * Exports a Full HD (1920x1080) video in the browser using WebCodecs + mp4-muxer (offline frame-by-frame)
 * with an automatic fallback to MediaRecorder if WebCodecs is unsupported.
 */
export async function exportFullHdVideo(
  options: VideoExportOptions
): Promise<{ blob: Blob; extension: 'mp4' | 'webm' }> {
  const canUseWebCodecs = await supportsWebCodecsMp4(options.fps);
  if (canUseWebCodecs) {
    return exportWithWebCodecsMp4(options);
  }
  return exportWithMediaRecorder(options);
}

async function exportWithWebCodecsMp4(
  options: VideoExportOptions
): Promise<{ blob: Blob; extension: 'mp4' }> {
  const { fps, totalVideoDurationSec, renderFrameAtVideoTime, onProgress, signal } = options;
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

  const codec = await resolveSupportedAvcCodec(fps);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
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

  encoder.configure({
    codec,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    bitrate: 12_000_000,
    framerate: fps,
  });

  const frameDurationMicros = Math.round(1_000_000 / fps);

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

    // Backpressure relief if hardware encoder queue gets full
    while (encoder.encodeQueueSize > 10) {
      await new Promise((r) => setTimeout(r, 4));
    }

    const timestampMicros = frameIdx * frameDurationMicros;
    const videoFrame = new VideoFrame(compositeCanvas, {
      timestamp: timestampMicros,
      duration: frameDurationMicros,
    });

    const isKeyFrame = frameIdx % (fps * 2) === 0;
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
  options: VideoExportOptions
): Promise<{ blob: Blob; extension: 'mp4' | 'webm' }> {
  const { fps, totalVideoDurationSec, renderFrameAtVideoTime, onProgress, signal } = options;
  const totalFrames = Math.max(1, Math.ceil(totalVideoDurationSec * fps));
  const startWallMs = performance.now();

  const firstCanvas = await renderFrameAtVideoTime(0);
  const stream = firstCanvas.captureStream(fps);

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
    videoBitsPerSecond: 12_000_000,
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
    await renderFrameAtVideoTime(videoTimeSec);

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
