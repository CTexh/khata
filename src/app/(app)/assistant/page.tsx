"use client";

import { useEffect, useRef, useState } from "react";
import { splitBold } from "@/lib/chat-format";
import { encodeWav } from "@/lib/wav";
import { ASSISTANT_DRAFT_KEY } from "@/lib/assistant-draft";
import { invalidate } from "@/lib/swr";
import Link from "next/link";
import { ArrowUpIcon, CameraIcon, MicIcon, SparkleIcon } from "@/components/icons";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  photo?: boolean;
  photoUrl?: string; // this session only; photos aren't kept in history
  voiceSeconds?: number;
  pending?: boolean;
  requestId?: string; // for a pending reply, so it can be picked up after a reload
  failed?: boolean;
};

type Delivery = { reply: string } | { error: string };

// History lives only in this browser. Replies can mention amounts and names,
// and the device is the user's own, so nothing is stored server-side for it.
const STORAGE_KEY = "khata-assistant-v1";
const KEEP = 60;
const MAX_VOICE_SECONDS = 60;
// How long to keep checking for a reply. The server's own work is bounded
// well inside this.
const REPLY_WAIT_MS = 90_000;
const POLL_EVERY_MS = 1_000;
const EXAMPLES = [
  "fuel 3000 shell",
  "who owes me?",
  "mark Netflix paid",
  "change the last one to 2500",
  "what did I spend this month?",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadHistory(): ChatMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m) =>
          m &&
          typeof m.id === "string" &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.text === "string"
      )
      .slice(-KEEP);
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]) {
  try {
    const kept = messages
      // A pending reply is kept only if it can be fetched again later.
      .filter((m) => !m.pending || m.requestId)
      .slice(-KEEP)
      .map(({ id, role, text, photo, voiceSeconds, pending, requestId, failed }) => ({
        id,
        role,
        text,
        photo,
        voiceSeconds,
        pending,
        requestId,
        failed,
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Storage unavailable (private browsing, full): history just isn't kept.
  }
}

// The server answers a message straight away and works on it in the
// background, so the reply is fetched separately. A connection that drops
// while waiting no longer loses the reply: checking simply continues.
async function waitForReply(requestId: string, maxMs: number): Promise<Delivery | null> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetch(`/api/assistant?id=${encodeURIComponent(requestId)}`, { cache: "no-store" });
      if (res.status === 401) return { error: "Please log in again." };
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.status === "done") return { reply: typeof data.reply === "string" && data.reply ? data.reply : "Done." };
      } else if (res.status === 404 && Date.now() - started > 8_000) {
        // Still unknown after a few seconds: the message never arrived.
        return null;
      }
    } catch {
      // A network blip: keep checking.
    }
    await sleep(POLL_EVERY_MS);
  }
  return { error: "This is taking longer than usual. Check Mera Khata or Udhar Khata before sending it again." };
}

async function deliver(form: FormData, requestId: string): Promise<Delivery> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("/api/assistant", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { error: typeof data.error === "string" ? data.error : "Something went wrong. Please try again." };
      }
      if (data.status === "done") return { reply: typeof data.reply === "string" && data.reply ? data.reply : "Done." };
      break;
    } catch {
      // The upload dropped. It may still have arrived, so the retry reuses the
      // same id and the server won't process it twice.
      await sleep(1_200);
    }
  }
  const result = await waitForReply(requestId, REPLY_WAIT_MS);
  return result ?? { error: "Couldn't reach Khata. Check your connection and try again." };
}

// Phone photos are several megabytes; a bill is perfectly readable at 1600px.
// Shrinking here keeps uploads fast on mobile data and well inside the
// server's size limit.
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/jpeg", 0.82)
  );
}

// Browsers record in WebM or MP4, depending on the browser. Decoding here -
// in the same browser that recorded it - and re-encoding as 16 kHz mono WAV
// gives one format Gemini documents, whatever phone was used.
async function toWav(recording: Blob): Promise<Blob> {
  const Ctx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await recording.arrayBuffer());
    const rate = 16000;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return new Blob([encodeWav(rendered.getChannelData(0), rate)], { type: "audio/wav" });
  } finally {
    ctx.close();
  }
}

// The server only accepts UUIDs as message ids.
const newId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function Reply({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) =>
        line.trim() === "" ? (
          <div key={i} className="h-2" aria-hidden="true" />
        ) : (
          <p key={i} className="leading-relaxed break-words">
            {splitBold(line).map((seg, j) =>
              seg.bold ? (
                <strong key={j} className="font-semibold">
                  {seg.text}
                </strong>
              ) : (
                <span key={j}>{seg.text}</span>
              )
            )}
          </p>
        )
      )}
    </>
  );
}


