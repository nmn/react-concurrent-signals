import * as stylex from "@stylexjs/stylex";
import { Link } from "waku";

export default async function DocsPage() {
  return (
    <main {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.hero)}>
        <p {...stylex.props(styles.eyebrow)}>Documentation</p>
        <h1 {...stylex.props(styles.title)}>Signals without concurrent tearing</h1>
        <p {...stylex.props(styles.lede)}>
          `react-concurrent-signals` keeps function-style signals aligned
          across pending transitions with scoped stores and committed snapshots.
        </p>
      </section>
      <section {...stylex.props(styles.grid)}>
        <article {...stylex.props(styles.panel)}>
          <h2 {...stylex.props(styles.heading)}>Install</h2>
          <pre {...stylex.props(styles.code)}>npm install react-concurrent-signals</pre>
        </article>
        <article {...stylex.props(styles.panel)}>
          <h2 {...stylex.props(styles.heading)}>Core API</h2>
          <ul {...stylex.props(styles.list)}>
            <li>`signal(initialValue)` creates primitive signal state.</li>
            <li>`signal(read, write)` creates derived readable or writable signals.</li>
            <li>`useObserve` subscribes React components to signal reads.</li>
            <li>`Provider` and `createStore` isolate independent signal scopes.</li>
          </ul>
        </article>
        <article {...stylex.props(styles.panel)}>
          <h2 {...stylex.props(styles.heading)}>Concurrency Behavior</h2>
          <p {...stylex.props(styles.copy)}>
            During a transition, mounted observers continue to show committed
            state. Sync writes are applied immediately and later rebased with
            pending transition work so duplicated observers do not disagree.
          </p>
        </article>
        <article {...stylex.props(styles.panel)}>
          <h2 {...stylex.props(styles.heading)}>Example</h2>
          <pre {...stylex.props(styles.code)}>{`const count$ = signal(0);
const doubled$ = signal(() => count$() * 2);

function Counter() {
  const count = useObserve(() => count$());
  const doubled = useObserve(() => doubled$());
  return <button onClick={() => count$.set((n) => n + 1)}>
    {count} / {doubled}
  </button>;
}`}</pre>
        </article>
      </section>
      <Link to="/" {...stylex.props(styles.cta)}>
        Open interactive examples
      </Link>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "static",
  } as const;
};

const colors = {
  ink: "#25221c",
  text: "#20201c",
  muted: "#675c49",
  page: "#f6f2e8",
  surface: "#fffaf0",
  accent: "#ffcf4a",
  green: "#2f6f63",
  white: "#fff9eb",
};

const styles = stylex.create({
  page: {
    backgroundColor: colors.page,
    color: colors.text,
    fontFamily: '"Avenir Next", "Gill Sans", "Trebuchet MS", system-ui, sans-serif',
    margin: "0 auto",
    maxWidth: 1040,
    minHeight: "100vh",
    paddingBlock: 36,
    paddingInline: 24,
  },
  hero: {
    borderBottomColor: colors.ink,
    borderBottomStyle: "solid",
    borderBottomWidth: 3,
    marginBottom: 24,
    paddingBottom: 22,
  },
  eyebrow: {
    color: colors.green,
    fontSize: "0.78rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    marginBlock: "0 10px",
    textTransform: "uppercase",
  },
  title: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: "clamp(2.2rem, 6vw, 4.5rem)",
    lineHeight: 0.98,
    marginBlock: "0 12px",
  },
  lede: {
    color: colors.muted,
    fontSize: "1.05rem",
    lineHeight: 1.55,
    margin: 0,
    maxWidth: 760,
  },
  grid: {
    display: "grid",
    gap: 16,
    gridTemplateColumns: {
      default: "1fr",
      "@media (min-width: 820px)": "repeat(2, minmax(0, 1fr))",
    },
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.ink,
    borderStyle: "solid",
    borderWidth: 2,
    boxShadow: `5px 5px 0 ${colors.ink}`,
    padding: 18,
  },
  heading: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: "1.35rem",
    marginBlock: "0 12px",
  },
  copy: {
    color: colors.muted,
    lineHeight: 1.55,
    margin: 0,
  },
  list: {
    color: colors.muted,
    lineHeight: 1.6,
    marginBlock: 0,
    paddingInlineStart: 18,
  },
  code: {
    backgroundColor: "#20201c",
    color: colors.white,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "0.82rem",
    lineHeight: 1.5,
    margin: 0,
    overflowX: "auto",
    padding: 14,
  },
  cta: {
    backgroundColor: colors.accent,
    borderColor: colors.ink,
    borderStyle: "solid",
    borderWidth: 2,
    color: colors.ink,
    display: "inline-block",
    fontWeight: 900,
    marginTop: 22,
    paddingBlock: 12,
    paddingInline: 14,
    textDecorationLine: "none",
  },
});
