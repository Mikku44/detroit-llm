import React from 'react';
import { HiOutlineBookOpen, HiOutlineKey } from 'react-icons/hi2';

export const ApiKeyButtons: React.FC = () => {
  return (
    <div className="flex items-center gap-2 sm:gap-3 p-0 shrink-0">
      {/* Documentation / Book Icon Button */}
      <a
        href="/docs"
        type="button"
        aria-label="Documentation"
        className="flex h-11 w-11 items-center justify-center rounded-2xl border
         border-zinc-700 bg-zinc-900 text-zinc-200 shadow-sm transition-all hover:bg-zinc-700 active:scale-95"
      >
        <HiOutlineBookOpen className="h-5 w-5 stroke-[1.75]" />
      </a>

      {/* Get API Key Button */}
      <a
        href="/keys"
        className="flex h-11 items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium
         text-zinc-200 shadow-sm transition-all hover:bg-zinc-700 active:scale-95"
      >
        <HiOutlineKey className="h-5 w-5 stroke-[1.75]" />
        <span>Get API key</span>
      </a>
    </div>
  );
};

export default ApiKeyButtons;
