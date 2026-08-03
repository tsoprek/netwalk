import { useEffect, useRef } from "react";
import { useConsoles } from "../consoles/useConsoles";
import { getConsoleStash } from "../consoles/consoleStash";

export default function Consoles() {
  const { tabs, activeId, setActive, close } = useConsoles();
  const viewport = useRef<HTMLDivElement | null>(null);
  const active = tabs.find((tab) => tab.id === activeId) ?? null;

  useEffect(() => {
    const host = active?.host;
    if (!host || !viewport.current) return;
    viewport.current.appendChild(host);
    active.setVisible?.(true);
    active.refit?.();
    return () => {
      active.setVisible?.(false);
      if (host.isConnected) getConsoleStash().appendChild(host);
    };
  }, [active]);

  return <div className="page remote-access-page">
    <div className="page-header">
      <div><h1>Remote Access</h1><p className="muted">Direct-host SFTP and local browser sessions.</p></div>
    </div>
    {tabs.length > 0 && <div className="console-tabs">
      {tabs.map((tab) => <button key={tab.id} className={tab.id === activeId ? "active" : ""} onClick={() => setActive(tab.id)}>
        <span>{tab.title}</span>
        <span role="button" aria-label={`Close ${tab.title}`} onClick={(event) => { event.stopPropagation(); close(tab.id); }}>×</span>
      </button>)}
    </div>}
    {active?.error && <div className="error-banner">{active.error}</div>}
    <div ref={viewport} className="console-viewport">
      {!active && <div className="empty-state"><h2>No remote sessions</h2><p>Open SFTP or Browse from a saved Connection.</p></div>}
    </div>
  </div>;
}
