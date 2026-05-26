import { google } from "googleapis";

type GmailThread = {
  id: string;
  messages?: Array<{
    id?: string;
    snippet?: string;
    payload?: {
      headers?: Array<{ name?: string; value?: string }>;
      parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
      body?: { data?: string };
    };
    internalDate?: string;
  }>;
};

function decodeBase64Url(input: string) {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf-8",
  );
}

function extractBody(message: NonNullable<GmailThread["messages"]>[number]) {
  const payload = message.payload;
  if (!payload) return "";
  const inlineData = payload.body?.data;
  if (inlineData) return decodeBase64Url(inlineData);
  const textPart = payload.parts?.find((p) => p.mimeType === "text/plain");
  if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
  return "";
}

function getHeader(message: NonNullable<GmailThread["messages"]>[number], name: string) {
  return (
    message.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

export async function fetchRecentThreads(
  accessToken: string,
  maxResults = 50,
  syncedAfter?: string | null,
) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const afterQuery = syncedAfter
    ? `after:${Math.floor(new Date(syncedAfter).getTime() / 1000)}`
    : "newer_than:90d";

  const listRes = await gmail.users.threads.list({
    userId: "me",
    maxResults,
    q: afterQuery,
  });

  const threadIds = listRes.data.threads?.map((thread) => thread.id).filter(Boolean) as string[];
  const threadResults = await Promise.all(
    threadIds.map((id) =>
      gmail.users.threads.get({
        userId: "me",
        id,
        format: "full",
      }),
    ),
  );

  return threadResults.map((result) => result.data as GmailThread);
}

export function threadToStorageShape(thread: GmailThread, userId: string) {
  const messages = (thread.messages ?? []).map((message) => {
    const sender = getHeader(message, "From");
    const subject = getHeader(message, "Subject") || "(No subject)";
    const sentAt = message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : new Date().toISOString();

    return {
      user_id: userId,
      gmail_message_id: message.id ?? crypto.randomUUID(),
      gmail_thread_id: thread.id,
      sender,
      subject,
      snippet: message.snippet ?? "",
      body_text: extractBody(message).slice(0, 12000),
      sent_at: sentAt,
    };
  });

  const recent = messages[messages.length - 1];
  return {
    thread: {
      user_id: userId,
      gmail_thread_id: thread.id,
      subject: recent?.subject ?? "(No subject)",
      participants: Array.from(new Set(messages.map((m) => m.sender).filter(Boolean))),
      last_message_at: recent?.sent_at ?? new Date().toISOString(),
      message_count: messages.length,
    },
    messages,
  };
}
