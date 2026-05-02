"use client";

import { FeedbackMarkdown } from "@/components/FeedbackMarkdown";
import { ImageDropZone } from "@/components/ImageDropZone";
import { prepareImagesForUpload } from "@/lib/prepareImage";
import { useCallback, useState } from "react";

function isImageFile(f: File): boolean {
  if (f.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tif{1,2})$/i.test(f.name);
}

export default function Home() {
  const [problem, setProblem] = useState("");
  const [rubric, setRubric] = useState("");
  const [frqImages, setFrqImages] = useState<File[]>([]);
  const [rubricImages, setRubricImages] = useState<File[]>([]);
  const [workImages, setWorkImages] = useState<File[]>([]);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadInfo, setUploadInfo] = useState("");

  const ingestImages = useCallback((incoming: File[]) => {
    const images = incoming.filter(isImageFile);
    if (images.length === 0 && incoming.length > 0) {
      setError("Only image files are accepted (e.g. PNG, JPEG, HEIC).");
      return [] as File[];
    }
    if (images.length) setError("");
    return images;
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setUploadInfo("");
    setResult("");

    const hasRubric = rubric.trim().length > 0 || rubricImages.length > 0;
    if (!hasRubric) {
      setError("Add a rubric as text and/or upload rubric images.");
      return;
    }
    if (workImages.length === 0) {
      setError("Add at least one image of student work.");
      return;
    }

    setLoading(true);
    try {
      const merged = [...frqImages, ...rubricImages, ...workImages];
      const { files: ready, warnings } = await prepareImagesForUpload(merged);
      if (warnings.length) {
        setUploadInfo(warnings.join("\n"));
      }

      let o = 0;
      const nFrq = frqImages.length;
      const nRub = rubricImages.length;
      const readyFrq = ready.slice(o, (o += nFrq));
      const readyRub = ready.slice(o, (o += nRub));
      const readyWork = ready.slice(o);

      const totalBytes = ready.reduce((n, f) => n + f.size, 0);
      if (totalBytes > 4_200_000) {
        setError(
          "Prepared uploads are still too large for one request (~4 MB on many hosts). Remove a page or split into two grading runs.",
        );
        return;
      }

      const fd = new FormData();
      fd.set("problem", problem);
      fd.set("rubric", rubric);
      for (const f of readyFrq) fd.append("frq_images", f);
      for (const f of readyRub) fd.append("rubric_images", f);
      for (const f of readyWork) fd.append("images", f);

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
          Upload student work. For the FRQ and rubric, you can paste text and/or upload screenshots so LaTeX and tables
          stay intact. Not an
          official AP score.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 p-5 shadow-xl shadow-black/20 backdrop-blur-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Student work</h2>
          <ImageDropZone
            title="Pages to grade (required)"
            hint="Photos or scans of the student’s FRQ write-up."
            files={workImages}
            inputId="work-images"
            onAdd={(incoming) => setWorkImages((prev) => [...prev, ...ingestImages(incoming)])}
            onRemove={(i) => setWorkImages((prev) => prev.filter((_, j) => j !== i))}
          />
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 p-5 backdrop-blur-sm">
          <label htmlFor="problem" className="text-sm font-semibold text-slate-300">
            FRQ prompt <span className="font-normal text-slate-500">(optional — text)</span>
          </label>
          <textarea
            id="problem"
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            rows={5}
            placeholder="Paste the FRQ, or leave blank if you upload screenshots below…"
            className="mt-2 w-full resize-y rounded-xl border border-[var(--border)] bg-slate-950/50 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
          />
          <ImageDropZone
            title="Or upload FRQ as images (optional)"
            hint="Screenshots from the exam PDF keep integral signs and notation correct."
            files={frqImages}
            inputId="frq-images"
            onAdd={(incoming) => setFrqImages((prev) => [...prev, ...ingestImages(incoming)])}
            onRemove={(i) => setFrqImages((prev) => prev.filter((_, j) => j !== i))}
          />
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 p-5 backdrop-blur-sm">
          <label htmlFor="rubric" className="text-sm font-semibold text-slate-300">
            Scoring rubric <span className="text-rose-400/90">*</span>{" "}
            <span className="font-normal text-slate-500">(text and/or images)</span>
          </label>
          <textarea
            id="rubric"
            value={rubric}
            onChange={(e) => setRubric(e.target.value)}
            rows={8}
            placeholder="Paste the rubric, or use images only below…"
            className="mt-2 w-full resize-y rounded-xl border border-[var(--border)] bg-slate-950/50 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
          />
          <ImageDropZone
            title="Or upload rubric as images (recommended for LaTeX-heavy rubrics)"
            hint="Crop from the official scoring guidelines PDF if pasting mangles math."
            files={rubricImages}
            inputId="rubric-images"
            onAdd={(incoming) => setRubricImages((prev) => [...prev, ...ingestImages(incoming)])}
            onRemove={(i) => setRubricImages((prev) => prev.filter((_, j) => j !== i))}
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
        <section className="mt-10" aria-live="polite">
          <h2 className="sr-only">Scoring feedback</h2>
          <FeedbackMarkdown text={result} />
        </section>
      )}
    </main>
  );
}
