"use client";

import { prepareImagesForUpload } from "@/lib/prepareImage";
import { useCallback, useRef, useState } from "react";

function isImageFile(f: File): boolean {
  if (f.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tif{1,2})$/i.test(f.name);
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function Home() {
  const [problem, setProblem] = useState("");
  const [rubric, setRubric] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadInfo, setUploadInfo] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: File[]) => {
    const images = incoming.filter(isImageFile);
    if (images.length === 0 && incoming.length > 0) {
      setError("Only image files are accepted (e.g. PNG, JPEG, HEIC).");
      return;
    }
    if (images.length) {
      setError("");
      setFiles((prev) => [...prev, ...images]);
    }
  }, []);

  const onFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      addFiles(Array.from(list));
    },
    [addFiles],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
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
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragActive(false);
      const dt = e.dataTransfer;
      if (!dt?.files?.length) return;
      addFiles(Array.from(dt.files));
    },
    [addFiles],
  );

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setUploadInfo("");
    setResult("");
    if (!files.length) {
      setError("Add at least one image of the student work.");
      return;
    }
    if (!rubric.trim()) {
      setError("Paste a scoring rubric.");
      return;
    }
    setLoading(true);
    try {
      const { files: readyFiles, warnings } = await prepareImagesForUpload(files);
      if (warnings.length) {
        setUploadInfo(warnings.join("\n"));
      }

      const totalBytes = readyFiles.reduce((n, f) => n + f.size, 0);
      if (totalBytes > 4_200_000) {
        setError(
          "Prepared images are still too large for one request (~4 MB on many hosts). Remove a page or lower scan resolution.",
        );
        return;
      }

      const fd = new FormData();
      fd.set("problem", problem);
      fd.set("rubric", rubric);
      for (const f of readyFiles) fd.append("images", f);
      const res = await fetch("/api/grade", { method: "POST", body: fd });
      const data: { text?: string; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Request failed.");
        return;
      }
      setResult(data.text ?? "");
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 pb-20">
      <header className="mb-10">
        <p className="text-sm font-medium tracking-wide text-sky-400/90">Practice tool</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          AP Calculus BC — FRQ grader
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-400">
          Upload scans or photos of student work, paste the FRQ and rubric, and get rubric-aligned feedback. Not an
          official AP score — always review results yourself.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section
          className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 p-5 shadow-xl shadow-black/20 backdrop-blur-sm"
          aria-labelledby="upload-heading"
        >
          <h2 id="upload-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Student work
          </h2>
          <div
            className={`mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-10 transition ${
              dragActive
                ? "border-sky-400 bg-sky-950/40 ring-2 ring-sky-500/30"
                : "border-slate-600 bg-slate-900/40 hover:border-sky-500/50 hover:bg-slate-900/60"
            }`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label="Choose image files"
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <p className="text-center text-sm text-slate-300">
              Drop images here{" "}
              <span className="text-slate-500">or</span>{" "}
              <button
                type="button"
                className="text-sky-400 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-300"
                onClick={() => fileInputRef.current?.click()}
              >
                browse
              </button>
            </p>
            <p className="mt-1 text-center text-xs text-slate-500">
              Images are resized to JPEG before upload (clearer for grading and smaller uploads).
            </p>
          </div>
          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/50 px-3 py-2 text-sm text-slate-300"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{f.name}</div>
                    <div className="text-xs text-slate-500">{formatFileSize(f.size)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-rose-400 hover:bg-rose-950/50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 p-5 backdrop-blur-sm">
          <label htmlFor="problem" className="text-sm font-semibold text-slate-300">
            FRQ prompt <span className="font-normal text-slate-500">(optional but recommended)</span>
          </label>
          <textarea
            id="problem"
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            rows={5}
            placeholder="Paste the full FRQ text…"
            className="mt-2 w-full resize-y rounded-xl border border-[var(--border)] bg-slate-950/50 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
          />
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 p-5 backdrop-blur-sm">
          <label htmlFor="rubric" className="text-sm font-semibold text-slate-300">
            Scoring rubric <span className="text-rose-400/90">*</span>
          </label>
          <textarea
            id="rubric"
            required
            value={rubric}
            onChange={(e) => setRubric(e.target.value)}
            rows={10}
            placeholder="Paste point breakdown / scoring notes…"
            className="mt-2 w-full resize-y rounded-xl border border-[var(--border)] bg-slate-950/50 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
          />
        </section>

        {uploadInfo && (
          <p className="rounded-xl border border-amber-900/50 bg-amber-950/25 px-4 py-3 text-sm text-amber-100 whitespace-pre-wrap">
            {uploadInfo}
          </p>
        )}

        {error && (
          <p className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Grading…" : "Grade with OpenAI"}
        </button>
      </form>

      {result && (
        <section
          className="mt-10 rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 p-5 backdrop-blur-sm"
          aria-live="polite"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Feedback</h2>
          <pre
            className="mt-4 whitespace-pre-wrap font-[family-name:var(--font-mono)] text-[13px] leading-relaxed text-slate-200"
            style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
          >
            {result}
          </pre>
        </section>
      )}
    </main>
  );
}
