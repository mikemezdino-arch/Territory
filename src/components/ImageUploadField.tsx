interface ImageUploadFieldProps {
  label: string;
  imageUrl: string | null;
  uploading: boolean;
  error?: string | null;
  onFileSelected: (file: File) => void;
}

export function ImageUploadField({ label, imageUrl, uploading, error, onFileSelected }: ImageUploadFieldProps) {
  return (
    <div className="field image-upload-field">
      <label>{label}</label>
      {imageUrl && <img src={imageUrl} alt={label} className="image-thumb" />}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = "";
        }}
      />
      {uploading && <span className="upload-status">Uploading…</span>}
      {error && <span className="auth-error">{error}</span>}
    </div>
  );
}
