import React from "react";
import ReactDOM from "react-dom/client";
import "../main.css";
import TrayWindowMain from "./TrayWindowMain";
import { I18nProvider } from "../i18n/I18nProvider";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Could not find root element with id 'root'");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <I18nProvider>
      <TrayWindowMain />
    </I18nProvider>
  </React.StrictMode>
);

export default TrayWindowMain;
