import { useState } from "react";
import FieldInfo from "../components/FieldInfo";
import NotesIcon, { type NotesIconName } from "../components/NotesIcon";

const ICONS: NotesIconName[] = ["console", "ssh", "rdp", "sftp", "browse", "settings"];

export default function RendererBenchmark() {
  const [buttonCount, setButtonCount] = useState(100);

  return (
    <div className="renderer-benchmark-page">
      <header className="renderer-benchmark-page__header">
        <div>
          <h2>Renderer button stress</h2>
          <p>Deterministic DOM/SVG controls for comparing Chrome with Tauri WKWebView.</p>
        </div>
        <div className="renderer-benchmark-page__choices" aria-label="Rendered button count">
          {[0, 100, 400].map((count) => (
            <button
              key={count}
              type="button"
              className={buttonCount === count ? "active" : ""}
              onClick={() => setButtonCount(count)}
            >
              {count} buttons
            </button>
          ))}
        </div>
      </header>

      <div className="renderer-benchmark-page__summary">
        <span>{buttonCount} shared icon buttons</span>
        <FieldInfo
          label="Benchmark tooltip information"
          text="Hover this shared production tooltip repeatedly and compare the process footprint after it closes."
        />
      </div>

      <div className="renderer-benchmark-button-grid">
        {Array.from({ length: buttonCount }, (_, index) => {
          const icon = ICONS[index % ICONS.length];
          return (
            <button
              key={index}
              type="button"
              className="outline-action-button outline-action-button--icon"
              aria-label={`Synthetic ${icon} action ${index + 1}`}
              title={`Synthetic ${icon} action ${index + 1}`}
            >
              <NotesIcon name={icon} size={17} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
