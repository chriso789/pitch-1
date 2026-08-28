import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { HelmetProvider } from "react-helmet-async";
import { installRandomUUIDPolyfill } from "./lib/polyfills/randomUUID";
import App from "./App.tsx";
import "./index.css";

installRandomUUIDPolyfill();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('Failed to find the root element');

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <HelmetProvider>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <App />
      </ThemeProvider>
    </HelmetProvider>
  </React.StrictMode>
);
