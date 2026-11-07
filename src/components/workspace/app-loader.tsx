"use client";

import dynamic from "next/dynamic";

// The workspace uses IndexedDB and canvas, which only exist in the browser.
const App = dynamic(() => import("./app").then((m) => m.App), { ssr: false });

export function AppLoader() {
  return <App />;
}
