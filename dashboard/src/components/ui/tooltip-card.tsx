"use client";
import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/utils";

const TOOLTIP_WIDTH = 240;
const GAP = 12;

export const Tooltip = ({
  content,
  children,
  containerClassName,
}: {
  content: string | React.ReactNode;
  children: React.ReactNode;
  containerClassName?: string;
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [height, setHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible && contentRef.current) {
      setHeight(contentRef.current.scrollHeight);
    }
  }, [isVisible, content]);

  const place = (clientX: number, clientY: number) => {
    const el = contentRef.current;
    const h = el ? el.scrollHeight : 0;
    setHeight(h);
    let x = clientX + GAP;
    let y = clientY + GAP;
    if (x + TOOLTIP_WIDTH > window.innerWidth) x = clientX - TOOLTIP_WIDTH - GAP;
    if (x < 0) x = GAP;
    if (y + h > window.innerHeight) y = clientY - h - GAP;
    if (y < 0) y = GAP;
    setPos({ x, y });
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsVisible(true);
    place(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isVisible) return;
    place(e.clientX, e.clientY);
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    place(touch.clientX, touch.clientY);
    setIsVisible(true);
  };

  const handleTouchEnd = () => {
    setTimeout(() => {
      setIsVisible(false);
    }, 2000);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia("(hover: none)").matches) {
      e.preventDefault();
      if (isVisible) {
        setIsVisible(false);
      } else {
        place(e.clientX, e.clientY);
        setIsVisible(true);
      }
    }
  };

  return (
    <div
      className={cn("relative inline-block", containerClassName)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {isVisible && (
            <motion.div
              key={String(isVisible)}
              initial={{ height: 0, opacity: 1 }}
              animate={{ height, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 200,
                damping: 20,
              }}
              className="pointer-events-none fixed left-0 top-0 z-[100] min-w-[15rem] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] dark:border-white/10 dark:bg-neutral-900"
              style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
            >
              <div
                ref={contentRef}
                className="p-2 text-sm text-neutral-600 md:p-4 dark:text-neutral-400"
              >
                {content}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};