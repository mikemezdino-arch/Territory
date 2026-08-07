import type { Brief } from "../types";
import { ListField } from "./ListField";

interface BriefFormProps {
  brief: Brief;
  onChange: (brief: Brief) => void;
  onSubmit: () => void;
  submitting: boolean;
  title?: string;
  onTitleChange?: (title: string) => void;
  submitLabel?: string;
}

const TONE_LABELS: { key: keyof Brief["tone_sliders"]; left: string; right: string }[] = [
  { key: "calm_vs_loud", left: "Calm", right: "Loud" },
  { key: "wry_vs_earnest", left: "Wry", right: "Earnest" },
  { key: "premium_vs_mass", left: "Premium", right: "Mass" },
];

export function BriefForm({
  brief,
  onChange,
  onSubmit,
  submitting,
  title,
  onTitleChange,
  submitLabel,
}: BriefFormProps) {
  function setField<K extends keyof Brief>(key: K, value: Brief[K]) {
    onChange({ ...brief, [key]: value });
  }

  function setTone(key: keyof Brief["tone_sliders"], value: number) {
    onChange({ ...brief, tone_sliders: { ...brief.tone_sliders, [key]: value } });
  }

  return (
    <form
      className="brief-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {onTitleChange && (
        <div className="field">
          <label htmlFor="project_title">Project title</label>
          <input
            id="project_title"
            type="text"
            value={title}
            maxLength={200}
            onChange={(e) => onTitleChange(e.target.value)}
            required
          />
        </div>
      )}

      <div className="field">
        <label htmlFor="client">Client</label>
        <input
          id="client"
          type="text"
          value={brief.client}
          maxLength={1500}
          onChange={(e) => setField("client", e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="product">Product</label>
        <textarea
          id="product"
          value={brief.product}
          maxLength={1500}
          onChange={(e) => setField("product", e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="objective">Objective</label>
        <textarea
          id="objective"
          value={brief.objective}
          maxLength={1500}
          onChange={(e) => setField("objective", e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="audience">Audience</label>
        <textarea
          id="audience"
          value={brief.audience}
          maxLength={1500}
          onChange={(e) => setField("audience", e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="key_message">Key message</label>
        <input
          id="key_message"
          type="text"
          value={brief.key_message}
          maxLength={1500}
          onChange={(e) => setField("key_message", e.target.value)}
          required
        />
      </div>

      <ListField
        label="Reasons to believe"
        values={brief.reasons_to_believe}
        onChange={(v) => setField("reasons_to_believe", v)}
        placeholder="e.g. no sugar crash"
      />

      <div className="field">
        <label>Tone</label>
        {TONE_LABELS.map(({ key, left, right }) => (
          <div className="slider-row" key={key}>
            <span className="slider-label-left">{left}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={brief.tone_sliders[key]}
              onChange={(e) => setTone(key, Number(e.target.value))}
            />
            <span className="slider-label-right">{right}</span>
          </div>
        ))}
      </div>

      <ListField
        label="Mandatories"
        values={brief.mandatories}
        onChange={(v) => setField("mandatories", v)}
        placeholder="e.g. tagline: Burn steady"
      />

      <ListField
        label="Past rejections"
        values={brief.past_rejections}
        onChange={(v) => setField("past_rejections", v)}
        placeholder="e.g. meditation-parody route killed as too jokey"
      />

      <button type="submit" className="primary-btn" disabled={submitting}>
        {submitting ? "Generating territories…" : submitLabel ?? "Generate territories"}
      </button>
    </form>
  );
}
