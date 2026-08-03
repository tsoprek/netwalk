import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * Shared button contract for Sessions actions whose glyph must always follow
 * the application accent, independent of brand or workspace-specific button
 * styling. Keep destructive/close actions on their own semantic colors.
 */
const SessionAccentButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function SessionAccentButton({ className = "", style, ...props }, ref) {
    return (
      <button
        {...props}
        ref={ref}
        className={`session-accent-action${className ? ` ${className}` : ""}`}
        style={{ ...style, color: "var(--accent)" }}
      />
    );
  },
);

export default SessionAccentButton;
