/**
 * Coach "thinking" state: three gently breathing dots in a coach
 * bubble (animation + reduced-motion fallback in app/globals.css),
 * with the label kept for screen readers.
 */
export function TypingIndicator({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="mb-4">
      <span className="inline-flex items-center rounded-lg rounded-bl-xs bg-muted px-4 py-3.5">
        <span className="typing-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="sr-only">{label}</span>
      </span>
    </div>
  );
}
