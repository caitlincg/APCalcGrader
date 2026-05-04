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

function getImageDetail(): "auto" | "low" | "high" {
  const d = (process.env.OPENAI_IMAGE_DETAIL || "auto").trim().toLowerCase();
  if (d === "low" || d === "high" || d === "auto") return d;
  return "auto";
}

function getMaxOutputTokens(): number {
  const n = Number.parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || "2048", 10);
  if (Number.isFinite(n) && n >= 512 && n <= 8192) return n;
  return 2048;
}

function getTemperature(): number {
  const t = Number.parseFloat(process.env.OPENAI_TEMPERATURE || "0.35");
  if (Number.isFinite(t) && t >= 0 && t <= 1) return t;
  return 0.35;
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
    image_url: { url: fileToDataUrl(buf, mime), detail: getImageDetail() },
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

  const system = `You are an AP Calculus BC exam reader. Score only the student's submission using the instructor rubric.

Hard rules (violations are grading failures):
1) **Score = walkthrough:** Each rubric row: **earned** or **not earned**. Summary numerator = count earned (recount before send). If none earned → **0/N**, never a guessed partial.
2) **Rubric only:** Award/deny exactly as rubric + model solution say (follow-through/alternates only if stated). Don't invent rules. Quote/paraphrase when borderline. If the rubric **lists specific acceptable values/decimals**, only those listed values count; do not treat nearby or "close" values as acceptable unless the rubric explicitly includes them.
3) **No intent credit:** Never for "meant," "intent," "understood." Visible work must match criteria **as written** (+ rubric-named alternates). Wrong written factor/limit/form fails that row unless rubric explicitly allows.
4) **Verify math/work (not just final answer):** Use FRQ stem + student steps. Check $k\\cdot I$ vs stated average; factor vs interval—points still per rubric. Never claim $A/B$ "correctly calculates" without verifying quotient/product. Tidy decimals aren't proof. If the rubric fixes a value to **three decimal places** (or names a keyed decimal), flag **inappropriate rounding** when a quotient does not round/truncate to the student’s written value, or when rounded values change mid-chain. For each earned rubric row, reference at least one concrete line/value from the student's work that supports earning that row.
5) **Follow-through:** If rubric allows carry-forward, each carried value must match prior lines; doesn't fix wrong products/quotients or which rows apply—rubric text decides.
6) **Setup vs answer:** Separate rubric lines applied separately; answer tied to keyed result per rubric wording.
7) **Linkage/scratch (only if rubric says):** Ignoring bad = chains still needs **correct** intermediate + **correct** keyed answer per rounding rules. Wrong keyed answer never earns on "linkage." Required evidence (e.g. correct normalizing factor) needs correct factor unless rubric allows otherwise.
8) Unreadable handwriting: say what; don't invent steps.
9) **Output (two sections only):** Markdown (##, lists, **bold** labels). Put **all** math in inline dollar delimiters or double-dollar display blocks—never leave raw \\frac / integrals only inside parentheses without dollar signs. **## Summary score** with explicit tally (e.g. Earned: P1 no, P2 no → **0/N**). **## Rubric walkthrough** only—no strengths, improvement tips, or third section.
10) Practice feedback only; not official AP scoring.`;

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [];

  userContent.push({
    type: "text",
    text: `## FRQ (typed; may be empty)
${problem || "(none)"}

## Rubric (typed; may be empty)
${hasRubricText ? rubric : "(none — use rubric images)"}

Images follow in order: optional FRQ pages, optional rubric pages, then **student work** (grade last group). If typed text and images disagree, trust **images**.`,
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
    text: `### Student work (${studentNonEmpty.length} image(s)) — grade these

Respond with **only** ## Summary score and ## Rubric walkthrough (no other sections).`,
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
      max_tokens: getMaxOutputTokens(),
      temperature: getTemperature(),
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
