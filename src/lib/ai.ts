import Groq from "groq-sdk";
import { z } from "zod";
import type { EchoMeetingInsights, EchoThreadInsights } from "./types";

const threadSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  actionItems: z.array(z.string()),
  commitments: z.array(z.string()),
  deadlines: z.array(z.string()).default([]),
  followUps: z.array(z.string()).default([]),
  needsFollowUp: z.boolean().default(false),
});

const meetingSchema = z.object({
  title: z.string().default("Meeting"),
  summary: z.string(),
  decisions: z.array(z.string()),
  tasks: z.array(z.string()),
  unresolvedActions: z.boolean().default(true),
});

const askSchema = z.object({
  answer: z.string(),
  keyPoints: z.array(z.string()),
  decisionsOrRequests: z.array(z.string()),
  sourceReferences: z.array(z.string()),
});

const forgettingSchema = z.object({
  missedCommitments: z.array(z.string()),
  suggestedFollowUps: z.array(z.string()),
  warnings: z.array(z.string()),
});

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY.");
  }
  return new Groq({ apiKey });
}

function safeJsonParse<T>(raw: string, schema: z.ZodSchema<T>, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    return schema.parse(parsed);
  } catch {
    return fallback;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGroqRateLimit(error: unknown): boolean {
  const msg =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: string }).message)
      : String(error);
  return /429|rate_limit|Rate limit/i.test(msg);
}

function threadInsightsStub(content: string, note: string): EchoThreadInsights {
  const preview = content.trim().slice(0, 450).replace(/\s+/g, " ");
  return {
    summary: preview
      ? `${preview}${preview.length >= 450 ? "…" : ""}`
      : note,
    keyPoints: note !== preview ? [note] : [],
    actionItems: [],
    commitments: [],
    deadlines: [],
    followUps: [],
    needsFollowUp: false,
  };
}

async function summarizeEmailThreadWithModel(
  model: string,
  content: string,
): Promise<EchoThreadInsights> {
  const client = getGroqClient();
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are Echo, focused on preventing missed follow-ups. Return valid JSON only.",
      },
      {
        role: "user",
        content: `Analyze this email thread. Aggressively extract user promises, follow-ups, and deadlines.
Return JSON keys:
- summary: string
- keyPoints: string[]
- actionItems: string[]
- commitments: string[]
- deadlines: string[]
- followUps: string[]
- needsFollowUp: boolean\n\n${content}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return safeJsonParse(raw, threadSchema, {
    summary: "No summary available.",
    keyPoints: [],
    actionItems: [],
    commitments: [],
    deadlines: [],
    followUps: [],
    needsFollowUp: false,
  });
}

/** Truncates input and falls back to a cheaper model on rate limits; never throws. */
export async function summarizeEmailThread(content: string): Promise<EchoThreadInsights> {
  const truncated = content.slice(0, 12000);
  const primary = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  const fallback = process.env.GROQ_MODEL_FALLBACK ?? "llama-3.1-8b-instant";

  try {
    return await summarizeEmailThreadWithModel(primary, truncated);
  } catch (primaryError) {
    if (isGroqRateLimit(primaryError)) await sleep(2000);
    try {
      return await summarizeEmailThreadWithModel(fallback, truncated);
    } catch {
      return threadInsightsStub(
        truncated,
        "Summary skipped (Groq daily limit or error). Emails are still saved — try again tomorrow or set GROQ_MODEL_FALLBACK to a smaller model.",
      );
    }
  }
}

async function summarizeMeetingTranscriptWithModel(
  model: string,
  transcript: string,
): Promise<EchoMeetingInsights> {
  const client = getGroqClient();
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are Echo, extracting meeting outcomes and unresolved tasks. Return JSON only.",
      },
      {
        role: "user",
        content: `From this transcript:
- generate a short title
- summarize
- extract decisions
- extract explicit tasks/follow-ups/deadlines
- determine if unresolved actions remain
Return JSON keys: title, summary, decisions, tasks, unresolvedActions.\n\n${transcript}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return safeJsonParse(raw, meetingSchema, {
    title: "Meeting",
    summary: "No summary available.",
    decisions: [],
    tasks: [],
    unresolvedActions: true,
  });
}

