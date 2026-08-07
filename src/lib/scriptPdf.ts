import { jsPDF } from "jspdf";

export interface ScriptBeat {
  ord: number;
  duration_seconds: number;
  action: string;
  vo_text: string | null;
}

const MARGIN = 56;
const LINE_HEIGHT = 16;

export function renderScriptPdf(territoryName: string, format: string, beats: ScriptBeat[]): Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const textWidth = pageWidth - MARGIN * 2;
  let y = MARGIN;

  function ensureSpace(lines: number) {
    if (y + lines * LINE_HEIGHT > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  }

  doc.setFontSize(20);
  doc.text(territoryName, MARGIN, y);
  y += LINE_HEIGHT * 1.5;

  doc.setFontSize(11);
  doc.setTextColor(120);
  doc.text(`${format} spot — scratch script`, MARGIN, y);
  doc.setTextColor(0);
  y += LINE_HEIGHT * 2;

  for (const beat of beats) {
    const actionLines = doc.splitTextToSize(beat.action, textWidth);
    const voLines = beat.vo_text ? doc.splitTextToSize(`VO: ${beat.vo_text}`, textWidth) : [];

    ensureSpace(2 + actionLines.length + voLines.length);

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`#${beat.ord} · ${beat.duration_seconds}s`, MARGIN, y);
    y += LINE_HEIGHT;

    doc.setFont("helvetica", "normal");
    doc.text(actionLines, MARGIN, y);
    y += LINE_HEIGHT * actionLines.length;

    if (voLines.length > 0) {
      doc.setTextColor(90);
      doc.text(voLines, MARGIN, y);
      doc.setTextColor(0);
      y += LINE_HEIGHT * voLines.length;
    }

    y += LINE_HEIGHT;
  }

  return doc.output("blob");
}
