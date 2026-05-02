import OpenAI from "openai";
import { NextResponse } from "next/server";

export const maxDuration = 120;

const MAX_BYTES_PER_FILE = 4 * 1024 * 1024;
const MAX_FRQ_IMAGES = 4;
const MAX_RUBRIC_IMAGES = 6;
const MAX_STUDENT_IMAGES = 8;

function fileToDataUrl(buffer: Buffer, mime: string): string {
  const b64 = buffer.toString("base64");
  return `data:${mime};base64,${b64}`;
}

/** Browsers often send `application/octet-stream` or empty type for camera rolls / exports. */
function inferImageMime(file: File): string {
  const raw = (file.type || "").trim().toLowerCase();
  if (raw.startsWith("image/")) {
    return file.type.trim();
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  if (ext && byExt[ext]) {
    return byExt[ext];
  }
  if (raw === "application/octet-stream" || raw === "binary/octet-stream" || raw === "") {
    return "image/jpeg";
  }
  return "image/jpeg";
}

async function fileToImagePart(file: File): Promise<OpenAI.Chat.ChatCompletionContentPart | null> {
  if (!file.size) return null;
  if (file.size > MAX_BYTES_PER_FILE) {
    throw new Error(`Each image must be under ${MAX_BYTES_PER_FILE / (1024 * 1024)} MB.`);
  }
  const mime = inferImageMime(file);
  const buf = Buffer.from(await file.arrayBuffer());
  return {
    type: "image_url",
    image_url: { url: fileToDataUrl(buf, mime), detail: "high" },
  };
}

async function filesToImageParts(files: File[]): Promise<OpenAI.Chat.ChatCompletionContentPart[]> {
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
  for (const file of files) {
    const p = await fileToImagePart(file);
    if (p) parts.push(p);
  }
  return parts;
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY. Copy .env.example to .env.local and add your key." },
      { status: 500 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const hint =
      msg.includes("size") || msg.includes("limit") || msg.includes("exceeded")
        ? " Request may be too large — use fewer or smaller photos."
        : "";
    return NextResponse.json({ error: `Could not read upload.${hint}` }, { status: 400 });
  }

  const problem = String(formData.get("problem") ?? "").trim();
  const rubric = String(formData.get("rubric") ?? "").trim();
  const frqFiles = formData.getAll("frq_images").filter((v): v is File => v instanceof File);
  const rubricFiles = formData.getAll("rubric_images").filter((v): v is File => v instanceof File);
  const studentFiles = formData.getAll("images").filter((v): v is File => v instanceof File);

  const hasRubricText = rubric.length > 0;
  const hasRubricImages = rubricFiles.some((f) => f.size > 0);
  if (!hasRubricText && !hasRubricImages) {
    return NextResponse.json(
      { error: "Provide a rubric as text and/or upload rubric images." },
      { status: 400 },
    );
  }

  const studentNonEmpty = studentFiles.filter((f) => f.size > 0);
  if (studentNonEmpty.length === 0) {
    return NextResponse.json({ error: "Upload at least one image of student work." }, { status: 400 });
  }

  if (frqFiles.length > MAX_FRQ_IMAGES) {
    return NextResponse.json({ error: `At most ${MAX_FRQ_IMAGES} FRQ images.` }, { status: 400 });
  }
  if (rubricFiles.length > MAX_RUBRIC_IMAGES) {
    return NextResponse.json({ error: `At most ${MAX_RUBRIC_IMAGES} rubric images.` }, { status: 400 });
  }
  if (studentNonEmpty.length > MAX_STUDENT_IMAGES) {
    return NextResponse.json({ error: `At most ${MAX_STUDENT_IMAGES} student work images.` }, { status: 400 });
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o";

  const system = `You are an experienced AP Calculus BC exam reader. Score ONLY the student's handwritten/typed submission using the instructor's rubric.

Hard rules (violations are grading failures):
1) **Consistency:** Your "Summary score" MUST equal the sum of points you award in the rubric walkthrough. If you say a criterion is NOT earned, you must NOT count it in the total. Before you finish, re-check arithmetic and wording so you never contradict yourself.
2) **Setup vs answer:** If the rubric separates "correct setup" from "correct answer", award setup only when the mathematical setup is actually correct. A correct numeric result caused by inconsistent limits/denominators should still lose setup points when the rubric requires a correct average-value / integral / interval structure.
3) **Average value / definite integrals:** If the student writes an average value with denominator (b-a) but integrates over a different interval, or mixes limits (e.g. 1/(3-0) with ∫_0^4), treat that as a substantive setup error unless the rubric explicitly allows recovery. Call this out explicitly.
4) Follow the rubric literally for partial credit; if ambiguous, state assumptions briefly.
5) If handwriting is unreadable, say so—do not invent steps.
6) Use Markdown in your reply: headings (##), bullet lists, and **bold** for point labels. Use LaTeX math: inline $...$ and display $$...$$ when needed.
7) This is practice feedback, not an official College Board score.`;

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [];

  userContent.push({
    type: "text",
    text: `## Typed FRQ prompt (may be empty if images provided below)
${problem || "(none)"}

## Typed rubric (may be empty if rubric images provided below)
${hasRubricText ? rubric : "(none — use rubric images)"}

---

When both typed text and images exist for the same section, prefer **images** if they disagree (images are usually copied from the official PDF).

You will receive image groups in this order:
1) Optional FRQ/problem statement images from the instructor.
2) Optional rubric images from the instructor.
3) **Student work to grade** (always last).`,
  });

  const frqNonEmpty = frqFiles.filter((f) => f.size > 0);
  if (frqNonEmpty.length > 0) {
    userContent.push({
      type: "text",
      text: `### Instructor images: FRQ / problem statement (${frqNonEmpty.length} page(s))`,
    });
    try {
      userContent.push(...(await filesToImageParts(frqNonEmpty)));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "FRQ image error" }, { status: 400 });
    }
  }

  const rubricNonEmpty = rubricFiles.filter((f) => f.size > 0);
  if (rubricNonEmpty.length > 0) {
    userContent.push({
      type: "text",
      text: `### Instructor images: scoring rubric (${rubricNonEmpty.length} page(s))`,
    });
    try {
      userContent.push(...(await filesToImageParts(rubricNonEmpty)));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Rubric image error" }, { status: 400 });
    }
  }

  userContent.push({
    type: "text",
    text: `### Student submission — grade this work (${studentNonEmpty.length} image(s))

End with three sections: **Summary score** (must match your walkthrough), **Rubric walkthrough**, **Strengths & priority improvement**.`,
  });

  try {
    userContent.push(...(await filesToImageParts(studentNonEmpty)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Student image error" }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    });

    const text = completion.choices[0]?.message?.content;
    if (!text) {
      return NextResponse.json({ error: "Empty model response." }, { status: 502 });
    }

    return NextResponse.json({ text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "OpenAI request failed.";
    const status =
      err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : 502;
    return NextResponse.json({ error: message }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
