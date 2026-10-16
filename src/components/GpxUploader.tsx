import React, { useRef, useState } from 'react';
import { Upload, Mountain, FileText, AlertCircle } from 'lucide-react';

interface GpxUploaderProps {
  onLoadGpxString: (xml: string, fileName: string) => void;
  onLoadSample: () => void;
  currentTrackName?: string;
  error?: string | null;
}

export const GpxUploader: React.FC<GpxUploaderProps> = ({
  onLoadGpxString,
  onLoadSample,
  currentTrackName,
  error,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const cleanName = file.name.replace(/\.gpx$/i, '');
    onLoadGpxString(text, cleanName || 'Uploaded Ride');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFile(file);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-emerald-400" />
          <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
            GPX Route Source
          </h2>
        </div>
        {currentTrackName && (
          <span className="truncate max-w-[170px] rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300 border border-emerald-500/30">
            {currentTrackName}
          </span>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`group cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-all ${
          isDragging
            ? 'border-emerald-400 bg-emerald-500/10'
            : 'border-slate-700/80 bg-slate-950/50 hover:border-emerald-500/60 hover:bg-slate-900/80'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleFile(file);
              e.target.value = '';
            }
          }}
        />
        <Upload className="mx-auto mb-2 h-6 w-6 text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:text-emerald-400" />
        <p className="text-sm font-medium text-slate-200">
          Drop your <span className="text-emerald-400">.gpx</span> file here or click to browse
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Supports Garmin, Strava, Wahoo & Komoot GPX tracks with timestamps & sensors
        </p>
      </div>

      <button
        type="button"
        onClick={onLoadSample}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-500/50 hover:bg-slate-800 hover:text-emerald-300"
      >
        <Mountain className="h-4 w-4 text-emerald-400" />
        Load Sample Ride (Col du Galibier GPX)
      </button>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
