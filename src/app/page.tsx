import { EchoApp } from "@/components/echo-app";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
        <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-2xl font-semibold">Echo</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            AI memory for your emails and meetings.
          </p>
          <div className="mt-6">
            <SignInButton />
          </div>
        </div>
      </main>
    );
  }

  const [{ data: threads }, { data: meetings }, { data: tasks }, { data: syncState }] =
    await Promise.all([
    supabase
      .from("email_threads")
      .select("gmail_thread_id,subject,summary,action_items,commitments,last_message_at")
      .eq("user_id", user.id)
      .order("last_message_at", { ascending: false })
      .limit(25),
    supabase
      .from("meetings")
      .select("id,title,summary,decisions,tasks,occurred_at")
      .eq("user_id", user.id)
      .order("occurred_at", { ascending: false })
      .limit(25),
    supabase
      .from("tasks")
      .select("id,title,source,status,created_at,urgency")
      .eq("user_id", user.id)
      .order("urgency", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("user_sync_state")
      .select("last_gmail_sync_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    ]);

  return (
    <>
      <div className="absolute right-4 top-4 z-20">
        <SignOutButton />
      </div>
      <EchoApp
        initialThreads={threads ?? []}
        initialMeetings={meetings ?? []}
        initialTasks={tasks ?? []}
        lastSyncedAt={syncState?.last_gmail_sync_at ?? null}
      />
    </>
  );
}
