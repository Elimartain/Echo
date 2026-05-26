import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const sourceId = searchParams.get("sourceId");
  if (!type || !sourceId) {
    return NextResponse.json({ error: "type and sourceId are required" }, { status: 400 });
  }

  if (type === "email") {
    const { data: thread } = await supabase
      .from("email_threads")
      .select("subject,summary,last_message_at")
      .eq("user_id", user.id)
      .eq("gmail_thread_id", sourceId)
      .maybeSingle();
    const { data: messages } = await supabase
      .from("email_messages")
      .select("sender,snippet,body_text,sent_at")
      .eq("user_id", user.id)
      .eq("gmail_thread_id", sourceId)
      .order("sent_at", { ascending: false })
      .limit(5);
    return NextResponse.json({
      title: thread?.subject ?? "Email thread",
      timestamp: thread?.last_message_at ?? null,
      snippet:
        messages
          ?.map((m) => `[${new Date(m.sent_at).toLocaleString()}] ${m.sender}\n${m.snippet}\n${m.body_text.slice(0, 400)}`)
          .join("\n\n---\n\n") ?? "",
    });
  }

  if (type === "meeting") {
    const { data } = await supabase
      .from("meetings")
      .select("title,summary,occurred_at,transcript")
      .eq("user_id", user.id)
      .eq("id", sourceId)
      .maybeSingle();
    return NextResponse.json({
      title: data?.title ?? "Meeting",
      timestamp: data?.occurred_at ?? null,
      snippet: `${data?.summary ?? ""}\n\n${(data?.transcript ?? "").slice(0, 1200)}`,
    });
  }

  if (type === "task") {
    const { data } = await supabase
      .from("tasks")
      .select("title,source,status,created_at")
      .eq("user_id", user.id)
      .eq("id", sourceId)
      .maybeSingle();
    return NextResponse.json({
      title: data?.title ?? "Task",
      timestamp: data?.created_at ?? null,
      snippet: `Source: ${data?.source ?? ""}\nStatus: ${data?.status ?? ""}`,
    });
  }

  return NextResponse.json({ error: "Unsupported source type" }, { status: 400 });
}
