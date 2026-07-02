# CareGuruPlus — Ava Health Chatbot (Fixed Beginner Version)

This version fixes the local testing problem: `/chat` no longer completely fails when Claude/Infermedica keys are missing or invalid.

Ava now works in this order:

1. Anthropic Claude, if `ANTHROPIC_API_KEY` is added.
2. Local Ollama, if Ollama is running.
3. Safe demo fallback replies, so the widget still responds while you are learning.

## Run Backend

```bash
cd backend
npm install
copy .env.example .env
npm run dev
```

Mac/Linux:

```bash
cp .env.example .env
npm run dev
```

Test in browser:

```text
http://localhost:3000/
```

Test chat with PowerShell:

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/chat -ContentType "application/json" -Body '{"message":"hello","session_id":"test1"}'
```

## Optional: Use free local AI with Ollama

Install Ollama, then run:

```bash
ollama pull llama3
ollama serve
```

Keep Ollama running. In another terminal, run the backend.

## Frontend Test

Open `frontend/widget.html` using VS Code Live Server.

If the widget says connection error, check that the backend terminal says:

```text
Ava backend listening on http://localhost:3000
```

## Important Safety Notes

- This is not a diagnosis tool.
- Emergency keywords bypass AI and return emergency guidance immediately.
- Do not store real patient health data until consent, privacy, and legal rules are reviewed.
