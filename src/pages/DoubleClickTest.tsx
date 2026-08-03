import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ContextMenu, {
  type ContextMenuItem,
  type ContextMenuPosition,
  captureContextMenu,
} from "../components/ContextMenu";
import { useNavMenuItems } from "../components/navMenu";

const MAX_DOUBLE_CLICK_MS = 2000;
const RECENT_ATTEMPTS = 8;

type Attempt = {
  id: number;
  ms: number;
};

function speedLabel(ms: number | null): string {
  if (ms == null) return "Ready";
  if (ms < 180) return "Very fast";
  if (ms < 300) return "Fast";
  if (ms < 500) return "Steady";
  return "Relaxed";
}

function speedColor(ms: number | null): string {
  if (ms == null) return "var(--muted)";
  if (ms < 180) return "#22c55e";
  if (ms < 300) return "var(--accent)";
  if (ms < 500) return "#f59e0b";
  return "#ef4444";
}

function formatMs(ms: number | null): string {
  return ms == null ? "--" : `${ms} ms`;
}

export default function DoubleClickTest() {
  const firstClickRef = useRef<number | null>(null);
  const nextIdRef = useRef(1);
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [menu, setMenu] = useState<{ pos: ContextMenuPosition; items: ContextMenuItem[] } | null>(null);
  const navItems = useNavMenuItems();

  const last = attempts[0]?.ms ?? null;
  const best = useMemo(() => (
    attempts.length ? Math.min(...attempts.map((attempt) => attempt.ms)) : null
  ), [attempts]);
  const average = useMemo(() => {
    if (!attempts.length) return null;
    const total = attempts.reduce((sum, attempt) => sum + attempt.ms, 0);
    return Math.round(total / attempts.length);
  }, [attempts]);

  useEffect(() => {
    if (armedAt == null) return;
    const timeout = window.setTimeout(() => {
      if (firstClickRef.current === armedAt) {
        firstClickRef.current = null;
        setArmedAt(null);
      }
    }, MAX_DOUBLE_CLICK_MS);
    return () => window.clearTimeout(timeout);
  }, [armedAt]);

  const recordClick = useCallback((now: number) => {
    const first = firstClickRef.current;
    if (first != null) {
      const delta = Math.round(now - first);
      if (delta > 0 && delta <= MAX_DOUBLE_CLICK_MS) {
        firstClickRef.current = null;
        setArmedAt(null);
        setAttempts((current) => [
          { id: nextIdRef.current++, ms: delta },
          ...current,
        ]);
        return;
      }
    }
    firstClickRef.current = now;
    setArmedAt(now);
  }, []);

  const reset = useCallback(() => {
    firstClickRef.current = null;
    setArmedAt(null);
    setAttempts([]);
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    recordClick(performance.now());
  }, [recordClick]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    recordClick(performance.now());
  }, [recordClick]);

  const label = speedLabel(last);
  const color = speedColor(last);
  const targetText = armedAt == null ? (last == null ? "Start" : `${last} ms`) : "Again";
  const targetSubtext = armedAt == null ? label : "Click";
  const visibleAttempts = attempts.slice(0, RECENT_ATTEMPTS);
  const openPageMenu = useCallback((event: React.MouseEvent) => {
    setMenu({
      pos: captureContextMenu(event),
      items: [
        { label: "Reset test", disabled: !attempts.length && armedAt == null, onClick: reset },
        { divider: true },
        ...navItems,
      ],
    });
  }, [armedAt, attempts.length, navItems, reset]);

  return (
    <div
      onContextMenu={openPageMenu}
      style={{
        maxWidth: 820,
        minHeight: "calc(100vh - 190px)",
        margin: "0 auto",
        display: "grid",
        alignContent: "center",
        gap: 18,
      }}
    >
      <section
        style={{
          display: "grid",
          gap: 24,
          justifyItems: "center",
          padding: "clamp(18px, 4vw, 34px)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--panel)",
        }}
      >
        <div
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Double-click speed</h2>
            <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
              Double-click the circle.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={reset} disabled={!attempts.length && armedAt == null}>
            Reset
          </button>
        </div>

        <button
          type="button"
          aria-label="Double-click speed target"
          title="Double-click the target"
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
          style={{
            width: "min(58vw, 236px)",
            minWidth: 168,
            maxWidth: 236,
            aspectRatio: "1 / 1",
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            alignContent: "center",
            gap: 8,
            padding: 0,
            background: armedAt == null ? "var(--accent)" : "#f59e0b",
            color: armedAt == null ? "var(--btn-fg)" : "#111827",
            border: `4px solid ${color}`,
            boxShadow: armedAt == null
              ? "0 0 0 8px rgba(56, 189, 248, 0.13)"
              : "0 0 0 12px rgba(245, 158, 11, 0.18)",
            userSelect: "none",
            touchAction: "manipulation",
            transition: "transform 120ms ease, box-shadow 160ms ease, background 160ms ease",
          }}
        >
          <span style={{ fontSize: "2.1rem", lineHeight: 1, fontWeight: 800 }}>
            {targetText}
          </span>
          <span style={{ fontSize: "0.92rem", lineHeight: 1, fontWeight: 700 }}>
            {targetSubtext}
          </span>
        </button>

        <div
          aria-live="polite"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
            gap: 14,
            width: "100%",
          }}
        >
          <Metric label="Last" value={formatMs(last)} color={color} />
          <Metric label="Best" value={formatMs(best)} color={speedColor(best)} />
          <Metric label="Average" value={formatMs(average)} color="var(--fg)" />
          <Metric label="Attempts" value={String(attempts.length)} color="var(--fg)" />
        </div>
      </section>

      <section
        style={{
          minHeight: 54,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          color: "var(--muted)",
        }}
      >
        <span style={{ fontSize: "0.86rem", fontWeight: 700, color: "var(--fg)" }}>Recent</span>
        {visibleAttempts.length ? visibleAttempts.map((attempt) => (
          <span
            key={attempt.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 30,
              padding: "4px 10px",
              border: "1px solid var(--border)",
              borderRadius: 999,
              color: speedColor(attempt.ms),
              background: "var(--panel)",
              fontVariantNumeric: "tabular-nums",
              fontWeight: 700,
            }}
          >
            {attempt.ms} ms
          </span>
        )) : (
          <span style={{ fontSize: "0.9rem" }}>No attempts yet.</span>
        )}
      </section>
      {menu && (
        <ContextMenu
          position={menu.pos}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        minWidth: 0,
        paddingTop: 12,
        borderTop: "1px solid var(--border)",
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: "0.78rem", fontWeight: 700 }}>
        {label}
      </span>
      <strong
        style={{
          color,
          fontSize: "1.18rem",
          lineHeight: 1.2,
          fontVariantNumeric: "tabular-nums",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </strong>
    </div>
  );
}
