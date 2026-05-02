"use client";

import { useCallback, useRef, useState } from "react";

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

type Props = {
  title: string;
  hint?: string;
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  inputId: string;
};

export function ImageDropZone({ title, hint, files, onAdd, onRemove, inputId }: Props) {
  const [dragActive, setDragActive] = useState(false);
  const depth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    depth.current += 1;
    setDragActive(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setDragActive(false);
      const dt = e.dataTransfer;
      if (!dt?.files?.length) return;
      onAdd(Array.from(dt.files));
    },
    [onAdd],
  );

  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <div
        className={`mt-1 flex flex-col items-center justify-center rounded-xl border border-dashed px-3 py-6 transition ${
          dragActive
            ? "border-sky-400 bg-sky-950/40 ring-2 ring-sky-500/30"
            : "border-slate-600/80 bg-slate-900/30 hover:border-sky-500/40"
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label={title}
          onChange={(e) => {
            if (e.target.files?.length) onAdd(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        <p className="text-center text-xs text-slate-400">
          Drop or{" "}
          <button
            type="button"
            className="text-sky-400 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-300"
            onClick={() => inputRef.current?.click()}
          >
            browse
          </button>
        </p>
        {hint ? <p className="mt-1 text-center text-[11px] text-slate-600">{hint}</p> : null}
      </div>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/50 px-2 py-1.5 text-xs text-slate-300"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">{f.name}</div>
                <div className="text-[10px] text-slate-500">{formatFileSize(f.size)}</div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="shrink-0 rounded px-1.5 py-0.5 text-rose-400 hover:bg-rose-950/50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
