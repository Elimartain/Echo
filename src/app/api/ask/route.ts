import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { answerQuestion } from "@/lib/ai";
import { generateEmbedding, toPgVectorLiteral } from "@/lib/embeddings";
import { fuzzyIncludes, parseQueryIntent } from "@/lib/query-intent";

type EmailRow = {
  gmail_thread_id: string;
  subject: string;
  summary: string | null;
  key_points: string[] | null;
  action_items: string[] | null;
  commitments: string[] | null;
  participants?: string[] | null;
  last_message_at?: string;
};
type MeetingRow = {
  id: string;
  title: string;
  summary: string | null;
  decisions: string[] | null;
  tasks: string[] | null;
  transcript?: string | null;
  occurred_at?: string;
};
type TaskRow = {
  id: string;
  title: string;
  status: string;
  source: string;
  source_ref: string | null;
};

function toTerms(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2);
}

function overlapScore(query: string, body: string) {
  const q = new Set(toTerms(query));
  if (q.size === 0) return 0;
  const b = new Set(toTerms(body));
  let hits = 0;
  q.forEach((token) => {
    if (b.has(token)) hits += 1;
  });
  return hits / q.size;
}

export async function POST(request: Request) {
  try {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { question } = (await request.json()) as { question?: string };
  if (!question?.trim()) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }

  const query = question.trim();
  const parsed = parseQueryIntent(query);
  const queryEmbedding = toPgVectorLiteral(await generateEmbedding(query));

  const [{ data: emailSemantic }, { data: meetingSemantic }, { data: taskSemantic }] =
    await Promise.all([
      supabase.rpc("match_email_threads", {
        query_embedding: queryEmbedding,
        match_user_id: user.id,
        match_count: 5,
      }),
      supabase.rpc("match_meetings", {
        query_embedding: queryEmbedding,
        match_user_id: user.id,
        match_count: 5,
      }),
      supabase.rpc("match_tasks", {
        query_embedding: queryEmbedding,
        match_user_id: user.id,
        match_count: 8,
      }),
    ]);

  const fallback = async () => {
    const [{ data: emailRows }, { data: meetingRows }, { data: taskRows }] = await Promise.all([
      supabase
        .from("email_threads")
        .select(
          "gmail_thread_id,subject,summary,key_points,action_items,commitments,participants,last_message_at",
        )
        .eq("user_id", user.id)
        .or(`subject.ilike.%${query}%,summary.ilike.%${query}%`)
        .gte("last_message_at", parsed.startAt ?? "1970-01-01T00:00:00.000Z")
        .lte("last_message_at", parsed.endAt ?? "2999-01-01T00:00:00.000Z")
        .order("last_message_at", { ascending: false })
        .limit(12),
      supabase
        .from("meetings")
        .select("id,title,summary,decisions,tasks,transcript,occurred_at")
        .eq("user_id", user.id)
        .or(`title.ilike.%${query}%,summary.ilike.%${query}%`)
        .gte("occurred_at", parsed.startAt ?? "1970-01-01T00:00:00.000Z")
        .lte("occurred_at", parsed.endAt ?? "2999-01-01T00:00:00.000Z")
        .order("occurred_at", { ascending: false })
        .limit(12),
      supabase
        .from("tasks")
        .select("id,title,status,source,source_ref,created_at")
        .eq("user_id", user.id)
        .or(`title.ilike.%${query}%`)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    return { emailRows, meetingRows, taskRows };
  };

  const semanticAvailable =
    (emailSemantic?.length ?? 0) + (meetingSemantic?.length ?? 0) + (taskSemantic?.length ?? 0) > 0;
  const { emailRows, meetingRows, taskRows } = semanticAvailable
    ? {
        emailRows: (emailSemantic ?? []) as EmailRow[],
        meetingRows: (meetingSemantic ?? []) as MeetingRow[],
        taskRows: (taskSemantic ?? []) as TaskRow[],
      }
    : ((await fallback()) as {
        emailRows: EmailRow[] | null;
        meetingRows: MeetingRow[] | null;
        taskRows: TaskRow[] | null;
      });

  const peopleTokens = parsed.people;
  const filteredEmails = (emailRows ?? []).filter((row) => {
    if (peopleTokens.length === 0) return true;
    const haystack = `${row.subject} ${row.summary ?? ""} ${(row.participants ?? []).join(" ")}`;
    return peopleTokens.some((token) => fuzzyIncludes(haystack, token));
  });
  const filteredMeetings = (meetingRows ?? []).filter((row) => {
    if (peopleTokens.length === 0) return true;
    const haystack = `${row.title} ${row.summary ?? ""} ${row.transcript ?? ""}`;
    return peopleTokens.some((token) => fuzzyIncludes(haystack, token));
  });
  const filteredTasks = (taskRows ?? []).filter((row) => {
    if (peopleTokens.length === 0) return true;
    return peopleTokens.some((token) => fuzzyIncludes(row.title, token));
  });

  const contextBlocks = [
    ...filteredEmails.map((row) => ({
      type: "email" as const,
      sourceId: row.gmail_thread_id,
      title: `Email: ${row.subject}`,
      timestamp: row.last_message_at ?? "",
      body: `Summary: ${row.summary ?? ""}\nKey Points: ${(row.key_points ?? []).join(", ")}\nAction Items: ${(row.action_items ?? []).join(", ")}\nCommitments: ${(row.commitments ?? []).join(", ")}`,
    })),
    ...filteredMeetings.map((row) => ({
      type: "meeting" as const,
      sourceId: row.id,
      title: `Meeting: ${row.title}`,
      timestamp: row.occurred_at ?? "",
      body: `Summary: ${row.summary ?? ""}\nDecisions: ${(row.decisions ?? []).join(", ")}\nTasks: ${(row.tasks ?? []).join(", ")}`,
    })),
    ...filteredTasks.map((row) => ({
      type: "task" as const,
      sourceId: row.id,
      title: `Task: ${row.title}`,
      timestamp: "",
      body: `Status: ${row.status}\nSource: ${row.source}:${row.source_ref}`,
    })),
  ]
    .map((item) => ({
      ...item,
      score:
        overlapScore(
          query,
          `${item.title}\n${item.body}`,
        ) +
        (parsed.intent === "commitments" && /Commitments:/i.test(item.body) ? 0.25 : 0) +
        (parsed.intent === "decisions" && /Decisions:/i.test(item.body) ? 0.25 : 0) +
        (parsed.intent === "tasks" && /(Tasks:|Action Items:)/i.test(item.body) ? 0.25 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const topContext = contextBlocks.slice(0, 12);

  const ai = await answerQuestion(
    `${query}\nIntent: ${parsed.intent}\nPeople: ${parsed.people.join(", ") || "none"}\nTime: ${parsed.startAt ?? "any"} to ${parsed.endAt ?? "any"}`,
    topContext.map((c) => ({ title: c.title, body: c.body })),
  );

  const sourceByTitle = new Map(topContext.map((source) => [source.title, source]));
  const referencedSources = ai.sourceReferences
    .map((title) => sourceByTitle.get(title))
    .filter((v): v is NonNullable<typeof v> => Boolean(v));
  const fallbackSources = topContext.slice(0, 6);
  const finalSources = referencedSources.length > 0 ? referencedSources : fallbackSources;

  return NextResponse.json({
    answer: ai.answer,
    keyPoints: ai.keyPoints,
    decisionsOrRequests: ai.decisionsOrRequests,
    sources: finalSources.map((s) => ({
      type: s.type,
      sourceId: s.sourceId,
      title: s.title,
      timestamp: s.timestamp,
    })),
    retrievalMode: semanticAvailable ? "semantic" : "keyword",
    parsedIntent: parsed,
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ask Echo failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
