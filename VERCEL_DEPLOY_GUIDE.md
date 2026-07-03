# CareGuruPlus Ava — Vercel Deploy Guide

This project is ready for Vercel backend deployment.

## Important behavior online

- Local Ollama will not run on Vercel because it runs only on your laptop.
- Online backend will still support emergency safety, structured symptom flow, service buttons, fallback replies, and optional Anthropic/Infermedica if keys are added.
- File-based chat logging is disabled automatically on Vercel. Use a real database later for production logs.

## Local backend test

```powershell
cd backend
npm install
copy .env.example .env
npm run dev
```

Open:

```text
http://localhost:3000
```

Test:

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/chat -ContentType "application/json" -Body '{"message":"hello","session_id":"test1"}' | Format-List
```

## Vercel settings

When importing the GitHub repo in Vercel:

```text
Framework Preset: Other
Root Directory: backend
Build Command: leave empty
Install Command: npm install
Output Directory: leave empty
```

Add these environment variables in Vercel:

```env
NODE_ENV=production
FILE_LOGGING_ENABLED=false
OLLAMA_BASE_URL=
OLLAMA_MODEL=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
INFERMEDICA_APP_ID=
INFERMEDICA_APP_KEY=
INFERMEDICA_DEV_MODE=false
```

## Test deployed backend

Replace the URL with your actual Vercel URL:

```powershell
Invoke-RestMethod -Method Post https://YOUR-PROJECT.vercel.app/chat -ContentType "application/json" -Body '{"message":"i have fever and headache","session_id":"vercel-test-1"}' | Format-List
```

Expected provider:

```text
details-flow
```

Emergency test:

```powershell
Invoke-RestMethod -Method Post https://YOUR-PROJECT.vercel.app/chat -ContentType "application/json" -Body '{"message":"i have chest pain","session_id":"vercel-test-2"}' | Format-List
```

Expected: emergency response.

## Connect frontend to deployed backend

Open `frontend/widget.html` and uncomment this block:

```html
<script>
  window.AVA_API_URL = "https://YOUR-PROJECT.vercel.app/chat";
</script>
```

Replace the URL with your actual Vercel URL.
