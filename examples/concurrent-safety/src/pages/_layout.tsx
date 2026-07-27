import "../global.css";

import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Link } from "waku";
import { DevStyleXInject } from "../components/DevStyleXInject";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(styles.root)}>
      <title>react-concurrent-signals</title>
      <meta
        name="description"
        content="Concurrent-safe signal state for React transitions and no-tearing UI."
      />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <DevStyleXInject cssHref="/stylex.css" />
      <header {...stylex.props(styles.header)}>
        <Link to="/" {...stylex.props(styles.brand)}>
          react-concurrent-signals
        </Link>
        <nav {...stylex.props(styles.nav)} aria-label="Site">
          <Link to="/" {...stylex.props(styles.navLink)}>
            Examples
          </Link>
          <Link to="/docs" {...stylex.props(styles.navLink)}>
            Docs
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: "static",
  } as const;
};

const colors = {
  ink: "#25221c",
  surface: "#fffaf0",
  page: "#f6f2e8",
  accent: "#ffcf4a",
};

const styles = stylex.create({
  root: {
    minHeight: "100vh",
    backgroundColor: colors.page,
  },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.ink,
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    display: "flex",
    gap: 16,
    justifyContent: "space-between",
    paddingBlock: 14,
    paddingInline: {
      default: 16,
      "@media (min-width: 760px)": 24,
    },
  },
  brand: {
    color: colors.ink,
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: "1.15rem",
    fontWeight: 900,
    textDecorationLine: "none",
  },
  nav: {
    display: "flex",
    gap: 8,
  },
  navLink: {
    backgroundColor: {
      default: "transparent",
      ":hover": colors.accent,
    },
    borderColor: colors.ink,
    borderStyle: "solid",
    borderWidth: 1,
    color: colors.ink,
    fontSize: "0.86rem",
    fontWeight: 800,
    paddingBlock: 8,
    paddingInline: 10,
    textDecorationLine: "none",
  },
});
