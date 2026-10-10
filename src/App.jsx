import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ClockCounterClockwise,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  Plus,
  User,
  Waveform,
  X,
} from "@phosphor-icons/react";
import { RetellWebClient } from "retell-client-js-sdk";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function api(path, options) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed with status ${response.status}`);
  }
  return response.json();
}

function transcriptItems(update) {
  const transcript =
    update?.transcript_object || update?.transcript || update?.data?.transcript || [];
  if (!Array.isArray(transcript)) return [];
  return transcript
    .map((item, index) => ({
      id: item.id || `${item.role || "turn"}-${index}`,
      role: item.role || item.speaker || "agent",
      text: item.content || item.text || item.transcript || "",
    }))
    .filter((item) => item.text);
}

function formatDate(timestamp) {
  if (!timestamp) return "Awaiting details";
  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(milliseconds));
}

function formatDuration(milliseconds) {
  if (!milliseconds) return "0:00";
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function App() {
  const retellRef = useRef(null);
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [calls, setCalls] = useState([]);
  const [selectedCall, setSelectedCall] = useState(null);
  const [status, setStatus] = useState("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isAgentTalking, setIsAgentTalking] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState("");
  const [isProfileFormOpen, setIsProfileFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId],
  );
  const isActive = status === "connecting" || status === "live";

  const loadProfiles = useCallback(async () => {
    const result = await api("/api/profiles?limit=100");
    setProfiles(result.items);
    setSelectedProfileId((current) => current || result.items[0]?.id || "");
  }, []);

  const loadCalls = useCallback(async () => {
    const path = selectedProfileId
      ? `/api/profiles/${selectedProfileId}/calls?limit=50`
      : "/api/calls?limit=50";
    const result = await api(path);
    setCalls(result.items);
  }, [selectedProfileId]);

  useEffect(() => {
    Promise.all([loadProfiles(), api("/api/calls?limit=50").then((data) => setCalls(data.items))])
      .catch((requestError) => setError(requestError.message))
      .finally(() => setIsLoading(false));
  }, [loadProfiles]);

  useEffect(() => {
    if (!selectedProfileId) return;
    loadCalls().catch((requestError) => setError(requestError.message));
  }, [loadCalls, selectedProfileId]);

  useEffect(() => {
    if (!isActive) return undefined;
    const timer = window.setInterval(() => {
      loadCalls().catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isActive, loadCalls]);

  useEffect(
    () => () => {
      retellRef.current?.stopCall();
      retellRef.current = null;
    },
    [],
  );

  async function startCall() {
    if (!selectedProfileId || isActive) return;
    setError("");
    setTranscript([]);
    setSelectedCall(null);
    setStatus("connecting");

    try {
      const session = await api("/api/calls/start", {
        method: "POST",
        body: JSON.stringify({ profile_id: selectedProfileId, agent_name: "Ananya" }),
      });
      const client = new RetellWebClient();
      retellRef.current = client;

      client.on("call_started", () => setStatus("live"));
      client.on("call_ready", () => setStatus("live"));
      client.on("call_ended", () => {
        setStatus("ended");
        setIsMuted(false);
        setIsAgentTalking(false);
        window.setTimeout(() => loadCalls().catch(() => {}), 1500);
      });
      client.on("agent_start_talking", () => setIsAgentTalking(true));
      client.on("agent_stop_talking", () => setIsAgentTalking(false));
      client.on("update", (update) => setTranscript(transcriptItems(update)));
      client.on("error", (callError) => {
        setError(typeof callError === "string" ? callError : "The call could not connect.");
        setStatus("error");
      });

      await client.startCall({
        accessToken: session.access_token,
        transport: session.transport,
        callId: session.call_id,
        iceServers: session.ice_servers,
      });
    } catch (callError) {
      setError(callError.message);
      setStatus("error");
    }
  }

  function endCall() {
    retellRef.current?.stopCall();
    retellRef.current = null;
    setStatus("ended");
    setIsMuted(false);
    setIsAgentTalking(false);
    window.setTimeout(() => loadCalls().catch(() => {}), 1500);
  }

  function toggleMute() {
    if (!retellRef.current) return;
    if (isMuted) retellRef.current.unmute();
    else retellRef.current.mute();
    setIsMuted((current) => !current);
  }

  async function openCall(callId) {
    try {
      setSelectedCall(await api(`/api/calls/${callId}`));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createProfile(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const profile = await api("/api/profiles", {
        method: "POST",
        body: JSON.stringify({
          customer_name: data.get("customer_name"),
          language_to_speak: data.get("language_to_speak"),
          phone: data.get("phone") || null,
        }),
      });
      await loadProfiles();
      setSelectedProfileId(profile.id);
      setIsProfileFormOpen(false);
      event.currentTarget.reset();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-canvas text-ink">
      <header className="border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-navy text-white">
              <Waveform size={21} weight="bold" />
            </span>
            <div>
              <p className="font-semibold tracking-tight">Loan Voice Desk</p>
              <p className="text-xs text-muted">Live customer assessment</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className={`status-light ${error ? "bg-danger" : "bg-success"}`} />
            {error ? "Needs attention" : "Backend connected"}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)_330px]">
        <aside className="panel p-3 lg:sticky lg:top-5 lg:h-[calc(100dvh-6.5rem)]">
          <div className="flex items-center justify-between px-2 py-2">
            <h2 className="font-semibold">Profiles</h2>
            <button className="icon-button" onClick={() => setIsProfileFormOpen(true)} aria-label="Create profile">
              <Plus size={18} />
            </button>
          </div>
          <div className="mt-2 space-y-1 overflow-auto lg:max-h-[calc(100dvh-12rem)]">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                className={`profile-row ${selectedProfileId === profile.id ? "profile-row-active" : ""}`}
                onClick={() => setSelectedProfileId(profile.id)}
              >
                <span className="profile-avatar">{profile.customer_name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm font-semibold">{profile.customer_name}</span>
                  <span className="block truncate text-xs text-muted">{profile.language_to_speak}</span>
                </span>
              </button>
            ))}
            {!isLoading && profiles.length === 0 && (
              <button className="empty-action" onClick={() => setIsProfileFormOpen(true)}>
                Create your first profile
              </button>
            )}
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          {error && (
            <div className="flex items-start justify-between rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error"><X size={17} /></button>
            </div>
          )}

          <div className="call-stage">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted">Current conversation</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {selectedProfile?.customer_name || "Select a customer"}
                </h1>
              </div>
              <span className={`call-status call-status-${status}`}>{status}</span>
            </div>

            <div className="voice-center">
              <div className={`voice-orb ${isActive ? "voice-orb-active" : ""} ${isAgentTalking ? "voice-orb-speaking" : ""}`}>
                <Waveform size={42} weight="light" />
              </div>
              <p className="mt-5 text-lg font-semibold">
                {status === "connecting" && "Connecting securely"}
                {status === "live" && (isAgentTalking ? "Ananya is speaking" : "Listening to customer")}
                {(status === "idle" || status === "ended") && "Ready for a new assessment"}
                {status === "error" && "Call connection failed"}
              </p>
              <p className="mt-1 max-w-md text-center text-sm leading-6 text-muted">
                {isActive
                  ? "Keep this tab open. The transcript and call outcome are saved automatically."
                  : "Choose a profile, then start the call and allow microphone access."}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              {!isActive ? (
                <button className="primary-button" onClick={startCall} disabled={!selectedProfileId}>
                  <Microphone size={20} weight="fill" /> Start conversation
                </button>
              ) : (
                <>
                  <button className="secondary-button" onClick={toggleMute}>
                    {isMuted ? <MicrophoneSlash size={20} /> : <Microphone size={20} />}
                    {isMuted ? "Unmute" : "Mute"}
                  </button>
                  <button className="danger-button" onClick={endCall}>
                    <PhoneDisconnect size={20} weight="fill" /> End call
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="panel min-h-72 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Live transcript</h2>
              {isActive && <span className="text-xs text-muted">Updates during the call</span>}
            </div>
            <div className="mt-5 space-y-4" aria-live="polite">
              {transcript.map((item) => (
                <div key={item.id} className={`transcript-line ${item.role === "agent" ? "transcript-agent" : ""}`}>
                  <span className="transcript-speaker">{item.role === "agent" ? "Ananya" : selectedProfile?.customer_name || "Customer"}</span>
                  <p>{item.text}</p>
                </div>
              ))}
              {transcript.length === 0 && (
                <div className="grid min-h-48 place-items-center text-center text-sm text-muted">
                  <div><Waveform className="mx-auto mb-3" size={28} /><p>Conversation text will appear here.</p></div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="panel overflow-hidden lg:sticky lg:top-5 lg:h-[calc(100dvh-6.5rem)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-4">
            <div className="flex items-center gap-2"><ClockCounterClockwise size={19} /><h2 className="font-semibold">Call history</h2></div>
            <button className="icon-button" onClick={() => loadCalls().catch((e) => setError(e.message))} aria-label="Refresh calls">
              <ArrowClockwise size={17} />
            </button>
          </div>
          <div className="history-list">
            {calls.map((call) => (
              <button key={call.retell_call_id} className="history-row" onClick={() => openCall(call.retell_call_id)}>
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold">{call.customer_name || "Unknown customer"}</span>
                  <span className={`outcome ${call.call_successful ? "outcome-good" : ""}`}>{call.call_successful ? "Complete" : call.call_status}</span>
                </span>
                <span className="mt-2 flex items-center justify-between text-xs text-muted">
                  <span>{formatDate(call.created_at)}</span><span>{formatDuration(call.duration_ms)}</span>
                </span>
              </button>
            ))}
            {!isLoading && calls.length === 0 && <p className="p-6 text-center text-sm text-muted">No conversations for this profile yet.</p>}
          </div>
        </aside>
      </div>

      {isProfileFormOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsProfileFormOpen(false)}>
          <form className="modal" onSubmit={createProfile} onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div><h2 className="text-xl font-semibold">New customer profile</h2><p className="mt-1 text-sm text-muted">Use these details to personalize the call.</p></div>
              <button type="button" className="icon-button" onClick={() => setIsProfileFormOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <label className="field"><span>Customer name</span><input name="customer_name" required maxLength="200" placeholder="Rahul Sharma" autoFocus /></label>
            <label className="field"><span>Language</span><select name="language_to_speak" defaultValue="English"><option>English</option><option>Hindi</option><option>Marathi</option><option>Tamil</option><option>Telugu</option></select></label>
            <label className="field"><span>Phone number</span><input name="phone" type="tel" placeholder="+91 99999 99999" /></label>
            <button className="primary-button w-full justify-center" type="submit"><User size={19} /> Create profile</button>
          </form>
        </div>
      )}

      {selectedCall && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedCall(null)}>
          <article className="modal call-detail" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-sm text-muted">Saved conversation</p><h2 className="mt-1 text-xl font-semibold">{selectedCall.customer_name || "Call details"}</h2></div>
              <button className="icon-button" onClick={() => setSelectedCall(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="detail-grid"><div><span>Duration</span><strong>{formatDuration(selectedCall.duration_ms)}</strong></div><div><span>Sentiment</span><strong>{selectedCall.user_sentiment || "Not analyzed"}</strong></div></div>
            <section><h3>Summary</h3><p>{selectedCall.call_summary || "Analysis is still processing."}</p></section>
            <section><h3>Transcript</h3><p className="whitespace-pre-wrap">{selectedCall.transcript || "Transcript is not available yet."}</p></section>
            {selectedCall.recording_url && (
              <section>
                <h3>Recording</h3>
                <audio className="w-full" controls preload="metadata" src={selectedCall.recording_url}>
                  Your browser does not support audio playback.
                </audio>
              </section>
            )}
          </article>
        </div>
      )}
    </main>
  );
}
