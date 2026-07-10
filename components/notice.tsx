import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The designed notice surface. Every error, gate banner, and degraded
 * state in the product renders through this component so a 503, a
 * rate limit, an abstention, or a grounding flag is a deliberate
 * design state — never a raw string dropped into the layout.
 *
 * Tones (tokens in app/globals.css):
 * - info      calm sand — neutral system notes (OOD abstention)
 * - caution   soft clay — needs attention (HITL review, service 503s)
 * - critical  muted brick — trust problems (grounding failures)
 * - positive  muted sage — quiet good news
 */
export type NoticeTone = "info" | "caution" | "critical" | "positive";

const TONE_CLASSES: Record<NoticeTone, string> = {
  info: "bg-info text-info-foreground border-info-border",
  caution: "bg-caution text-caution-foreground border-caution-border",
  critical: "bg-critical text-critical-foreground border-critical-border",
  positive: "bg-positive text-positive-foreground border-positive-border",
};

export interface NoticeProps {
  tone: NoticeTone;
  icon: LucideIcon;
  /** Bolded first line; omit for a single-sentence notice. */
  title?: string;
  children?: React.ReactNode;
  className?: string;
  /** "status" (default) for polite updates, "alert" for failures. */
  role?: "status" | "alert";
  /** Native tooltip carrying the technical detail (scores, reasons). */
  htmlTitle?: string;
}

export function Notice({
  tone,
  icon: Icon,
  title,
  children,
  className,
  role = "status",
  htmlTitle,
}: NoticeProps) {
  return (
    <div
      role={role}
      title={htmlTitle}
      className={cn(
        "rounded-md border px-3.5 py-3 text-xs",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
