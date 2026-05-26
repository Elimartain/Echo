"use client";

import { useMemo, useRef, useState } from "react";

type Thread = {
  gmail_thread_id: string;
  subject: string;
  summary: string | null;
  action_items: string[] | null;
  commitments: string[] | null;
  last_message_at: string;
};

type Meeting = {
  id: string;
  title: string;
  summary: string | null;
  decisions: string[] | null;
  tasks: string[] | null;
  occurred_at: string;
};

type Task = {
  id: string;
  title: string;
  source: "email" | "meeting";
  status: "pending" | "done";
  created_at: string;
  urgency: number;
};

type AskSource = {
  type: "email" | "meeting" | "task";
  sourceId: string;
  title: string;
  timestamp: string;
};

export function EchoApp({
  initialThreads,
  initialMeetings,
  initialTasks,
  lastSyncedAt,
}: {
  initialThreads: Thread[];
  initialMeetings: Meeting[];
  initialTasks: Task[];
  lastSyncedAt: string | null;
}) {
  const [threads] = useState(initialThreads);
  const [meetings] = useState(initialMeetings);
  const [tasks, setTasks] = useState(initialTasks);
  const [taskFilter, setTaskFilter] = useState<"all" | "pending" | "done">("pending");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string>("");
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [decisionsOrRequests, setDecisionsOrRequests] = useState<string[]>([]);
  const [sources, setSources] = useState<AskSource[]>([]);
  const [activeSource, setActiveSource] = useState<{
    title: string;
    timestamp: string | null;
    snippet: string;
  } | null>(null);
  const [forgetting, setForgetting] = useState<{
    missedCommitments: string[];
    suggestedFollowUps: string[];
    warnings: string[];
  } | null>(null);
  const [retrievalMode, setRetrievalMode] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const pendingTaskCount = useMemo(
    () => tasks.filter((task) => task.status === "pending").length,
    [tasks],
  );
  const visibleTasks = useMemo(
    () => tasks.filter((task) => taskFilter === "all" || task.status === taskFilter),
    [taskFilter, tasks],
  );

  async function syncGmail() {
    setBusy("sync");
    try {
      const res = await fetch("/api/gmail/sync", { method: "POST" });
      const text = await res.text();
      let data: { error?: string; ok?: boolean; threadsProcessed?: number } = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text) as typeof data;
        } catch {
          data = { error: text.slice(0, 300) || `HTTP ${res.status}` };
        }
      } else {
        data = { error: `Empty response (HTTP ${res.status})` };
      }
      if (!res.ok || data.ok === false) {
        alert(data.error ?? "Failed to sync Gmail.");
        return;
      }
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  async function askEcho() {
    if (!question.trim()) return;
    setBusy("ask");
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    setBusy(null);
    if (!res.ok) return;
    const data = await res.json();
    setAnswer(data.answer);
    setKeyPoints(data.keyPoints ?? []);
    setDecisionsOrRequests(data.decisionsOrRequests ?? []);
    setSources(data.sources ?? []);
    setRetrievalMode(data.retrievalMode ?? "");
  }

  async function openSource(source: AskSource) {
    const res = await fetch(
      `/api/source?type=${encodeURIComponent(source.type)}&sourceId=${encodeURIComponent(source.sourceId)}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    setActiveSource({
      title: data.title ?? source.title,
      timestamp: data.timestamp ?? null,
      snippet: data.snippet ?? "",
    });
  }

  async function whatAmIForgetting() {
    setBusy("forgetting");
    const res = await fetch("/api/forgetting", { method: "POST" });
    setBusy(null);
    if (!res.ok) return;
    setForgetting(await res.json());
  }

  async function updateTaskStatus(id: string, status: "pending" | "done") {
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) return;
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, status } : task)));
  }

  async function deleteTask(id: string) {
    const res = await fetch(`/api/tasks?id=${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }

  async function startMeeting() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    chunksRef.current = [];
    mediaRecorder.ondataavailable = (event) => chunksRef.current.push(event.data);
    mediaRecorder.onstop = async () => {
      setBusy("meeting");
      try {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "meeting.webm");
        form.append("title", `Meeting ${new Date().toLocaleString()}`);
        const res = await fetch("/api/meetings/upload", { method: "POST", body: form });
        const text = await res.text();
        let data: { error?: string; ok?: boolean } = {};
        if (text.trim()) {
          try {
            data = JSON.parse(text) as typeof data;
          } catch {
            data = { error: text.slice(0, 400) };
          }
        } else {
          data = { error: `Empty response (HTTP ${res.status})` };
        }
        if (!res.ok || data.ok === false) {
          alert(data.error ?? "Meeting upload failed.");
          return;
        }
        window.location.reload();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        alert(`Meeting upload request failed: ${message}`);
      } finally {
        setBusy(null);
      }
    };
    mediaRecorder.start();
    setRecorder(mediaRecorder);
  }

  function stopMeeting() {
    recorder?.stop();
    recorder?.stream.getTracks().forEach((track) => track.stop());
    setRecorder(null);
  }

  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr] bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <aside className="border-r border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-6 text-lg font-semibold">Echo</div>
        <nav className="space-y-2 text-sm">
          <div className="rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-900">Inbox</div>
          <div className="rounded-md px-3 py-2">Meetings</div>
          <div className="rounded-md px-3 py-2">Tasks</div>
        </nav>
        <div className="mt-8 rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800">
          Pending items: {pendingTaskCount}
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          Last synced: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "Never"}
        </div>
      </aside>

      <main className="grid grid-cols-[1fr_360px]">
        <section className="p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={syncGmail}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              disabled={busy !== null}
            >
              {busy === "sync" ? "Syncing..." : "Sync Gmail"}
            </button>
            {!recorder ? (
              <button
                onClick={startMeeting}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                disabled={busy !== null}
              >
                Start Meeting
              </button>
            ) : (
              <button
                onClick={stopMeeting}
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950"
              >
                Stop Recording
              </button>
            )}
            <button
              onClick={whatAmIForgetting}
              className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              disabled={busy !== null}
            >
              {busy === "forgetting" ? "Thinking..." : "What am I forgetting?"}
            </button>
          </div>

          <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="mb-2 text-lg font-semibold">Ask Echo anything</div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What did we discuss in yesterday's meeting with investors?"
              className="min-h-28 w-full rounded-md border border-zinc-300 bg-transparent p-3 text-sm outline-none dark:border-zinc-700"
            />
            <button
              onClick={askEcho}
              disabled={busy !== null}
              className="mt-3 rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy === "ask" ? "Thinking..." : "Ask"}
            </button>

            {answer && (
              <div className="mt-4 space-y-2 text-sm">
                <div className="font-medium">Answer</div>
                <p className="text-zinc-700 dark:text-zinc-300">{answer}</p>
                {!!keyPoints.length && <div className="font-medium">Key points</div>}
                {!!keyPoints.length && (
                  <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                    {keyPoints.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {!!decisionsOrRequests.length && <div className="font-medium">Decisions / requests</div>}
                {!!decisionsOrRequests.length && (
                  <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                    {decisionsOrRequests.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {retrievalMode && (
                  <div className="text-xs text-zinc-500">Retrieval: {retrievalMode}</div>
                )}
                <div className="font-medium">Sources</div>
                <div className="space-y-2">
                  {sources.map((source) => (
                    <button
                      key={`${source.type}-${source.sourceId}`}
                      onClick={() => openSource(source)}
                      className="block w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    >
                      <div className="font-medium text-zinc-700 dark:text-zinc-200">{source.title}</div>
                      <div className="text-zinc-500">
                        {source.timestamp ? new Date(source.timestamp).toLocaleString() : "No timestamp"}
                      </div>
                    </button>
                  ))}
                </div>
                {activeSource && (
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="font-medium">{activeSource.title}</div>
                    {activeSource.timestamp && (
                      <div className="mb-2 text-zinc-500">
                        {new Date(activeSource.timestamp).toLocaleString()}
                      </div>
                    )}
                    <pre className="whitespace-pre-wrap font-sans text-zinc-600 dark:text-zinc-300">
                      {activeSource.snippet}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {forgetting && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
              <div className="mb-2 font-semibold">What you might be forgetting</div>
              <div className="mb-2 text-xs uppercase text-zinc-500">Missed commitments</div>
              <ul className="mb-3 list-disc pl-5">
                {forgetting.missedCommitments.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="mb-2 text-xs uppercase text-zinc-500">Suggested follow-ups</div>
              <ul className="mb-3 list-disc pl-5">
                {forgetting.suggestedFollowUps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="mb-2 text-xs uppercase text-zinc-500">Warnings</div>
              <ul className="list-disc pl-5">
                {forgetting.warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="border-l border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-3 text-sm font-semibold">⚠ You might forget these</div>
          <div className="mb-3 flex gap-2 text-xs">
            <button
              onClick={() => setTaskFilter("all")}
              className={`rounded-md px-2 py-1 ${taskFilter === "all" ? "bg-zinc-200 dark:bg-zinc-800" : "bg-zinc-100 dark:bg-zinc-900"}`}
            >
              All
            </button>
            <button
              onClick={() => setTaskFilter("pending")}
              className={`rounded-md px-2 py-1 ${taskFilter === "pending" ? "bg-zinc-200 dark:bg-zinc-800" : "bg-zinc-100 dark:bg-zinc-900"}`}
            >
              Pending
            </button>
            <button
              onClick={() => setTaskFilter("done")}
              className={`rounded-md px-2 py-1 ${taskFilter === "done" ? "bg-zinc-200 dark:bg-zinc-800" : "bg-zinc-100 dark:bg-zinc-900"}`}
            >
              Completed
            </button>
          </div>
          <div className="mb-5 space-y-2">
            {visibleTasks.slice(0, 20).map((task) => (
              <div key={task.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="font-medium">{task.title}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {task.source} · {task.status} · {new Date(task.created_at).toLocaleDateString()}
                </div>
                <div className="mt-2 flex gap-2">
                  {task.status === "pending" ? (
                    <button
                      onClick={() => updateTaskStatus(task.id, "done")}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      Mark done
                    </button>
                  ) : (
                    <button
                      onClick={() => updateTaskStatus(task.id, "pending")}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      Reopen
                    </button>
                  )}
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 dark:border-red-900"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mb-5 opacity-70">
            <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Email Threads</div>
            <div className="space-y-2">
              {threads.slice(0, 6).map((thread) => (
                <div
                  key={thread.gmail_thread_id}
                  className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                >
                  <div className="font-medium">{thread.subject}</div>
                  <div className="mt-1 text-xs text-zinc-500">{thread.summary ?? "No summary yet."}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="opacity-70">
            <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Meetings</div>
            <div className="space-y-2">
              {meetings.slice(0, 6).map((meeting) => (
                <div
                  key={meeting.id}
                  className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                >
                  <div className="font-medium">{meeting.title}</div>
                  <div className="mt-1 text-xs text-zinc-500">{meeting.summary ?? "No summary yet."}</div>
                  {!!meeting.decisions?.length && (
                    <div className="mt-1 text-[11px] text-zinc-500">
                      Decisions: {meeting.decisions.join(" • ")}
                    </div>
                  )}
                  {!!meeting.tasks?.length && (
                    <div className="mt-1 text-[11px] text-zinc-500">
                      Tasks: {meeting.tasks.join(" • ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
