/**
 * Camera torch / flash helper.
 *
 * Uses the experimental MediaStreamTrack constraint `torch` (Chromium-only;
 * supported on Android Chrome). Safari/Firefox return supported=false.
 */

export interface TorchCapability {
  supported: boolean;
}

export function getTorchCapability(stream: MediaStream | null): TorchCapability {
  if (!stream) return { supported: false };
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== 'function') {
    return { supported: false };
  }
  const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
  return { supported: !!caps.torch };
}

export async function setTorch(stream: MediaStream | null, on: boolean): Promise<boolean> {
  if (!stream) return false;
  const track = stream.getVideoTracks()[0];
  if (!track) return false;
  try {
    await track.applyConstraints({
      advanced: [{ torch: on } as MediaTrackConstraintSet & { torch: boolean }],
    });
    return true;
  } catch (e) {
    console.warn('[torch] applyConstraints failed', e);
    return false;
  }
}
