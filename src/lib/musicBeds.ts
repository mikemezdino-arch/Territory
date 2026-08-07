import { supabase } from "./supabaseClient";

// Curated list of royalty-free background tracks, uploaded manually to the
// root of the existing "audio" Storage bucket (per-user VO lives one level
// down, at `${userId}/${territoryId}/vo.mp3`, so there's no path collision).
// Not a live bucket listing — a fixed manifest, same pattern as
// src/lib/voices.ts, so adding/removing tracks is a deliberate code change
// rather than whatever happens to be sitting in Storage.
export interface MusicBedOption {
  path: string;
  name: string;
  mood: string;
}

export const MUSIC_BED_OPTIONS: MusicBedOption[] = [
  { path: "alex-morgan-downtempo-chill-electronic-528322.mp3", name: "Downtempo Chill", mood: "Minimal, downtempo" },
  { path: "andriig-warm-nostalgic-sentimental-music-471262.mp3", name: "Warm & Sentimental", mood: "Warm, nostalgic" },
  { path: "atlasaudio-inspiring-uplifting-511864.mp3", name: "Inspiring & Uplifting", mood: "Uplifting, inspiring" },
  { path: "atlasaudio-professional-522438.mp3", name: "Professional", mood: "Corporate, clean" },
  { path: "eliveta-folk-474052.mp3", name: "Folk", mood: "Acoustic, folk" },
  { path: "jorisvermeer-playful-mischief-431666.mp3", name: "Playful Mischief", mood: "Quirky, playful" },
  { path: "joyinsound-sports-energetic-background-music-390232.mp3", name: "Energetic Sports", mood: "Energetic, driving" },
  { path: "leberch-quirky-501484.mp3", name: "Quirky", mood: "Quirky, offbeat" },
  { path: "monume-electronic-570678.mp3", name: "Electronic", mood: "Electronic, synth" },
  { path: "morgan-ambient-calm-ambient-dreamscape-529861.mp3", name: "Calm Ambient Dreamscape", mood: "Calm, ambient" },
  { path: "nastelbom-tense-400740.mp3", name: "Tense", mood: "Tense, suspenseful" },
  { path: "paulyudin-epic-cinematic-epic-482367.mp3", name: "Epic Cinematic", mood: "Epic, cinematic" },
  { path: "solarflex-dramatic-dramatic-music-569590.mp3", name: "Dramatic", mood: "Dark, dramatic" },
  { path: "tatamusic-upbeat-upbeat-music-377668.mp3", name: "Upbeat", mood: "Energetic, upbeat" },
];

export function getMusicBedUrl(path: string): string {
  return supabase.storage.from("audio").getPublicUrl(path).data.publicUrl;
}
