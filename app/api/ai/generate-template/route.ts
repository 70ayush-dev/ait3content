import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

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

    const outFile = path.join("/tmp", `codex-ai-${randomUUID()}.txt`);
    const prompt = buildPrompt(spec);

    const jsonEvents: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "codex",
        [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "-C",
          process.cwd(),
          "--output-last-message",
          outFile,
          prompt
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );

      let stderr = "";
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", reject);
      child.on("close", (code) => {
        const lines = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        for (const line of lines) {
          try {
            jsonEvents.push(JSON.parse(line));
          } catch {
            // Ignore non-JSON lines
          }
        }
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr || `Codex exited with code ${code}`));
      });
    });

    const raw = await fs.readFile(outFile, "utf8");
    await fs.unlink(outFile).catch(() => undefined);
    const parsed = tryParseJson(raw);
    if (!parsed) {
      return NextResponse.json({ ok: false, error: "Codex output was not valid JSON." }, { status: 422 });
    }

    const usage: AiUsage = {};
    for (const event of jsonEvents) {
      if (!event || typeof event !== "object") {
        continue;
      }
      const obj = event as Record<string, unknown>;
      const payload = (obj.payload && typeof obj.payload === "object" ? obj.payload : obj) as Record<string, unknown>;
      const model = payload.model;
      if (typeof model === "string" && !usage.model) {
        usage.model = model;
      }
      const usageObj = payload.usage && typeof payload.usage === "object" ? (payload.usage as Record<string, unknown>) : null;
      if (usageObj) {
        const input = typeof usageObj.input_tokens === "number" ? usageObj.input_tokens : null;
        const output = typeof usageObj.output_tokens === "number" ? usageObj.output_tokens : null;
        const total = typeof usageObj.total_tokens === "number" ? usageObj.total_tokens : input !== null && output !== null ? input + output : null;
        if (input !== null) usage.inputTokens = input;
        if (output !== null) usage.outputTokens = output;
        if (total !== null) usage.totalTokens = total;
      }
    }

    return NextResponse.json({ ok: true, data: parsed, usage });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI generation failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
