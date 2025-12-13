"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface HITLWarningProps {
  onAcknowledge?: () => void;
  onDownload?: () => void;
  downloadLabel?: string;
  disabled?: boolean;
}

export function HITLWarning({
  onAcknowledge,
  onDownload,
  downloadLabel = "Download",
  disabled = false,
}: HITLWarningProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  const handleAcknowledge = () => {
    setAcknowledged(true);
    onAcknowledge?.();
  };

  const handleDownload = () => {
    if (acknowledged) {
      onDownload?.();
    }
  };

  return (
    <Card className="mt-4 p-4 border-amber-200 bg-amber-50">
      <div className="flex items-start gap-3">
        <span className="text-2xl">⚠️</span>
        <div className="flex-1">
          <h3 className="font-semibold text-amber-900 mb-2">
            HIGH-STAKES ADVICE
          </h3>
          <p className="text-sm text-amber-800 mb-4">
            This advice involves a significant decision. Consider reviewing with
            a mentor or career counselor before acting.
          </p>
          <div className="flex items-center gap-2 mb-4">
            <input
              type="checkbox"
              id="hitl-acknowledge"
              checked={acknowledged}
              onChange={handleAcknowledge}
              className="w-4 h-4 text-amber-600 border-amber-300 rounded focus:ring-amber-500"
            />
            <label
              htmlFor="hitl-acknowledge"
              className="text-sm text-amber-800 cursor-pointer"
            >
              I understand this is AI guidance and I should verify with a
              professional before taking action
            </label>
          </div>
          {onDownload && (
            <Button
              onClick={handleDownload}
              disabled={!acknowledged || disabled}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {downloadLabel}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

