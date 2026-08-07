// Curated shortlist, not a live listing of the whole ElevenLabs voice
// library — all premade voices confirmed available on this account (queried
// via GET /v1/voices), filtered to accent: "american" and split evenly
// between genders. George and Daniel were dropped from the original
// shortlist here for the same reason: both are British-accented, not
// American, despite reading as generically "professional" from their names
// alone — accent is metadata on the account, not something guessable from
// a voice's name or description.
export interface VoiceOption {
  id: string;
  name: string;
  description: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", description: "Smooth, trustworthy" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", description: "Wise, mature, balanced" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", description: "Laid-back, casual, resonant" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", description: "Mature, reassuring, confident" },
  { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella", description: "Professional, bright, warm" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", description: "Playful, bright, warm" },
];

export const DEFAULT_VOICE_ID = VOICE_OPTIONS[0].id;
