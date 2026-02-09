import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import type { BuilderSpec } from "@/lib/types";

type AiTemplateResponse = {
  elementName?: string;
  cTypeKey?: string;
  iconName?: string;
  fieldLabels?: Record<string, string>;
  templateHtml?: string;
};

type AiUsage = {
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
  error?: {
    message?: string;
  };
};

const buildPrompt = (spec: BuilderSpec): string =>
  [
    "You are generating TYPO3 content element metadata + Fluid template suggestions.",
    "Return ONLY valid JSON, no markdown fences, no explanations.",
    "Do NOT invent field keys. Use only keys from the input spec.",
    "Use snake_case for cTypeKey and lowercase-dash style for iconName (example: content-hero-banner).",
    "templateHtml must be Fluid-compatible and include <f:layout name=\"Default\" /> and <f:section name=\"Main\">.",
    "Use {data.<fieldKey>} for regular values and media_<fieldKey> variables for media fields.",
    "JSON shape:",
    JSON.stringify(
      {
        elementName: "Human readable content element title",
        cTypeKey: "snake_case_ctype_key",
        iconName: "content-identifier",
        fieldLabels: {
          "<existing_field_key>": "Improved label"
        },
        templateHtml: "<f:layout name=\"Default\" />\n<f:section name=\"Main\">...</f:section>"
      },
      null,
      2
    ),
    "JSON SPEC:",
    JSON.stringify(spec, null, 2)
  ].join("\n\n");

const tryParseJson = (raw: string): AiTemplateResponse | null => {
  const direct = raw.trim();
  try {
    return JSON.parse(direct) as AiTemplateResponse;
  } catch {
    // continue
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as AiTemplateResponse;
  } catch {
    return null;
  }
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { spec?: BuilderSpec };
    const spec = body.spec;
    if (!spec) {
      return NextResponse.json({ ok: false, error: "Missing spec." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Missing GEMINI_API_KEY in environment." },
        { status: 503 }
      );
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-pro";
    const prompt = buildPrompt(spec);
    const requestId = randomUUID();
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.2
          }
        })
      }
    );

    const geminiJson = (await geminiResponse.json()) as GeminiGenerateResponse;
    if (!geminiResponse.ok) {
      const apiError = geminiJson?.error?.message || `Gemini request failed (${geminiResponse.status})`;
      return NextResponse.json({ ok: false, error: `${apiError} [${requestId}]` }, { status: 502 });
    }

    const raw =
      geminiJson.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("\n")
        .trim() || "";

    if (!raw) {
      return NextResponse.json({ ok: false, error: `Gemini returned empty response. [${requestId}]` }, { status: 502 });
    }

    const parsed = tryParseJson(raw);
    if (!parsed) {
      return NextResponse.json({ ok: false, error: `Gemini output was not valid JSON. [${requestId}]` }, { status: 422 });
    }

    const usage: AiUsage = {};
    usage.model = geminiJson.modelVersion || model;
    usage.inputTokens = geminiJson.usageMetadata?.promptTokenCount ?? null;
    usage.outputTokens = geminiJson.usageMetadata?.candidatesTokenCount ?? null;
    usage.totalTokens = geminiJson.usageMetadata?.totalTokenCount ?? null;

    return NextResponse.json({ ok: true, data: parsed, usage });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI generation failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
