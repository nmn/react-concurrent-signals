import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/vanilla.ts", "src/react.tsx"],
  format: ["cjs", "esm"],
  minify: "terser",
  terserOptions: {
    compress: { passes: 5, toplevel: true },
    mangle: { toplevel: true },
  },
  sourcemap: false,
  splitting: true,
  esbuildOptions(options) {
    // Properties in this list may only be used internally. Any matching
    // platform or public API property must use quoted access so esbuild leaves
    // it intact (for example iterator["next"]() and options["store"]).
    options.mangleQuoted = false;
    options.mangleProps =
      /^(INTERNAL_setPrimitive|INTERNAL_subscribe|active|activeSubscriptionCount|addFallbackTracker|addStore|all|applyAction|applyPrimitiveAction|args|assertOpen|base|candidates|change|changed|changes|children|collect|collectStates|collectTransitiveDependencies|commitAllStates|committed|committedRead|committedSequence|committedState|context|contextDepth|count|createReader|createResult|createSubscriptionState|currentDependencyCollector|currentSize|deliverChange|deliverPreparedChange|dependencyVersion|depth|directDependencies|draft|effect|emitChange|empty|entry|epoch|evaluate|evaluationCandidates|evaluationState|evaluations|fallbackTrackers|findReusableEvaluation|finish|finished|first|getAllCommittedStates|getAllStates|getCachedSubscriptionState|getEntry|getEvaluationCandidates|getEvaluationState|getInitialRevision|getInternalSnapshot|getMaterialized|getNotificationReader|getReader|getSnapshotValues|handleChange|handleCommit|hasEmitterListeners|head|headSequence|hooks|id|index|indexedDependencies|initialized|isActive|isEvaluationValid|key|kind|listener|listeners|listenerSnapshot|manager|managerStates|materialized|mountedDependencies|mountedSignals|next|nextOrder|nextReader|nextSnapshot|nextStates|node|notificationContext|notificationEntry|notificationEpoch|notificationStates|notifyTrackers|observation|observationVersion|order|orderTail|overrides|owner|parent|pendingSubscriptions|phase|previous|previousReader|previousResult|previousSnapshot|previousStates|primitives|queuedEpoch|readContext|readDependency|readEvaluation|readEvaluationInContext|readFreshObservation|readPrimitive|readPrimitiveResult|readResult|readers|rebase|rebaseFrame|reconcileMountedSignals|reduceAction|reducer|refreshFromRender|reindexSubscription|rememberEvaluation|removeStore|result|resultOnly|retainSignal|revision|root|scratch|second|sequence|setEntry|setPrimitive|setPrimitiveValue|signal|snapshot|start|state|staticDependencies|storeEvaluation|storeRefCounts|subscription|subscriptionsByDependency|sweep|toMap|unmount|unmountSignal|unregisterNotification|unsubscribe|updatePendingSubscription|updatesCommitted|updatesHead|valueSource|virtualCount|virtualListeners|virtualSnapshot|writeSignal|_evaluations)$/;
  },
});
