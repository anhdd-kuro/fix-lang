import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "../i18n/I18nProvider";
import "../main.css"; // Import Tailwind CSS entry point

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Could not find root element with id 'root'");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
