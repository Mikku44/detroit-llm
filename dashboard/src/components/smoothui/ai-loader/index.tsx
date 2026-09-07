"use client";

import { cn } from "@/lib/utils";
import { motion, useAnimationFrame, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";

export const AI_LOADER_CYCLE_SECONDS = 1.2;
const DOT_COUNT = 3;
const GRID_SIZE = 3;
const GRID_CELLS = GRID_SIZE * GRID_SIZE;
const GRID_DELAYS = [0, 1, 2, 1, 2, 3, 2, 3, 4];
const EASE_IN_OUT = [0.645, 0.045, 0.355, 1] as const;
const MS_PER_SECOND = 1000;
const ELAPSED_DECIMALS = 1;

export type AILoaderVariant = "dots" | "bar" | "grid";
export type AILoaderProps = {
  className?: string;
  label?: string;
  showElapsed?: boolean;
  variant?: AILoaderVariant;
};

const Dots = ({ reduced }: { reduced: boolean }) => (
  <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
    {Array.from({ length: DOT_COUNT }, (_, index) => (
      <motion.span
        key={index}
        animate={reduced ? { opacity: 0.5 } : { opacity: [0.25, 1, 0.25] }}
        className="size-1.5 rounded-full bg-current"
        transition={reduced ? { duration: 0 } : {
          delay: (index * AI_LOADER_CYCLE_SECONDS) / (DOT_COUNT * 2),
          duration: AI_LOADER_CYCLE_SECONDS,
          ease: EASE_IN_OUT,
          repeat: Number.POSITIVE_INFINITY,
        }}
      />
    ))}
  </span>
);

const Bar = ({ reduced }: { reduced: boolean }) => (
  <span aria-hidden="true" className="relative block h-1 w-24 shrink-0 overflow-hidden rounded-full bg-current/15">
    <motion.span
      animate={reduced ? { x: "0%" } : { x: ["-100%", "200%"] }}
      className="absolute inset-y-0 w-1/3 rounded-full bg-current"
      transition={reduced ? { duration: 0 } : {
        duration: AI_LOADER_CYCLE_SECONDS * 1.4,
        ease: EASE_IN_OUT,
        repeat: Number.POSITIVE_INFINITY,
      }}
    />
  </span>
);

const Grid = ({ reduced }: { reduced: boolean }) => (
  <span aria-hidden="true" className="grid shrink-0 grid-cols-3 gap-0.5">
    {Array.from({ length: GRID_CELLS }, (_, index) => (
      <motion.span
        key={index}
        animate={reduced ? { opacity: 0.45 } : { opacity: [0.2, 1, 0.2] }}
        className="size-1.5 rounded-[2px] bg-current"
        transition={reduced ? { duration: 0 } : {
          delay: ((GRID_DELAYS[index] ?? 0) * AI_LOADER_CYCLE_SECONDS) / 8,
          duration: AI_LOADER_CYCLE_SECONDS,
          ease: EASE_IN_OUT,
          repeat: Number.POSITIVE_INFINITY,
        }}
      />
    ))}
  </span>
);

const Elapsed = () => {
  const startRef = useRef<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  useAnimationFrame((time) => {
    const start = startRef.current ?? time;
    startRef.current = start;
    const next = (time - start) / MS_PER_SECOND;
    setSeconds((current) =>
      next.toFixed(ELAPSED_DECIMALS) === current.toFixed(ELAPSED_DECIMALS)
        ? current : next
    );
  });
  return (
    // Reserve counter width so digit changes cannot wrap the loader.
    <span aria-hidden="true" className="w-16 shrink-0 overflow-hidden text-right tabular-nums opacity-60">
      {seconds.toFixed(ELAPSED_DECIMALS)}s
    </span>
  );
};

const AILoader = ({ className, label, showElapsed = false, variant = "dots" }: AILoaderProps) => {
  const reduced = Boolean(useReducedMotion());
  return (
    <span
      aria-live="polite"
      role="status"
      className={cn(
        "relative inline-flex h-6 max-w-full shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap align-middle text-sm leading-6 text-zinc-500 dark:text-zinc-400",
        className
      )}
    >
      {label ? <span className="min-w-0 truncate">{label}</span> : null}
      {variant === "dots" && <Dots reduced={reduced} />}
      {variant === "bar" && <Bar reduced={reduced} />}
      {variant === "grid" && <Grid reduced={reduced} />}
      {showElapsed ? <Elapsed /> : null}
      {!label ? <span className="sr-only">Loading</span> : null}
    </span>
  );
};

export default AILoader;
