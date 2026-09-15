// One microphone for the whole visit.
//
// Asking the browser for the microphone is what makes a phone show its
// permission prompt. Asking for every recording - and handing the microphone
// back the moment a recording stopped - made the prompt appear every single
// time. So the stream is held here, outside React, and survives moving
// between screens: the prompt appears once, on the first recording.
//
// It is only handed back when doing so is free: browsers that report the
// permission as permanently granted won't prompt again. Safari (including a
// home-screen app on iPhone) can't tell us that, so the stream is kept, muted,
// until the tab is closed. Muted tracks capture nothing.

let held: MediaStream | null = null;

const liveTracks = (stream: MediaStream | null) =>
  stream?.getAudioTracks().filter((t) => t.readyState === "live") ?? [];

// True when the browser says the permission is permanent, so asking again
// costs nothing. Unknown (Safari, older browsers) counts as false.
export async function micPermissionIsPermanent(): Promise<boolean> {
  try {
    const permissions = navigator.permissions as
      | { query?: (d: { name: string }) => Promise<{ state: string }> }
      | undefined;
    const status = await permissions?.query?.({ name: "microphone" });
    return status?.state === "granted";
  } catch {
    return false;
  }
}

// The stream to record from: the one already held, or a fresh one.
export async function getMic(): Promise<MediaStream> {
  const tracks = liveTracks(held);
  if (held && tracks.length) {
    tracks.forEach((t) => (t.enabled = true));
    return held;
  }
  held = await navigator.mediaDevices.getUserMedia({ audio: true });
  return held;
}

// Nothing is captured while muted; the stream stays open so the next
// recording doesn't prompt.
export function muteMic(): void {
  held?.getAudioTracks().forEach((t) => (t.enabled = false));
}

// Hands the microphone back for good, which also clears the browser's
// recording indicator.
export function releaseMic(): void {
  held?.getTracks().forEach((t) => t.stop());
  held = null;
}

// After a recording: always mute, and release only where the next recording
// is certain not to prompt.
export async function parkMic(): Promise<void> {
  muteMic();
  if (await micPermissionIsPermanent()) releaseMic();
}
