export type EmailMessageInsert = {
  user_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  sender: string;
  subject: string;
  snippet: string;
  body_text: string;
  sent_at: string;
};

export type EchoThreadInsights = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  commitments: string[];
  deadlines: string[];
  followUps: string[];
  needsFollowUp: boolean;
};

export type EchoMeetingInsights = {
  title: string;
  summary: string;
  decisions: string[];
  tasks: string[];
  unresolvedActions: boolean;
};
