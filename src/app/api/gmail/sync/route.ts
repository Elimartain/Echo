import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { summarizeEmailThread } from "@/lib/ai";
import { fetchRecentThreads, threadToStorageShape } from "@/lib/gmail";
import { generateEmbedding, toPgVectorLiteral } from "@/lib/embeddings";

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!user || !session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!session.provider_token) {
      return NextResponse.json(
        { error: "Missing provider token. Sign out and sign in again with Google consent." },
        { status: 400 },
      );
    }

    const { data: syncState } = await supabase
      .from("user_sync_state")
      .select("last_gmail_sync_at")
      .eq("user_id", user.id)
      .maybeSingle();

    const rawThreads = await fetchRecentThreads(
      session.provider_token,
      80,
      syncState?.last_gmail_sync_at ?? null,
    );
    let processed = 0;

    for (const rawThread of rawThreads) {
      const shape = threadToStorageShape(rawThread, user.id);

      await supabase.from("email_threads").upsert(shape.thread, {
        onConflict: "gmail_thread_id",
        ignoreDuplicates: false,
      });
      await supabase.from("email_messages").upsert(shape.messages, {
        onConflict: "gmail_message_id",
        ignoreDuplicates: false,
      });

      const threadText = shape.messages
        .map((m) => `[${m.sent_at}] ${m.sender}\nSubject: ${m.subject}\n${m.snippet}\n${m.body_text}`)
        .join("\n\n");

      const insights = await summarizeEmailThread(threadText);
      const threadEmbedding = await generateEmbedding(
        `${shape.thread.subject}\n${insights.summary}\n${insights.commitments.join("\n")}\n${insights.actionItems.join("\n")}`,
      );

      await supabase
        .from("email_threads")
        .update({
          summary: insights.summary,
          key_points: insights.keyPoints,
          action_items: insights.actionItems,
          commitments: insights.commitments,
          needs_follow_up: insights.needsFollowUp,
          embedding: toPgVectorLiteral(threadEmbedding),
        })
        .eq("gmail_thread_id", shape.thread.gmail_thread_id)
        .eq("user_id", user.id);

      const taskRows = [...insights.actionItems, ...insights.commitments, ...insights.followUps].map(
        (item) => ({
          user_id: user.id,
          source: "email",
          source_ref: shape.thread.gmail_thread_id,
          title: item,
          status: "pending",
          urgency: insights.deadlines.some((d) => item.toLowerCase().includes(d.toLowerCase())) ? 2 : 1,
        }),
      );

      if (taskRows.length > 0) {
        const taskRowsWithEmbeddings = await Promise.all(
          taskRows.map(async (task) => ({
            ...task,
            embedding: toPgVectorLiteral(await generateEmbedding(task.title)),
          })),
        );
        await supabase
          .from("tasks")
          .upsert(taskRowsWithEmbeddings, {
            onConflict: "user_id,source,source_ref,title",
            ignoreDuplicates: true,
          });
      }

      processed += 1;
    }

    await supabase.from("user_sync_state").upsert({
      user_id: user.id,
      last_gmail_sync_at: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      threadsProcessed: processed,
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    return NextResponse.json({ error: message, ok: false }, { status: 500 });
  }
}
