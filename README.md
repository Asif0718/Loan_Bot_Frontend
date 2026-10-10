# Loan Voice Desk

React and Tailwind frontend for live Retell browser calls, customer profiles, transcripts, and saved call history.

## Run locally

Start the FastAPI backend on port 8000, then:

```powershell
npm install
npm run dev
```

Open `http://localhost:3000` and allow microphone access when starting a conversation.

## Configuration

The app defaults to `http://localhost:8000`. To use another backend, copy `.env.example` to `.env` and set:

```text
VITE_API_URL=https://your-backend.example.com
```

The backend must allow the frontend origin through `ALLOWED_ORIGINS`. Retell webhook events `call_started`, `transcript_updated`, `call_ended`, and `call_analyzed` must be enabled for live history and final analysis storage.
