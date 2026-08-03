import React from "react";
import ReactDOM from "react-dom/client";
import { DndProvider } from "react-dnd";
import { MultiBackend } from "react-dnd-multi-backend";
import { HTML5toTouch } from "rdndmb-html5-to-touch";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import { installFrontendDiagnostics } from "./api/diagnostics";
import { installCaseSensitiveInputDefaults } from "./inputTextBehavior";
import { restoreRendererResetHandoff } from "./api/rendererLifecycle";

restoreRendererResetHandoff();
installFrontendDiagnostics();
installCaseSensitiveInputDefaults();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <DndProvider backend={MultiBackend} options={HTML5toTouch}>
    <React.StrictMode>
      <BrowserRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <App />
      </BrowserRouter>
    </React.StrictMode>
  </DndProvider>,
);
