import React from "react";
import { twMerge } from "tailwind-merge";

export type TabItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
};

export type TabProps = {
  tabs: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
};

/**
 * Shared macOS-style Tab bar primitive.
 *
 * Renders a segmented-control–style tab strip using foundation tokens.
 *   bg (strip)   transparent
 *   active tab   var(--color-control) with subtle shadow (macOS segmented style)
 *   inactive     text-label-secondary, hover bg-control-hover
 *   height       ~22px per tab button (h-[1.7rem]) at 13px root density
 *   radius       6px matching NSSegmentedControl
 *
 * Usage:
 *   <Tab tabs={[{id:'a',label:'Alpha'},{id:'b',label:'Beta'}]} activeId="a" onSelect={setActive} />
 */
export const Tab: React.FC<TabProps> = ({ tabs, activeId, onSelect, className }) => {
  return (
    <div
      className={twMerge(
        "flex flex-wrap gap-1 p-1 bg-window rounded-[8px]",
        className,
      )}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={twMerge(
              "inline-flex items-center gap-1.5 h-[1.7rem] px-3 rounded-[6px]",
              "text-[0.846rem] font-medium leading-none select-none transition-colors",
              "focus-visible:outline-none",
              isActive
                ? "bg-control text-label-primary shadow-sm"
                : "text-label-secondary hover:bg-control-hover hover:text-label-primary",
            )}
          >
            {tab.icon && <span className="size-3.5 shrink-0">{tab.icon}</span>}
            <span className="whitespace-nowrap">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};
