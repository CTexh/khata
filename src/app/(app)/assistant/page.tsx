"use client";

import { useEffect, useRef, useState } from "react";
import { splitBold } from "@/lib/chat-format";
import { encodeWav } from "@/lib/wav";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  photo?: boolean;
  photoUrl?: string; // this session only; photos aren't kept in history
  voiceSeconds?: number;
  pending?: boolean;
  failed?: boolean;
};

// History lives only in this browser. Replies can mention amounts and names,
// and the device is the user's own, so nothing is stored server-side for it.
const STORAGE_KEY = "khata-assistant-v1";
const KEEP = 60;
const MAX_VOICE_SECONDS = 60;
const EXAMPLES = ["fuel 3000 shell", "who owes me?", "what did I spend this month?", "Ali paid me back 500"];

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
      .filter((m) => !m.pending)
      .slice(-KEEP)
      .map(({ id, role, text, photo, voiceSeconds, failed }) => ({ id, role, text, photo, voiceSeconds, failed }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Storage unavailable (private browsing, full): history just isn't kept.
  }
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

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
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

  // Read after mount: localStorage doesn't exist while the server renders.
  useEffect(() => {
    setMessages(loadHistory());
    setLoaded(true);
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
      { id: pendingId, role: "assistant", text: "", pending: true },
    ]);
    setText("");
    setPhoto(null);

    const form = new FormData();
    form.set("text", message);
    if (sentPhoto) form.set("image", sentPhoto.blob, "photo.jpg");
    if (voice) form.set("audio", voice.audio, "voice.wav");

    let replyText: string;
    let failed = false;
    try {
      const res = await fetch("/api/assistant", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.reply === "string") {
        replyText = data.reply || "Done.";
      } else {
        failed = true;
        replyText = typeof data.error === "string" ? data.error : "Something went wrong. Please try again.";
      }
    } catch {
      failed = true;
      replyText = "Couldn't reach Khata. Check your connection and try again.";
    }

    setMessages((m) =>
      m.map((msg) => (msg.id === pendingId ? { ...msg, text: replyText, pending: false, failed } : msg))
    );
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

  const recording = recordingSince !== null;

  return (
    <section className="card p-5 sm:p-6 rise flex flex-col w-full">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Assistant</h1>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
            Tell Khata what happened, or ask about your money.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost !py-2 !px-3 text-[12px] shrink-0"
            onClick={() => setMessages([])}
            disabled={busy || recording}
          >
            Clear
          </button>
        )}
      </div>

      <div
        className="overflow-y-auto flex flex-col gap-3 pr-1"
        style={{ height: "calc(100dvh - 380px)", minHeight: 260 }}
        aria-live="polite"
        aria-label="Conversation"
      >
        {loaded && messages.length === 0 && (
          <div className="my-auto flex flex-col items-center text-center gap-3 py-6">
            <p className="text-[14px]" style={{ color: "var(--muted)" }}>
              Type, record a voice note, or attach a photo of a bill. For example:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="btn btn-ghost !py-2 !px-3 text-[13px]"
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
            <div
              key={m.id}
              className="self-end max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[14px]"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {m.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing to optimise
                <img src={m.photoUrl} alt="Attached photo" className="rounded-lg mb-2 max-h-48 object-cover" />
              ) : m.photo ? (
                <p className="text-[12px] opacity-80 mb-1">Photo</p>
              ) : null}
              {m.voiceSeconds !== undefined && (
                <p className="flex items-center gap-1.5">
                  <MicIcon />
                  <span>Voice note · {clock(m.voiceSeconds)}</span>
                </p>
              )}
              {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
            </div>
          ) : (
            <div
              key={m.id}
              className="tile self-start max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 text-[14px]"
              style={m.failed ? { borderLeft: "3px solid var(--bad)" } : undefined}
            >
              {m.pending ? (
                <p style={{ color: "var(--muted)" }} role="status">
                  Thinking…
                </p>
              ) : (
                <Reply text={m.text} />
              )}
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      {notice && (
        <p className="text-[13px] mt-3" style={{ color: "var(--bad)" }} role="alert">
          {notice}
        </p>
      )}

      {photo && !recording && (
        <div className="mt-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing to optimise */}
          <img src={photo.url} alt="Photo to send" className="h-14 w-14 rounded-lg object-cover" />
          <button type="button" className="btn btn-ghost !py-1.5 !px-3 text-[12px]" onClick={removePhoto}>
            Remove photo
          </button>
        </div>
      )}

      {recording ? (
        <div className="tile mt-3 flex items-center gap-3 px-4 py-2.5" role="status" aria-live="polite">
          <span className="h-2.5 w-2.5 rounded-full animate-pulse shrink-0" style={{ background: "var(--bad)" }} aria-hidden="true" />
          <span className="text-[14px] font-medium tabular">Recording {clock(elapsed)}</span>
          <span className="text-[12px]" style={{ color: "var(--muted)" }}>
            up to {clock(MAX_VOICE_SECONDS)}
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn btn-ghost !py-1.5 !px-3 text-[13px]" onClick={() => stopRecording(true)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary !py-1.5 !px-3.5 text-[13px]" onClick={() => stopRecording(false)}>
              Send
            </button>
          </div>
        </div>
      ) : (
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => attach(e.target.files?.[0])}
          />
          <button
            type="button"
            className="btn btn-ghost !p-0 w-11 h-11 shrink-0"
            aria-label="Attach a photo of a bill"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l9.2-9.2a3.3 3.3 0 0 1 4.7 4.7l-9.2 9.2a1.7 1.7 0 0 1-2.4-2.4l8.5-8.5" />
            </svg>
          </button>
          <textarea
            ref={inputRef}
            className="field flex-1 resize-none"
            rows={1}
            value={text}
            maxLength={1000}
            placeholder="fuel 3000 shell, or: who owes me?"
            aria-label="Message to Khata"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          {text.trim() || photo ? (
            <button className="btn btn-primary !p-0 w-11 h-11 shrink-0" aria-label="Send" disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary !p-0 w-11 h-11 shrink-0"
              aria-label="Record a voice note"
              onClick={startRecording}
              disabled={busy}
            >
              <MicIcon />
            </button>
          )}
        </form>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost !py-1.5 !px-3 text-[12px]" onClick={() => send("undo")} disabled={busy || recording}>
          Undo last
        </button>
        <button type="button" className="btn btn-ghost !py-1.5 !px-3 text-[12px]" onClick={() => send("help")} disabled={busy || recording}>
          What can I say?
        </button>
      </div>
    </section>
  );
}