export async function summarizeMeetingTranscript(
  transcript: string,
): Promise<EchoMeetingInsights> {
  const truncated = transcript.slice(0, 24000);
  const primary = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  const fallback = process.env.GROQ_MODEL_FALLBACK ?? "llama-3.1-8b-instant";
  try {
    return await summarizeMeetingTranscriptWithModel(primary, truncated);
  } catch (primaryError) {
    if (isGroqRateLimit(primaryError)) await sleep(2000);
    try {
      return await summarizeMeetingTranscriptWithModel(fallback, truncated);
    } catch {
      const preview = truncated.trim().slice(0, 500).replace(/\s+/g, " ");
      return {
        title: "Meeting",
        summary: preview
          ? `${preview}${preview.length >= 500 ? "…" : ""}`
          : "Transcript saved; summary skipped (Groq limit).",
        decisions: [],
        tasks: [],
        unresolvedActions: true,
      };
    }
  }
}

async function answerQuestionWithModel(
  model: string,
  question: string,
  contextBlocks: Array<{ title: string; body: string }>,
) {
  const client = getGroqClient();
  const context = contextBlocks
    .map((block) => `${block.title}\n${block.body}`)
    .join("\n\n---\n\n")
    .slice(0, 28000);

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "Respond like a memory assistant recalling prior work context. Return JSON only.",
      },
      {
        role: "user",
        content: `Question: ${question}\n\nContext:\n${context}\n\nReturn JSON with keys:
- answer (direct answer)
- keyPoints (array)
- decisionsOrRequests (array)
- sourceReferences (array of exact source titles from context you actually used)`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return safeJsonParse(raw, askSchema, {
    answer: "I couldn't find enough context yet.",
    keyPoints: ["No relevant context was found in indexed emails or meetings."],
    decisionsOrRequests: [],
    sourceReferences: [],
  });
}

export async function answerQuestion(
  question: string,
  contextBlocks: Array<{ title: string; body: string }>,
) {
  const primary = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  const fallback = process.env.GROQ_MODEL_FALLBACK ?? "llama-3.1-8b-instant";
  try {
    return await answerQuestionWithModel(primary, question, contextBlocks);
  } catch (primaryError) {
    if (isGroqRateLimit(primaryError)) await sleep(2000);
    try {
      return await answerQuestionWithModel(fallback, question, contextBlocks);
    } catch {
      return {
        answer:
          "Echo hit your Groq daily token limit. Try again after the reset, set GROQ_MODEL to a smaller model (e.g. llama-3.1-8b-instant), or upgrade tier at console.groq.com.",
        keyPoints: [
          "Your indexed emails/meetings are still in the database — only the AI answer step failed.",
        ],
        decisionsOrRequests: [],
        sourceReferences: [],
      };
    }
  }
}

async function analyzeForgettingWithModel(
  model: string,
  contextBlocks: Array<{ title: string; body: string }>,
) {
  const client = getGroqClient();
  const context = contextBlocks
    .map((c) => `${c.title}\n${c.body}`)
    .join("\n\n---\n\n")
    .slice(0, 28000);
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You detect forgotten commitments and unclosed loops. Be practical and concise. Return JSON only.",
      },
      {
        role: "user",
        content: `Review context and identify:
- missed commitments
- suggested follow-ups
- risks/warnings
Return JSON keys: missedCommitments, suggestedFollowUps, warnings.\n\n${context}`,
      },
    ],
    response_format: { type: "json_object" },
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  return safeJsonParse(raw, forgettingSchema, {
    missedCommitments: [],
    suggestedFollowUps: [],
    warnings: [],
  });
}

export async function analyzeWhatUserIsForgetting(
  contextBlocks: Array<{ title: string; body: string }>,
) {
  const primary = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  const fallback = process.env.GROQ_MODEL_FALLBACK ?? "llama-3.1-8b-instant";
  try {
    return await analyzeForgettingWithModel(primary, contextBlocks);
  } catch (primaryError) {
    if (isGroqRateLimit(primaryError)) await sleep(2000);
    try {
      return await analyzeForgettingWithModel(fallback, contextBlocks);
    } catch {
      return {
        missedCommitments: [],
        suggestedFollowUps: [],
        warnings: [
          "Groq daily token limit reached. Try again later or switch GROQ_MODEL to llama-3.1-8b-instant in .env.local.",
        ],
      };
    }
  }
}