export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRef = useRef(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const finish = (bubbleId: string, result: Delivery) =>
    setMessages((all) =>
      all.map((msg) =>
        msg.id === bubbleId
          ? {
              ...msg,
              pending: false,
              requestId: undefined,
              text: "reply" in result ? result.reply : result.error,
              failed: !("reply" in result),
            }
          : msg
      )
    );

  // Read after mount: localStorage doesn't exist while the server renders.
  // A reply still pending when the page was left is picked up again here.
  useEffect(() => {
    const history = loadHistory();
    setMessages(history);
    setLoaded(true);
    for (const m of history) {
      if (m.pending && m.requestId) {
        waitForReply(m.requestId, REPLY_WAIT_MS).then((result) =>
          finish(m.id, result ?? { error: "That message didn't reach Khata. Please send it again." })
        );
      }
    }
  }, []);

  useEffect(() => {
    if (loaded) saveHistory(messages);
  }, [messages, loaded]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [messages]);

  const stopRecording = (discard: boolean) => {
    discardRef.current = discard;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  // Recording timer, with a hard stop so a forgotten recording can't grow
  // past what the server accepts.
  useEffect(() => {
    if (recordingSince === null) return;
    setElapsed(0);
    const id = setInterval(() => {
      const seconds = Math.floor((Date.now() - recordingSince) / 1000);
      setElapsed(seconds);
      if (seconds >= MAX_VOICE_SECONDS) stopRecording(false);
    }, 250);
    return () => clearInterval(id);
  }, [recordingSince]);

  // Leaving the page mid-recording releases the microphone and sends nothing.
  useEffect(() => () => stopRecording(true), []);

  const attach = async (file: File | undefined) => {
    setNotice("");
    if (!file) return;
    try {
      const blob = await shrinkImage(file);
      setPhoto((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
    } catch {
      setNotice("Couldn't read that photo. Try a screenshot or a JPEG.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  const removePhoto = () => {
    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const send = async (raw: string, voice?: { audio: Blob; seconds: number }) => {
    const message = raw.trim();
    if (busy || (!message && !photo && !voice)) return;
    setBusy(true);
    setNotice("");

    const sentPhoto = photo;
    const requestId = newId();
    const pendingId = newId();
    setMessages((m) => [
      ...m,
      {
        id: newId(),
        role: "user",
        text: message,
        photo: !!sentPhoto,
        photoUrl: sentPhoto?.url,
        voiceSeconds: voice?.seconds,
      },
      { id: pendingId, role: "assistant", text: "", pending: true, requestId },
    ]);
    setText("");
    setPhoto(null);

    const form = new FormData();
    form.set("id", requestId);
    form.set("text", message);
    // Recent turns, so follow-ups like "change it to 2500" have something to refer to.
    form.set(
      "history",
      JSON.stringify(
        messages
          .filter((m) => !m.pending && !m.failed && m.text)
          .slice(-12)
          .map((m) => ({ role: m.role, text: m.text }))
      )
    );
    if (sentPhoto) form.set("image", sentPhoto.blob, "photo.jpg");
    if (voice) form.set("audio", voice.audio, "voice.wav");

    finish(pendingId, await deliver(form, requestId));
    // The assistant may have added or changed anything: refresh cached figures.
    invalidate("/api/");
    setBusy(false);
    inputRef.current?.focus();
  };

  const startRecording = async () => {
    setNotice("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice("Voice notes aren't supported in this browser. You can use the keyboard's microphone instead.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNotice("Microphone access was blocked. Allow it for this site in your browser settings, then try again.");
      return;
    }

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const started = Date.now();
    discardRef.current = false;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecordingSince(null);
      if (discardRef.current) return;
      const seconds = (Date.now() - started) / 1000;
      if (seconds < 0.8) {
        setNotice("That was too short. Tap the microphone, speak, then tap Send.");
        return;
      }
      try {
        const audio = await toWav(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        await send("", { audio, seconds: Math.min(MAX_VOICE_SECONDS, Math.round(seconds)) });
      } catch {
        setNotice("Couldn't process that recording. Please try again.");
      }
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecordingSince(started);
  };

  // Arriving from Home: send what was typed there, or open straight into a
  // voice note or the photo picker. Runs once, after history has loaded.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!loaded || startedRef.current) return;
    startedRef.current = true;
    let draft = "";
    try {
      draft = sessionStorage.getItem(ASSISTANT_DRAFT_KEY) ?? "";
      sessionStorage.removeItem(ASSISTANT_DRAFT_KEY);
    } catch {}
    const start = new URLSearchParams(window.location.search).get("start");
    if (start) window.history.replaceState(null, "", "/assistant");
    if (draft) send(draft);
    else if (start === "voice") startRecording();
    else if (start === "photo") {
      setMenuOpen(true);
    }
    // send and startRecording are stable enough here: this runs exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const recording = recordingSince !== null;

  // The message box grows with what's typed, up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const menuItem = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      className="chat-menu-item"
      disabled={disabled}
      onClick={() => {
        setMenuOpen(false);
        onClick();
      }}
    >
      <span className="chat-menu-icon" aria-hidden>
        {icon}
      </span>
      {label}
    </button>
  );

  return (
    <div className="chat-screen">
      <header className="chat-topbar">
        <Link href="/" className="chat-round" aria-label="Back to Home">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <h1 className="chat-title">
          <SparkleIcon size={18} />
          Khata AI
        </h1>
        <button
          type="button"
          className="chat-round"
          aria-label="New chat"
          onClick={() => setMessages([])}
          disabled={busy || recording || messages.length === 0}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20.5a8.5 8.5 0 1 0-7.4-4.3L3.5 20.5l4.3-1.1a8.5 8.5 0 0 0 4.2 1.1z" />
            <path d="M12 8.5v7M8.5 12h7" />
          </svg>
        </button>
      </header>

      <div className="chat-body" aria-live="polite" aria-label="Conversation">
        {loaded && messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-glow-card rise">
              <p className="chat-glow-title">What can Khata do for you?</p>
              <p className="chat-glow-hint">&ldquo;{EXAMPLES[0]}&rdquo;</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-sm">
              {EXAMPLES.slice(1).map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="chat-chip"
                  onClick={() => {
                    setText(ex);
                    inputRef.current?.focus();
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="chat-bubble-user">
              {m.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing to optimise
                <img src={m.photoUrl} alt="Attached photo" className="rounded-2xl mb-2 max-h-56 object-cover" />
              ) : m.photo ? (
                <p className="text-[12px] opacity-80 mb-1">Photo</p>
              ) : null}
              {m.voiceSeconds !== undefined && (
                <p className="flex items-center gap-1.5">
                  <MicIcon size={18} />
                  <span>Voice note · {clock(m.voiceSeconds)}</span>
                </p>
              )}
              {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
            </div>
          ) : (
            <div key={m.id} className={`chat-bubble-bot${m.failed ? " failed" : ""}`}>
              {m.pending ? (
                <span className="chat-typing" role="status" aria-label="Thinking">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <Reply text={m.text} />
              )}
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-dock">
        {notice && (
          <p className="chat-notice" role="alert">
            {notice}
          </p>
        )}

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
            <div className="chat-menu rise" role="menu">
              {menuItem("Camera", <CameraIcon size={22} />, () => cameraRef.current?.click(), busy)}
              {menuItem(
                "Photos",
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
                  <circle cx="9" cy="10" r="1.6" />
                  <path d="M20.5 15.5l-4.5-4.5-8 8.5" />
                </svg>,
                () => fileRef.current?.click(),
                busy
              )}
              {menuItem(
                "Undo last change",
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14L4 9l5-5" />
                  <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                </svg>,
                () => send("undo"),
                busy
              )}
              {menuItem(
                "What can I say?",
                <SparkleIcon size={22} />,
                () => send("help"),
                busy
              )}
            </div>
          </>
        )}

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => attach(e.target.files?.[0])} />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => attach(e.target.files?.[0])}
        />

        {recording ? (
          <div className="chat-composer" role="status" aria-live="polite">
            <div className="flex items-center gap-3 px-2 py-1.5">
              <span className="h-3 w-3 rounded-full animate-pulse shrink-0" style={{ background: "var(--bad)" }} aria-hidden />
              <span className="text-[16px] font-bold tabular">{clock(elapsed)}</span>
              <span className="text-[13px] truncate" style={{ color: "var(--muted)" }}>
                Listening… up to {clock(MAX_VOICE_SECONDS)}
              </span>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <button type="button" className="chat-round !w-11 !h-11" aria-label="Cancel recording" onClick={() => stopRecording(true)}>
                  ✕
                </button>
                <button type="button" className="chat-send" aria-label="Send voice note" onClick={() => stopRecording(false)}>
                  <ArrowUpIcon size={22} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            {photo && (
              <div className="flex items-center gap-3 px-2 pt-1 pb-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing to optimise */}
                <img src={photo.url} alt="Photo to send" className="h-16 w-16 rounded-2xl object-cover" />
                <button type="button" className="chat-chip" onClick={removePhoto}>
                  Remove
                </button>
              </div>
            )}
            <textarea
              ref={inputRef}
              className="chat-input"
              rows={1}
              value={text}
              maxLength={1000}
              placeholder={photo ? "Add a note, or just send" : "Ask or tell Khata anything"}
              aria-label="Message to Khata"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(text);
                }
              }}
            />
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                className="chat-round !w-11 !h-11"
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <span className="flex-1" />
              {text.trim() || photo ? (
                <button className="chat-send" aria-label="Send" disabled={busy}>
                  <ArrowUpIcon size={22} />
                </button>
              ) : (
                <button type="button" className="chat-send" aria-label="Record a voice note" onClick={startRecording} disabled={busy}>
                  <MicIcon size={22} />
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
