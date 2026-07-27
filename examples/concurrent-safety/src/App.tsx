"use client";

import * as stylex from "@stylexjs/stylex";
import {
  startTransition,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { ReactNode } from "react";
import {
  Provider,
  createStore,
  signal,
  useObserve,
  useStore,
} from "react-concurrent-signals";

type Gate = {
  promise: Promise<void>;
  resolve: () => void;
};

function createGate(): Gate {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function StoreExample({
  store,
  children,
}: {
  store: ReturnType<typeof createStore>;
  children: ReactNode;
}) {
  return <Provider store={store}>{children}</Provider>;
}

const mountCount$ = signal(1);

function MountCount({ label }: { label: string }) {
  const count = useObserve(() => mountCount$());
  return <Readout label={label} value={count} />;
}

function MountMidTransitionExample() {
  const [runId, setRunId] = useState(0);
  const [showOther, setShowOther] = useState(false);
  const [phase, setPhase] = useState("Ready");
  const gateRef = useRef<Gate | null>(null);
  const store = useMemo(() => createStore(), [runId]);

  const startPendingTransition = () => {
    if (gateRef.current) {
      return;
    }
    const gate = createGate();
    gateRef.current = gate;
    setPhase("Transition pending: existing readers should still show 1");
    startTransition(async () => {
      store.run(() => mountCount$.set((count) => count + 1));
      await gate.promise;
      setPhase("Transition committed: both readers should show 2");
    });
  };

  const revealReader = () => {
    setShowOther(true);
    setPhase("Second reader mounted sync: both readers should show 1");
  };

  const resolveTransition = () => {
    gateRef.current?.resolve();
    gateRef.current = null;
  };

  const reset = () => {
    gateRef.current?.resolve();
    gateRef.current = null;
    setShowOther(false);
    setPhase("Ready");
    setRunId((id) => id + 1);
  };

  return (
    <StoreExample store={store}>
      <ExampleCard
        title="Reader Mounts Mid-Transition"
        phase={phase}
        actions={
          <>
            <Button onClick={startPendingTransition}>Start transition +1</Button>
            <Button onClick={revealReader}>Mount second reader</Button>
            <Button onClick={resolveTransition}>Resolve transition</Button>
            <Button variant="secondary" onClick={reset}>
              Reset
            </Button>
          </>
        }
      >
        <div {...stylex.props(styles.readoutGrid)}>
          <MountCount label="primary" />
          {showOther ? <MountCount label="secondary" /> : <EmptyReadout />}
        </div>
      </ExampleCard>
    </StoreExample>
  );
}

const rebaseCount$ = signal(2);

function RebaseCount({ label }: { label: string }) {
  const count = useObserve(() => rebaseCount$());
  return <Readout label={label} value={count} />;
}

function RebaseExample() {
  const [runId, setRunId] = useState(0);
  const [showOther, setShowOther] = useState(false);
  const [phase, setPhase] = useState("Ready");
  const gateRef = useRef<Gate | null>(null);
  const store = useMemo(() => createStore(), [runId]);

  const startMultiplyTransition = () => {
    if (gateRef.current) {
      return;
    }
    const gate = createGate();
    gateRef.current = gate;
    setPhase("Transition pending: *2 is waiting, visible value stays 2");
    startTransition(async () => {
      store.run(() => rebaseCount$.set((count) => count * 2));
      await gate.promise;
      setPhase("Transition committed: chronological result is 5");
    });
  };

  const interruptSync = () => {
    store.run(() => rebaseCount$.set((count) => count + 1));
    setShowOther(true);
    setPhase("Sync +1 interrupted transition: both readers should show 3");
  };

  const resolveTransition = () => {
    gateRef.current?.resolve();
    gateRef.current = null;
  };

  const reset = () => {
    gateRef.current?.resolve();
    gateRef.current = null;
    setShowOther(false);
    setPhase("Ready");
    setRunId((id) => id + 1);
  };

  return (
    <StoreExample store={store}>
      <ExampleCard
        title="Sync Update Interrupts Transition"
        phase={phase}
        actions={
          <>
            <Button onClick={startMultiplyTransition}>Start transition *2</Button>
            <Button onClick={interruptSync}>Sync +1 and mount reader</Button>
            <Button onClick={resolveTransition}>Resolve transition</Button>
            <Button variant="secondary" onClick={reset}>
              Reset
            </Button>
          </>
        }
      >
        <div {...stylex.props(styles.readoutGrid)}>
          <RebaseCount label="primary" />
          {showOther ? <RebaseCount label="secondary" /> : <EmptyReadout />}
        </div>
      </ExampleCard>
    </StoreExample>
  );
}

const overlapCount$ = signal(1);

function OverlapCount({ label }: { label: string }) {
  const count = useObserve(() => overlapCount$());
  return <Readout label={label} value={count} />;
}

function OverlappingTransitionsExample() {
  const [runId, setRunId] = useState(0);
  const [showOther, setShowOther] = useState(false);
  const [phase, setPhase] = useState("Ready");
  const firstGateRef = useRef<Gate | null>(null);
  const secondGateRef = useRef<Gate | null>(null);
  const store = useMemo(() => createStore(), [runId]);

  const startBothTransitions = () => {
    if (firstGateRef.current || secondGateRef.current) {
      return;
    }
    const firstGate = createGate();
    const secondGate = createGate();
    firstGateRef.current = firstGate;
    secondGateRef.current = secondGate;
    setPhase("Two transitions pending: +1 then *10, visible value stays 1");
    startTransition(async () => {
      store.run(() => overlapCount$.set((count) => count + 1));
      await firstGate.promise;
    });
    startTransition(async () => {
      store.run(() => overlapCount$.set((count) => count * 10));
      await secondGate.promise;
      setPhase("Transitions committed: chronological result is 120");
    });
  };

  const interruptSync = () => {
    store.run(() => overlapCount$.set((count) => count + 100));
    setShowOther(true);
    setPhase("Sync +100 interrupted both transitions: readers show 101");
  };

  const resolveTransitions = () => {
    secondGateRef.current?.resolve();
    firstGateRef.current?.resolve();
    firstGateRef.current = null;
    secondGateRef.current = null;
  };

  const reset = () => {
    firstGateRef.current?.resolve();
    secondGateRef.current?.resolve();
    firstGateRef.current = null;
    secondGateRef.current = null;
    setShowOther(false);
    setPhase("Ready");
    setRunId((id) => id + 1);
  };

  return (
    <StoreExample store={store}>
      <ExampleCard
        title="Overlapping Transitions"
        phase={phase}
        actions={
          <>
            <Button onClick={startBothTransitions}>Start +1 and *10</Button>
            <Button onClick={interruptSync}>Sync +100 and mount reader</Button>
            <Button onClick={resolveTransitions}>Resolve both</Button>
            <Button variant="secondary" onClick={reset}>
              Reset
            </Button>
          </>
        }
      >
        <div {...stylex.props(styles.readoutGrid)}>
          <OverlapCount label="primary" />
          {showOther ? <OverlapCount label="secondary" /> : <EmptyReadout />}
        </div>
      </ExampleCard>
    </StoreExample>
  );
}

const left$ = signal(1);
const right$ = signal(2);
const total$ = signal(() => left$() + right$());
const scaleBoth$ = signal(
  () => null,
  (factor: number) => {
    left$.set(left$() * factor);
    right$.set(right$() * factor);
  },
);
const addBoth$ = signal(
  () => null,
  (amount: number) => {
    left$.set(left$() + amount);
    right$.set(right$() + amount);
  },
);

function TotalReadout({ label }: { label: string }) {
  const total = useObserve(() => total$());
  return <Readout label={label} value={total} />;
}

function DerivedWriteControls() {
  const store = useStore();
  return (
    <Button
      onClick={() => {
        store.run(() => scaleBoth$.set(2));
      }}
    >
      Scale immediately
    </Button>
  );
}

function DerivedWriteExample() {
  const [runId, setRunId] = useState(0);
  const [showOther, setShowOther] = useState(false);
  const [phase, setPhase] = useState("Ready");
  const gateRef = useRef<Gate | null>(null);
  const store = useMemo(() => createStore(), [runId]);

  const startScaleTransition = () => {
    if (gateRef.current) {
      return;
    }
    const gate = createGate();
    gateRef.current = gate;
    setPhase("Transition pending: scale both by 2, total stays 3");
    startTransition(async () => {
      store.run(() => scaleBoth$.set(2));
      await gate.promise;
      setPhase("Transition committed: rebased total is 26");
    });
  };

  const interruptSync = () => {
    store.run(() => addBoth$.set(10));
    setShowOther(true);
    setPhase("Sync +10 to both interrupted transition: readers show 23");
  };

  const resolveTransition = () => {
    gateRef.current?.resolve();
    gateRef.current = null;
  };

  const reset = () => {
    gateRef.current?.resolve();
    gateRef.current = null;
    setShowOther(false);
    setPhase("Ready");
    setRunId((id) => id + 1);
  };

  return (
    <StoreExample store={store}>
      <ExampleCard
        title="Derived Signal Writes"
        phase={phase}
        actions={
          <>
            <Button onClick={startScaleTransition}>Transition scale both</Button>
            <Button onClick={interruptSync}>Sync add 10 and mount reader</Button>
            <Button onClick={resolveTransition}>Resolve transition</Button>
            <Button variant="secondary" onClick={reset}>
              Reset
            </Button>
          </>
        }
      >
        <div {...stylex.props(styles.readoutGrid)}>
          <TotalReadout label="total" />
          {showOther ? <TotalReadout label="second total" /> : <EmptyReadout />}
        </div>
        <div {...stylex.props(styles.inlineControl)}>
          <DerivedWriteControls />
        </div>
      </ExampleCard>
    </StoreExample>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const count$ = signal(0);
const multiplier$ = signal(1);
const result$ = signal(() => count$() * multiplier$());

function CountControls() {
  const store = useStore();
  const [isPending, startTransition] = useTransition();
  const count = useObserve(() => count$());
  const slowIncrement = () => {
    startTransition(async () => {
      store.run(() => count$.set((count) => count + 1));
      await sleep(2000);
    });
  };

  return (
    <div {...stylex.props(styles.counterGroup, isPending && styles.pending)}>
      <Button
        onClick={() => store.run(() => count$.set((count) => count - 1))}
        disabled={isPending}
      >
        -
      </Button>
      <Readout label="count" value={count} compact />
      <Button onClick={() => store.run(() => count$.set((count) => count + 1))}>
        +
      </Button>
      <Button onClick={slowIncrement}>Slow+</Button>
    </div>
  );
}

function MultiplierControls() {
  const store = useStore();
  const multiplier = useObserve(() => multiplier$());
  return (
    <div {...stylex.props(styles.counterGroup)}>
      <Button
        onClick={() =>
          store.run(() => multiplier$.set((multiplier) => multiplier - 1))
        }
      >
        -
      </Button>
      <Readout label="multiplier" value={multiplier} compact />
      <Button
        onClick={() =>
          store.run(() => multiplier$.set((multiplier) => multiplier + 1))
        }
      >
        +
      </Button>
    </div>
  );
}

function CounterExample() {
  const [runId] = useState(0);
  const store = useMemo(() => createStore(), [runId]);

  return (
    <StoreExample store={store}>
      <section {...stylex.props(styles.exampleCard, styles.wideCard)}>
        <CountControls />
        <MultiplierControls />
        <ResultReadout />
      </section>
    </StoreExample>
  );
}

function ResultReadout() {
  const result = useObserve(() => result$());
  return <Readout label="result" value={result} compact />;
}

function Readout({
  label,
  value,
  compact,
}: {
  label: string;
  value: number;
  compact?: boolean;
}) {
  return (
    <output
      {...stylex.props(styles.readout, compact && styles.compactReadout)}
      aria-label={label}
    >
      <span {...stylex.props(styles.readoutLabel)}>{label}</span>
      <strong {...stylex.props(styles.readoutValue)}>{value}</strong>
    </output>
  );
}

function EmptyReadout() {
  return (
    <div {...stylex.props(styles.readout, styles.emptyReadout)}>
      <span {...stylex.props(styles.readoutLabel)}>not mounted</span>
      <strong {...stylex.props(styles.readoutValue)}>-</strong>
    </div>
  );
}

function Button({
  children,
  disabled,
  onClick,
  variant = "primary",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      {...stylex.props(
        styles.button,
        variant === "secondary" && styles.secondaryButton,
        disabled && styles.disabledButton,
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ExampleCard({
  title,
  phase,
  actions,
  children,
}: {
  title: string;
  phase: string;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(styles.exampleCard)}>
      <header {...stylex.props(styles.cardHeader)}>
        <h2 {...stylex.props(styles.cardTitle)}>{title}</h2>
        <p {...stylex.props(styles.phase)}>{phase}</p>
      </header>
      {children}
      <div {...stylex.props(styles.actions)}>{actions}</div>
    </section>
  );
}

export default function App() {
  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.appHeader)}>
        <div>
          <h1 {...stylex.props(styles.title)}>Concurrent Signal Lab</h1>
          <p {...stylex.props(styles.subtitle)}>
            Interactive React transition scenarios rebuilt with scoped signal
            reads, direct signal writes, and derived signal updates.
          </p>
        </div>
        <span {...stylex.props(styles.badge)}>React 19 transitions</span>
      </header>
      <div {...stylex.props(styles.examples)}>
        <MountMidTransitionExample />
        <RebaseExample />
        <OverlappingTransitionsExample />
        <DerivedWriteExample />
      </div>
      <div {...stylex.props(styles.examples)}>
        <CounterExample />
      </div>
    </main>
  );
}

const colors = {
  ink: "#25221c",
  text: "#20201c",
  muted: "#675c49",
  page: "#f6f2e8",
  surface: "#fffaf0",
  accent: "#ffcf4a",
  accentHover: "#ffdf7a",
  secondary: "#f7f4ec",
  readout: "#e8f4e6",
  stripe: "#f4efe4",
  stripeAlt: "#e7dece",
  green: "#2f6f63",
  white: "#fff9eb",
  rule: "#d5c9b6",
};

const fonts = {
  sans: '"Avenir Next", "Gill Sans", "Trebuchet MS", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

const styles = stylex.create({
  page: {
    backgroundColor: colors.page,
    color: colors.text,
    fontFamily: fonts.sans,
    margin: "0 auto",
    maxWidth: 1180,
    minHeight: "100vh",
    paddingBlock: 32,
    paddingInline: 24,
    "@media (max-width: 860px)": {
      paddingBlock: 22,
      paddingInline: 14,
    },
  },
  appHeader: {
    alignItems: "end",
    borderBottomColor: colors.ink,
    borderBottomStyle: "solid",
    borderBottomWidth: 3,
    display: "flex",
    gap: 24,
    justifyContent: "space-between",
    marginBottom: 28,
    paddingBottom: 22,
    "@media (max-width: 860px)": {
      alignItems: "start",
      flexDirection: "column",
    },
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: "clamp(2.2rem, 6vw, 4.8rem)",
    fontWeight: 900,
    lineHeight: 0.95,
    marginBlock: "0 12px",
  },
  subtitle: {
    color: colors.muted,
    fontSize: "1rem",
    lineHeight: 1.5,
    margin: 0,
    maxWidth: 680,
  },
  badge: {
    backgroundColor: colors.green,
    borderColor: colors.ink,
    borderStyle: "solid",
    borderWidth: 2,
    color: colors.white,
    flexBasis: "auto",
    flexGrow: 0,
    flexShrink: 0,
    fontSize: "0.8rem",
    fontWeight: 800,
    paddingBlock: "0.55rem",
    paddingInline: "0.7rem",
    textTransform: "uppercase",
  },
  examples: {
    display: "grid",
    gap: 18,
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    marginTop: 16,
    "@media (max-width: 860px)": {
      gridTemplateColumns: "1fr",
    },
  },
  exampleCard: {
    backgroundColor: colors.surface,
    borderColor: colors.ink,
    borderStyle: "solid",
    borderWidth: 2,
    boxShadow: `6px 6px 0 ${colors.ink}`,
    display: "grid",
    gap: 18,
    minHeight: 330,
    padding: 18,
    "@media (max-width: 520px)": {
      boxShadow: `4px 4px 0 ${colors.ink}`,
    },
  },
  wideCard: {
    alignItems: "center",
    display: "flex",
    gridColumn: "span 2",
    minHeight: "auto",
    "@media (max-width: 860px)": {
      alignItems: "stretch",
      flexDirection: "column",
      gridColumn: "span 1",
    },
  },
  cardHeader: {
    borderBottomColor: colors.rule,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    minHeight: 92,
    paddingBottom: 12,
  },
  cardTitle: {
    fontFamily: fonts.serif,
    fontSize: "1.5rem",
    lineHeight: 1.1,
    marginBlock: "0 10px",
  },
  phase: {
    color: colors.muted,
    fontSize: "0.92rem",
    lineHeight: 1.4,
    margin: 0,
  },
  readoutGrid: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    "@media (max-width: 520px)": {
      gridTemplateColumns: "1fr",
    },
  },
  readout: {
    alignItems: "center",
    backgroundColor: colors.readout,
    borderColor: colors.ink,
    borderStyle: "solid",
    borderWidth: 2,
    display: "flex",
    justifyContent: "space-between",
    minHeight: 82,
    padding: 14,
  },
  compactReadout: {
    minWidth: 150,
  },
  emptyReadout: {
    backgroundImage: `repeating-linear-gradient(135deg, ${colors.stripe}, ${colors.stripe} 8px, ${colors.stripeAlt} 8px, ${colors.stripeAlt} 16px)`,
    color: "#736856",
  },
  readoutLabel: {
    fontSize: "0.78rem",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  readoutValue: {
    fontFamily: fonts.serif,
    fontSize: "3rem",
    lineHeight: 1,
  },
  actions: {
    alignSelf: "end",
    display: "grid",
    gap: 8,
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    "@media (max-width: 520px)": {
      gridTemplateColumns: "1fr",
    },
  },
  inlineControl: {
    display: "flex",
    justifyContent: "flex-start",
  },
  counterGroup: {
    alignItems: "center",
    display: "flex",
    flexShrink: 0,
    gap: 8,
    "@media (max-width: 520px)": {
      alignItems: "stretch",
      flexWrap: "wrap",
    },
  },
  pending: {
    opacity: 0.5,
  },
  button: {
    backgroundColor: {
      default: colors.accent,
      ":hover": colors.accentHover,
    },
    borderColor: colors.ink,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: {
      default: `0 0 0 ${colors.ink}`,
      ":hover": `3px 3px 0 ${colors.ink}`,
      ":active": `0 0 0 ${colors.ink}`,
    },
    color: "#171510",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "0.9rem",
    fontWeight: 700,
    minHeight: 40,
    paddingBlock: "0.62rem",
    paddingInline: "0.8rem",
    transform: {
      default: "translate(0, 0)",
      ":hover": "translate(-1px, -1px)",
      ":active": "translate(0, 0)",
    },
    transitionDuration: "160ms",
    transitionProperty: "background-color, transform, box-shadow",
    transitionTimingFunction: "ease",
  },
  secondaryButton: {
    backgroundColor: {
      default: colors.secondary,
      ":hover": colors.accentHover,
    },
  },
  disabledButton: {
    cursor: "not-allowed",
    opacity: 0.5,
  },
});
