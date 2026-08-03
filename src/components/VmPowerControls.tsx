import { useRef, useState } from "react";
type VmPowerAction = "start" | "stop" | "reboot" | "reset" | "suspend";
import type { VmPowerControlStyle } from "../api/appearance";
import ContextMenu, { type ContextMenuItem, type ContextMenuPosition } from "./ContextMenu";
import NotesIcon, { type NotesIconName } from "./NotesIcon";
import { machinePowerState } from "../api/machinePowerState";

export type VmPowerControlDensity = "list" | "compact" | "focus";

interface PowerActionDefinition {
  action: VmPowerAction;
  label: string;
  shortLabel: string;
  icon: NotesIconName;
  glyph: string;
  confirm?: string;
  danger?: boolean;
}

const POWER_ACTIONS: PowerActionDefinition[] = [
  { action: "start", label: "Power on", shortLabel: "Power on", icon: "power-on", glyph: "▶" },
  { action: "suspend", label: "Suspend", shortLabel: "Suspend", icon: "suspend", glyph: "⏸" },
  { action: "reboot", label: "Reboot (guest)", shortLabel: "Restart", icon: "restart", glyph: "↻" },
  { action: "reset", label: "Reset (hard)", shortLabel: "Reset", icon: "reset", glyph: "⚡", confirm: "Reset", danger: true },
  { action: "stop", label: "Power off", shortLabel: "Power off", icon: "power-off", glyph: "⏻", confirm: "Power off", danger: true },
];

function primaryAction(powerState?: string | null): PowerActionDefinition {
  const state = machinePowerState(powerState);
  return POWER_ACTIONS.find((item) => item.action === (state === "off" || state === "suspended" ? "start" : "suspend"))!;
}

export default function VmPowerControls({
  style,
  density,
  busy,
  powerState,
  onAction,
}: {
  style: VmPowerControlStyle;
  density: VmPowerControlDensity;
  busy: boolean;
  powerState?: string | null;
  onAction: (action: VmPowerAction, confirmLabel?: string) => void;
}) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<ContextMenuPosition | null>(null);

  const run = (definition: PowerActionDefinition) => {
    if (busy) return;
    onAction(definition.action, definition.confirm);
  };

  const actionButton = (definition: PowerActionDefinition, className: string) => (
    <button
      key={definition.action}
      type="button"
      className={`${className}${definition.danger ? " vm-power-controls__button--danger" : ""}`}
      disabled={busy}
      aria-label={definition.label}
      title={definition.label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        run(definition);
      }}
    >
      {style === "current"
        ? <span aria-hidden="true">{definition.glyph}</span>
        : <NotesIcon name={definition.icon} size={density === "compact" ? 14 : 16} />}
    </button>
  );

  if (style === "primaryDropdown") {
    const primary = primaryAction(powerState);
    const menuItems: ContextMenuItem[] = POWER_ACTIONS
      .filter((definition) => definition.action !== primary.action)
      .map((definition) => ({
        label: definition.label,
        icon: <NotesIcon name={definition.icon} size={15} />,
        danger: definition.danger,
        onClick: () => run(definition),
      }));
    return (
      <span
        ref={rootRef}
        className={`vm-power-controls vm-power-controls--primary vm-power-controls--${density}`}
        role="group"
        aria-label="VM power actions"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="vm-power-controls__primary"
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            run(primary);
          }}
          title={primary.label}
        >
          <NotesIcon name={primary.icon} size={16} />
          <span>{density === "compact" ? primary.shortLabel : primary.label}</span>
        </button>
        <button
          type="button"
          className={`vm-power-controls__menu-trigger${menuPosition ? " active" : ""}`}
          disabled={busy}
          aria-label="More VM power actions"
          aria-expanded={!!menuPosition}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const rect = rootRef.current?.getBoundingClientRect();
            setMenuPosition(rect
              ? { x: rect.left, y: rect.bottom + 4, width: rect.width }
              : { x: 12, y: 12 });
          }}
        >
          <NotesIcon name="chevron-down" size={13} />
        </button>
        {menuPosition && (
          <ContextMenu
            position={menuPosition}
            items={menuItems}
            onClose={() => setMenuPosition(null)}
            variant="select"
          />
        )}
      </span>
    );
  }

  return (
    <span
      className={`vm-power-controls vm-power-controls--${style} vm-power-controls--${density}`}
      role="group"
      aria-label="VM power actions"
      onClick={(event) => event.stopPropagation()}
    >
      {POWER_ACTIONS.map((definition) => actionButton(
        definition,
        style === "current" ? "vm-power-controls__legacy" : "vm-power-controls__button",
      ))}
      {busy && <span className="vm-power-controls__busy" aria-label="Power action in progress">…</span>}
    </span>
  );
}
