import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { jsPDF } from "jspdf";
import { downloadBlob } from "./download";

export { downloadBlob };

// Single-threaded core (not @ffmpeg/core-mt) — avoids needing
// Cross-Origin-Opener/Embedder-Policy headers for SharedArrayBuffer, which
// this app doesn't otherwise need. Loaded from CDN at render time rather
// than bundled, since the core is a large (~25MB) wasm binary.
// Must be the ESM build: our worker runs as type "module", and dynamically
// import()-ing the UMD build silently resolves to a module with no default
// export (UMD isn't ESM), which ffmpeg.wasm's worker reports as
// "failed to import ffmpeg-core.js" rather than a parse error.
const FFMPEG_CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

const WATERMARK_TEXT = "TERRITORY — free plan";

async function toCanvas(url: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported.");
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function drawWatermark(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const fontSize = Math.round(canvas.width * 0.03);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "right";
  const padding = fontSize * 0.6;
  const x = canvas.width - padding;
  const y = canvas.height - padding;
  ctx.lineWidth = fontSize * 0.12;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.strokeText(WATERMARK_TEXT, x, y);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(WATERMARK_TEXT, x, y);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed."))), type, quality);
  });
}

export interface ExportBeat {
  ord: number;
  duration_seconds: number;
  action: string;
  vo_text: string | null;
  image_url: string;
}

export async function renderMp4(
  beats: ExportBeat[],
  voUrl: string | null,
  musicUrl: string | null,
  watermark: boolean,
  onProgress?: (message: string) => void,
): Promise<Blob> {
  onProgress?.("Loading video encoder (first time only)…");
  const ffmpeg = await getFFmpeg();
  const totalSeconds = beats.reduce((sum, b) => sum + b.duration_seconds, 0);

  const listLines: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    onProgress?.(`Preparing frame ${i + 1}/${beats.length}…`);
    const canvas = await toCanvas(beats[i].image_url);
    if (watermark) drawWatermark(canvas);
    const blob = await canvasToBlob(canvas, "image/png");
    const filename = `img${i}.png`;
    await ffmpeg.writeFile(filename, new Uint8Array(await blob.arrayBuffer()));
    listLines.push(`file '${filename}'`);
    listLines.push(`duration ${beats[i].duration_seconds}`);
  }
  // The concat demuxer ignores the final entry's duration unless the last
  // file is listed once more without one.
  listLines.push(`file 'img${beats.length - 1}.png'`);
  await ffmpeg.writeFile("list.txt", new TextEncoder().encode(listLines.join("\n")));

  const args = ["-f", "concat", "-safe", "0", "-i", "list.txt"];
  let voInput: number | null = null;
  let musicInput: number | null = null;
  let nextInput = 1;
  if (voUrl) {
    onProgress?.("Adding voiceover…");
    await ffmpeg.writeFile("vo.mp3", await fetchFile(voUrl));
    args.push("-i", "vo.mp3");
    voInput = nextInput++;
  }
  if (musicUrl) {
    onProgress?.("Adding music bed…");
    await ffmpeg.writeFile("music.mp3", await fetchFile(musicUrl));
    args.push("-i", "music.mp3");
    musicInput = nextInput++;
  }
  args.push(
    "-vf",
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
  );
  // Music bed plays underneath VO at reduced volume, mixed to a single
  // output track. If there's no VO, the music bed still gets volume-reduced
  // (it's meant to sit under narration even when there isn't any this time)
  // and mapped directly.
  if (voInput !== null && musicInput !== null) {
    args.push(
      "-filter_complex",
      `[${musicInput}:a]volume=0.3[music];[${voInput}:a][music]amix=inputs=2:duration=longest:dropout_transition=0[aout]`,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:a",
      "aac",
    );
  } else if (musicInput !== null) {
    args.push("-filter_complex", `[${musicInput}:a]volume=0.3[aout]`, "-map", "0:v", "-map", "[aout]", "-c:a", "aac");
  } else if (voInput !== null) {
    args.push("-c:a", "aac");
  }
  // -t caps the render at the beat sheet's true runtime regardless of how
  // long any audio track is — deliberately not the same mistake as the old
  // -shortest flag (which stopped at whichever stream ended first, so a
  // short VO clip truncated the whole video). Here the beat durations are
  // the single source of truth for length; audio just gets cut or padded
  // with silence to match.
  args.push("-t", totalSeconds.toFixed(2), "-movflags", "+faststart", "out.mp4");

  onProgress?.("Rendering MP4… this can take a minute.");
  await ffmpeg.exec(args);

  const data = await ffmpeg.readFile("out.mp4");
  return new Blob([Uint8Array.from(data as Uint8Array)], { type: "video/mp4" });
}

export async function renderPitchPdf(
  territoryName: string,
  conceptStatement: string,
  beats: ExportBeat[],
  onProgress?: (message: string) => void,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFontSize(28);
  doc.text(territoryName, pageWidth / 2, pageHeight / 2 - 50, { align: "center", maxWidth: pageWidth - 120 });
  doc.setFontSize(13);
  doc.text(conceptStatement, pageWidth / 2, pageHeight / 2, { align: "center", maxWidth: pageWidth - 160 });

  for (let i = 0; i < beats.length; i++) {
    onProgress?.(`Adding panel ${i + 1}/${beats.length}…`);
    const beat = beats[i];
    doc.addPage();

    const canvas = await toCanvas(beat.image_url);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const maxImgWidth = pageWidth - 80;
    const maxImgHeight = pageHeight - 160;
    const ratio = Math.min(maxImgWidth / canvas.width, maxImgHeight / canvas.height);
    const imgW = canvas.width * ratio;
    const imgH = canvas.height * ratio;
    const x = (pageWidth - imgW) / 2;
    const y = 40;
    doc.addImage(dataUrl, "JPEG", x, y, imgW, imgH);

    doc.setFontSize(11);
    doc.text(`#${beat.ord} · ${beat.duration_seconds}s — ${beat.action}`, 40, y + imgH + 24, {
      maxWidth: pageWidth - 80,
    });
    if (beat.vo_text) {
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`VO: ${beat.vo_text}`, 40, y + imgH + 44, { maxWidth: pageWidth - 80 });
      doc.setTextColor(0);
    }
  }

  return doc.output("blob");
}

