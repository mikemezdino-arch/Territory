interface ListFieldProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export function ListField({ label, values, onChange, placeholder }: ListFieldProps) {
  function updateRow(index: number, value: string) {
    const next = [...values];
    next[index] = value;
    onChange(next);
  }

  function removeRow(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  function addRow() {
    onChange([...values, ""]);
  }

  return (
    <div className="field">
      <label>{label}</label>
      {values.map((value, i) => (
        <div className="list-row" key={i}>
          <input
            type="text"
            value={value}
            placeholder={placeholder}
            maxLength={1500}
            onChange={(e) => updateRow(i, e.target.value)}
          />
          <button type="button" className="remove-btn" onClick={() => removeRow(i)} aria-label={`Remove ${label} row ${i + 1}`}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="add-btn" onClick={addRow}>
        + Add
      </button>
    </div>
  );
}
