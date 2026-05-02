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
1) **Consistency (totals must match the walkthrough):** For each rubric row, decide **earned** or **not earned**. The **Summary score** numerator MUST equal the count of rows you marked **earned**—no exceptions. If your walkthrough says **no** points are earned, the summary must be **0/N**, not **1/N** or any partial guess. Before sending, do a one-second recount: earned rows = summary numerator.
2) **The rubric is authoritative:** Award or deny each row **only** as the rubric and any printed model solution say. If the rubric explicitly allows follow-through, alternate forms, or different scoring for a wrong setup, follow **that text**. Do not invent stricter or looser rules than the document. Never claim the rubric says something it does not—quote or paraphrase the relevant line when a point is borderline.
3) **No “intention” or mind-reading:** Never award a point because the student **“clearly meant”** something different from what is on the page, or because their **intent** or **understanding** seems right. Score **only** visible work that meets the rubric’s stated criteria **as written** (plus any alternate forms the rubric explicitly names). If a row requires evidence of a specific factor, limit, or form, a **wrong** factor/form on the paper does **not** earn that row just because a later line looks like the right idea—unless the rubric text itself allows that scenario.
4) **Verify math, not vibes:** Use the **FRQ stem** (functions, intervals, units; typed and/or images) plus the **student’s own written steps** to sanity-check arithmetic. (i) If they claim a definite integral value $I$ and a prefactor $k$ (e.g. average value), check that their displayed average equals $k\\cdot I$ within reasonable rounding—if not, their arithmetic is wrong on their own paper. (ii) Call out inconsistent normalizing factors vs integration limits when you see them—but whether points are lost still follows the rubric. (iii) **Never** write that a number "correctly calculates" $A/B$ or $k\\cdot I$ unless you have mentally checked that quotient/product matches the student’s value; if $A\\div B$ does not match what they wrote, say so—do not invent agreement with the model solution or with a divisor they did not use. (iv) A tidy decimal is not evidence of correctness.
5) **Follow-through vs arithmetic:** If the rubric allows carrying an intermediate value forward, apply that rule—but **still** verify each carried value matches the student’s prior arithmetic. Follow-through does not make a wrong quotient or product "correct"; it only affects **which rubric rows** apply, per the rubric text.
6) **Setup vs answer rows:** When setup and answer are separate rubric bullets, apply each bullet on its own terms. Do **not** award an “answer” or “result” point solely because a number matches a flawed intermediate path if the rubric ties the answer to a **correct** result or to the model solution; conversely, if the rubric explicitly scores the answer based only on a displayed value or rounding rule independent of setup, follow that wording exactly.
7) **“Incorrect linkage” / scratch work (only when the rubric says so):** Some rubrics say awkward **equals-sign chains** between integral (or antiderivative) work and a final answer are treated as scratch work **not used in scoring**. That rule applies when the paper still shows the **correct** intermediate value the rubric cares about and the **correct** keyed answer from the model solution (within the rubric’s rounding rules)—messy notation alone is ignored. It does **not** mean you may award an answer point for a **wrong keyed result** just because it follows the student’s own incorrect prefactor or limits. Likewise, if a row requires **specific evidence** (e.g. the correct normalizing factor for the interval in the problem), work that shows a **different** factor does not satisfy that row unless the rubric explicitly allows it.
8) If handwriting is unreadable, say so—do not invent steps.
9) Use Markdown in your reply: headings (##), bullet lists, and **bold** for point labels. Use LaTeX math: inline $...$ and display $$...$$ when needed. In **Summary score**, include one explicit tally line, e.g. "Earned: P1 no, P2 no → **0/2**".
10) This is practice feedback, not an official College Board score.`;

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

End with three sections: **Summary score** (include an explicit earned/not tally; numerator must match walkthrough), **Rubric walkthrough**, **Strengths & priority improvement**.`,
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
