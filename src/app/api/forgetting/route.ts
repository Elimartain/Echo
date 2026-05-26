import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeWhatUserIsForgetting } from "@/lib/ai";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: pendingTasks }, { data: noReplyThreads }, { data: unresolvedMeetings }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("title,source,created_at")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("urgency", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("email_threads")
        .select("subject,summary,commitments,action_items,last_message_at")
        .eq("user_id", user.id)
        .eq("needs_follow_up", true)
        .order("last_message_at", { ascending: false })
        .limit(10),
      supabase
        .from("meetings")
        .select("title,summary,tasks,occurred_at")
        .eq("user_id", user.id)
        .eq("unresolved_actions", true)
        .order("occurred_at", { ascending: false })
        .limit(10),
    ]);

  const context = [
    ...(pendingTasks ?? []).map((t) => ({
      title: `Pending task (${t.source})`,
      body: `${t.title} | created_at=${t.created_at}`,
    })),
    ...(noReplyThreads ?? []).map((e) => ({
      title: `Follow-up email thread: ${e.subject}`,
      body: `Summary: ${e.summary ?? ""}\nCommitments: ${(e.commitments ?? []).join(", ")}\nAction items: ${(e.action_items ?? []).join(", ")}`,
    })),
    ...(unresolvedMeetings ?? []).map((m) => ({
      title: `Unresolved meeting: ${m.title}`,
      body: `Summary: ${m.summary ?? ""}\nTasks: ${(m.tasks ?? []).join(", ")}`,
    })),
  ];

  const analysis = await analyzeWhatUserIsForgetting(context);
  return NextResponse.json(analysis);
}
