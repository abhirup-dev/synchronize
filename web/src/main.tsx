import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./tw.css";
import "./styles.css";
import "./components/extra.css";
import "./components/activity.css";
import "./skin-glass.css";
import "highlight.js/styles/github-dark.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
