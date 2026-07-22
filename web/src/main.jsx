import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "react-diff-view/style/index.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
