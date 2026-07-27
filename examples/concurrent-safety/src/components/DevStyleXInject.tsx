"use client";

import { useEffect } from "react";

function DevStyleXInjectImpl() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      // @ts-expect-error Vite virtual module exposed by @stylexjs/unplugin.
      import("virtual:stylex:css-only");
    }
  }, []);
  return <link href="/virtual:stylex.css" rel="stylesheet" />;
}

export function DevStyleXInject({ cssHref }: { cssHref: string }) {
  return import.meta.env.DEV ? (
    <DevStyleXInjectImpl />
  ) : (
    <link href={cssHref} rel="stylesheet" />
  );
}
