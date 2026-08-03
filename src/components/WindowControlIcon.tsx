type WindowControlIconName = "minimize" | "maximize" | "restore" | "close";

export default function WindowControlIcon({ name }: { name: WindowControlIconName }) {
  return (
    <svg
      aria-hidden="true"
      className="window-control-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {name === "minimize" && <path d="M5 17.5h14" />}
      {name === "maximize" && <rect x="5" y="5" width="14" height="14" rx="2.25" />}
      {name === "restore" && (
        <>
          <path d="M9 5.25h7.75a2 2 0 0 1 2 2V15" />
          <rect x="5.25" y="9" width="9.75" height="9.75" rx="2" />
        </>
      )}
      {name === "close" && <path d="m6.5 6.5 11 11m0-11-11 11" />}
    </svg>
  );
}
