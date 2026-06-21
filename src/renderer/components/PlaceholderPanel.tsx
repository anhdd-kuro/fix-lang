/**
 * @file PlaceholderPanel.tsx
 * @description Reusable "coming soon" panel used by the Overview / Models /
 * OpenRouter dashboard tabs (#54). It is intentionally INERT.
 *
 * Placeholder only — data wiring lands in #57 (Overview), #58 (Models) and
 * #59 (OpenRouter). Do NOT add network/IPC calls or data-fetching effects on
 * mount or tab switch here. The "no network on tab switch" acceptance criterion
 * for #54 depends on these panels staying side-effect-free. Downstream issues
 * must wire data gated on tab-open (lazy), not background polling.
 */

type PlaceholderPanelProps = {
  title: string;
  description: string;
};

export const PlaceholderPanel = ({
  title,
  description,
}: PlaceholderPanelProps) => {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-xs rounded-lg border border-gray-700 bg-gray-800 px-6 py-8 text-center">
        <h2 className="mb-2 text-lg font-semibold text-blue-400">{title}</h2>
        <p className="text-sm text-gray-400">{description}</p>
        <p className="mt-3 text-xs text-gray-500">Coming soon</p>
      </div>
    </div>
  );
};
