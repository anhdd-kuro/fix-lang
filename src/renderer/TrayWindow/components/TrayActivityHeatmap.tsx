import { format, parseISO } from "date-fns";
import React, { useEffect, useMemo, useState } from "react";
import { twJoin } from "tailwind-merge";
import {
  HOUR_BLOCKS,
  HOURS_PER_BLOCK,
  sevenDayHourBlockHeatmap,
} from "../../MainWindow/overviewAggregations";
import type { HistoryEntry } from "~/stores/historyTypes";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const blockHourLabel = (blockIndex: number): string => {
  const start = blockIndex * HOURS_PER_BLOCK;
  const end = start + HOURS_PER_BLOCK;
  return `${start}–${end}`;
};

const intensityClass = (count: number, max: number): string => {
  if (count === 0 || max === 0) {
    return "bg-gray-700/60";
  }
  const ratio = count / max;
  if (ratio >= 0.75) {
    return "bg-green-500";
  }
  if (ratio >= 0.5) {
    return "bg-green-600";
  }
  if (ratio >= 0.25) {
    return "bg-green-700";
  }
  return "bg-green-800";
};

type TrayActivityHeatmapProps = {
  entries: HistoryEntry[];
};

export const TrayActivityHeatmap: React.FC<TrayActivityHeatmapProps> = ({
  entries,
}) => {
  const heatmap = useMemo(
    () => sevenDayHourBlockHeatmap(entries, new Date()),
    [entries]
  );

  const hasActivity = entries.length > 0;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/80 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-blue-400 mb-2">
        7-day activity
      </div>

      {!hasActivity ? (
        <p className="text-sm text-gray-500">No activity yet</p>
      ) : (
        <div className="flex flex-col gap-1">
          <div
            className="grid gap-0.5"
            style={{
              gridTemplateColumns: `repeat(${heatmap.days.length}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${HOUR_BLOCKS}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: HOUR_BLOCKS }, (_, blockIndex) =>
              heatmap.days.map((dayKey, dayIndex) => {
                const count = heatmap.cells[dayIndex][blockIndex];
                const dayDate = parseISO(`${dayKey}T12:00:00`);
                const weekday = WEEKDAY_LABELS[dayDate.getDay()];
                const tooltip = `${weekday} ${blockHourLabel(blockIndex)}: ${count} correction${count === 1 ? "" : "s"}`;

                return (
                  <div
                    key={`${dayKey}-${blockIndex}`}
                    title={tooltip}
                    className={twJoin(
                      "aspect-square min-h-[10px] rounded-sm",
                      intensityClass(count, heatmap.max)
                    )}
                  />
                );
              })
            )}
          </div>

          <div
            className="grid gap-0.5 text-[10px] text-gray-500 text-center"
            style={{
              gridTemplateColumns: `repeat(${heatmap.days.length}, minmax(0, 1fr))`,
            }}
          >
            {heatmap.days.map((dayKey) => {
              const dayDate = parseISO(`${dayKey}T12:00:00`);
              return (
                <span key={dayKey}>{format(dayDate, "EEE")}</span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/** Loads correction history and refreshes on history updates. */
export const TrayActivityHeatmapLoader: React.FC = () => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    window.electronAPI.getHistory("corrections").then((history) => {
      if (!cancelled) {
        setEntries(history);
      }
    });

    const removeListener = window.electronAPI.onHistoryUpdate?.(() => {
      window.electronAPI.getHistory("corrections").then((history) => {
        if (!cancelled) {
          setEntries(history);
        }
      });
    });

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, []);

  return <TrayActivityHeatmap entries={entries} />;
};
