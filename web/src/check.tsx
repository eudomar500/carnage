import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ConnectionCheck from "./ConnectionCheck";
import "./check.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConnectionCheck />
  </StrictMode>,
);
