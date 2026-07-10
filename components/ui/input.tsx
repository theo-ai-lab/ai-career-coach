import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Sunken field: subtle sand surface with an invisible border at rest;
 * focus lifts it to the card surface with a clay border + soft ring.
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-transparent bg-secondary px-4 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-card focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Input.displayName = "Input"

export { Input }
