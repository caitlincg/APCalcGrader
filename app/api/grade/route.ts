import OpenAI from "openai";
import { NextResponse } from "next/server";

export const maxDuration = 120;

const MAX_FILES = 8;
const MAX_BYTES_PER_FILE = 4 * 1024 * 1024; // stay under typical serverless limits

function fileToDataUrl(buffer: Buffer, mime: string): string {
  const b64 = buffer.toString("base64");
  return `data:${mime};base64,${b64}`;
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
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const problem = String(formData.get("problem") ?? "").trim();
  const rubric = String(formData.get("rubric") ?? "").trim();
  const files = formData.getAll("images").filter((v): v is File => v instanceof File);

  if (!rubric) {
    return NextResponse.json({ error: "Rubric is required." }, { status: 400 });
  }
  if (files.length === 0) {
    return NextResponse.json({ error: "Upload at least one image." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `At most ${MAX_FILES} images per request.` }, { status: 400 });
  }

  const imageParts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (const file of files) {
    if (!file.size) continue;
    if (file.size > MAX_BYTES_PER_FILE) {
      return NextResponse.json(
        { error: `Each image must be under ${MAX_BYTES_PER_FILE / (1024 * 1024)} MB.` },
        { status: 400 },
      );
    }
    const mime = file.type || "image/jpeg";
    if (!mime.startsWith("image/")) {
      return NextResponse.json({ error: "Only image uploads are supported." }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    imageParts.push({
      type: "image_url",
      image_url: { url: fileToDataUrl(buf, mime), detail: "high" },
    });
  }

  if (imageParts.length === 0) {
    return NextResponse.json({ error: "No valid image files." }, { status: 400 });
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o";

  const system = `You are an experienced AP Calculus BC exam reader. Your job is to score free-response student work using ONLY the rubric provided by the teacher.

Rules:
- Course is AP Calculus BC. Use correct calculus terminology and notation in feedback.
- Award partial credit exactly as the rubric describes; if the rubric is ambiguous, state your assumptions briefly.
- Reference rubric bullets or point rows when you assign or deny credit.
- If handwriting or the scan is unreadable for a portion, say what is illegible and do not invent work.
- Output clear sections: (1) Summary score, (2) Rubric walkthrough, (3) Brief strengths and one priority improvement.
- This is practice feedback for a classroom tool, not an official College Board score.`;

  const userText = `## FRQ stem / prompt (may be partial)
${problem || "(Not provided — infer context only from the rubric and images.)"}

## Scoring rubric (authoritative)
${rubric}

## Instructions
The following ${imageParts.length} image(s) are scans of one student's work for this FRQ. Read all pages, then score and explain per the rubric. Use LaTeX-style math in plain text where helpful (e.g. $\\int_0^1 x\\,dx$).`;

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "text", text: userText },
    ...imageParts,
  ];

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
