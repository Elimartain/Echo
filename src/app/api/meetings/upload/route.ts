import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { summarizeMeetingTranscript } from "@/lib/ai";
import { transcribeWithWhisper } from "@/lib/whisper";
import { generateEmbedding, toPgVectorLiteral } from "@/lib/embeddings";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized", ok: false }, { status: 401 });
    }

    const formData = await request.formData();
    const audio = formData.get("audio");
    const fallbackTitle = String(formData.get("title") ?? "Meeting");

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "Missing audio file.", ok: false }, { status: 400 });
    }

    const audioBuffer = Buffer.from(await audio.arrayBuffer());
    const extension = (audio.name.split(".").pop() || "webm").toLowerCase();
    const transcript = await transcribeWithWhisper(audioBuffer, extension);
    const insights = await summarizeMeetingTranscript(transcript);
    const title = insights.title?.trim() || fallbackTitle;
    const meetingEmbedding = await generateEmbedding(
      `${title}\n${insights.summary}\n${insights.tasks.join("\n")}`,
    );

    const { data: inserted, error } = await supabase
      .from("meetings")
      .insert({
        user_id: user.id,
        title,
        transcript,
        summary: insights.summary,
        decisions: insights.decisions,
        tasks: insights.tasks,
        unresolved_actions: insights.unresolvedActions,
        embedding: toPgVectorLiteral(meetingEmbedding),
        occurred_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message, ok: false }, { status: 500 });
    }

    const taskRows = insights.tasks.map((task) => ({
      user_id: user.id,
      source: "meeting",
      source_ref: inserted.id,
      title: task,
      status: "pending",
      urgency: /today|tomorrow|asap|urgent|deadline/i.test(task) ? 2 : 1,
    }));

    if (taskRows.length > 0) {
      const embeddedRows = await Promise.all(
        taskRows.map(async (task) => ({
          ...task,
          embedding: toPgVectorLiteral(await generateEmbedding(task.title)),
        })),
      );
      await supabase
        .from("tasks")
        .upsert(embeddedRows, {
          onConflict: "user_id,source,source_ref,title",
          ignoreDuplicates: true,
        });
    }

    return NextResponse.json({
      ok: true,
      meetingId: inserted.id,
      title,
      summary: insights.summary,
      decisions: insights.decisions,
      tasks: insights.tasks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meeting upload failed.";
    return NextResponse.json({ error: message, ok: false }, { status: 500 });
  }
}
