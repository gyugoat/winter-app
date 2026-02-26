import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "./i18n/I18nProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { loadDirectory } from "./utils/platform";
import App from "./App";

// Pre-load the workspace directory for web mode before rendering
loadDirectory().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
