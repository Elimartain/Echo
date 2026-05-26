# Echo

Echo is an AI memory assistant that helps you capture, summarize, and search context from emails and meetings.

## Tech Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS
- Supabase (Auth + Postgres)
- Gmail API
- Groq API
- whisper.cpp (local transcription)

## Demo Screenshot

Add your screenshot here after upload:

`![Echo Demo](./public/demo.png)`

## Run Locally

1. Install dependencies:
   - `npm install`
2. Create env file:
   - Copy `.env.example` to `.env.local`
   - Fill all required values
3. Create database schema:
   - Run `supabase/schema.sql` in your Supabase SQL editor
4. Configure Google OAuth in Supabase:
   - Enable Google provider
   - Add redirect URL: `http://localhost:3000/auth/callback`
5. (Optional for meetings) Install `whisper.cpp` and model, then set:
   - `WHISPER_CPP_BIN`
   - `WHISPER_MODEL_PATH`
6. Start development server:
   - `npm run dev`
7. Open:
   - `http://localhost:3000`

## LinkedIn

**[Anish Raj](https://in.linkedin.com/in/anish-raj-3976b029b)**

LinkedIn profile badge (for websites that allow the embed script):

```html
<div class="badge-base LI-profile-badge" data-locale="en_US" data-size="medium" data-theme="light" data-type="HORIZONTAL" data-vanity="anish-raj-3976b029b" data-version="v1"><a class="badge-base__link LI-simple-link" href="https://in.linkedin.com/in/anish-raj-3976b029b?trk=profile-badge">Anish Raj</a></div>
<script src="https://platform.linkedin.com/badges/js/profile.js" async defer type="text/javascript"></script>
```
