import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./stylex.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
