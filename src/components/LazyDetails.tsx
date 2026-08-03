import { useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";

export default function LazyDetails({
  summary,
  children,
  defaultOpen = false,
  style,
  summaryStyle,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  style?: CSSProperties;
  summaryStyle?: CSSProperties;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(event.currentTarget.open);
  };

  return (
    <details open={open} onToggle={handleToggle} style={style}>
      <summary style={summaryStyle}>{summary}</summary>
      {open ? children : null}
    </details>
  );
}
