import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { colord, extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { THEME_IDS } from "~/stores/themeIds";

type ButtonElement = {
  opening: string;
  element: string;
  attributes: Readonly<Record<string, string | true>>;
};

type ConsumerContract = {
  id: string;
  file: string;
  elementIndex: number;
  resolvedType: "button";
  resolvedVariant: string;
  attributes: Readonly<Record<string, string | true>>;
};

const normalizeSource = (source: string): string =>
  source.replace(/\s+/g, " ").trim();

const normalizeSyntax = (source: string): string => {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.JSX,
    source,
  );
  const tokens: string[] = [];
  let token = scanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    tokens.push(scanner.getTokenText());
    token = scanner.scan();
  }

  return tokens.join(" ");
};

const attributesForElement = (
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): Readonly<Record<string, string | true>> =>
  Object.fromEntries(
    element.attributes.properties.map((property) => {
      if (ts.isJsxSpreadAttribute(property)) {
        return ["...", normalizeSyntax(property.getText(sourceFile))];
      }
      return [
        property.name.getText(sourceFile),
        property.initializer === undefined
          ? true
          : normalizeSyntax(property.initializer.getText(sourceFile)),
      ];
    }),
  );

const buttonElementsInSource = (
  source: string,
  fileName = "consumer.tsx",
): ButtonElement[] => {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const elements: ButtonElement[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(sourceFile) === "Button"
    ) {
      elements.push({
        opening: normalizeSource(node.openingElement.getText(sourceFile)),
        element: normalizeSource(node.getText(sourceFile)),
        attributes: attributesForElement(node.openingElement, sourceFile),
      });
    } else if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(sourceFile) === "Button"
    ) {
      const element = normalizeSource(node.getText(sourceFile));
      elements.push({
        opening: element,
        element,
        attributes: attributesForElement(node, sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return elements;
};

const consumers = [
  {
    id: "BTN-003",
    file: "src/renderer/components/HistoryPanel.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '{activeFilter === null ? "primary" : "secondary"}',
    attributes: {
      variant: '{activeFilter === null ? "primary" : "secondary"}',
      onClick: "{() => setActiveFilter(null)}",
      className: '"px-2 py-0.5 text-xs rounded-sm"',
    },
  },
  {
    id: "BTN-004",
    file: "src/renderer/components/HistoryPanel.tsx",
    elementIndex: 1,
    resolvedType: "button",
    resolvedVariant: '{activeFilter === name ? "primary" : "secondary"}',
    attributes: {
      key: "{name}",
      variant: '{activeFilter === name ? "primary" : "secondary"}',
      onClick: "{() => setActiveFilter(toggleFilter(activeFilter, name))}",
      className: '"px-2 py-0.5 text-xs rounded-sm"',
    },
  },
  {
    id: "BTN-006",
    file: "src/renderer/components/HotkeyInput.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '"primary"',
    attributes: {
      type: '"button"',
      onClick: "{handleApply}",
      disabled: "{!pendingCombo || !!fieldError}",
      className: '"px-3 py-1.5 text-xs font-semibold rounded"',
    },
  },
  {
    id: "BTN-007",
    file: "src/renderer/components/KeyBinding.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '"primary"',
    attributes: {
      type: '"button"',
      className: '"ml-auto px-2 py-1.5 text-xs font-semibold rounded-lg"',
      onClick: "{() => onChange([])}",
    },
  },
  {
    id: "BTN-008",
    file: "src/renderer/components/SegmentedControl.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '{isActive ? "primary" : "ghost"}',
    attributes: {
      key: "{option.value}",
      variant: '{isActive ? "primary" : "ghost"}',
      type: '"button"',
      lang: "{option.lang}",
      "aria-pressed": "{isActive}",
      disabled: "{option.disabled}",
      onClick: "{() => { if (isActive) return; onChange(option.value); }}",
      className:
        '{twJoin("rounded-md font-medium whitespace-nowrap", SIZE_CLASSES[size], equalWidth && "flex-1", isActive ? "shadow" : "text-muted-foreground hover:text-foreground",)}',
    },
  },
  {
    id: "BTN-009",
    file: "src/renderer/components/LogsPanel.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '"destructive"',
    attributes: {
      variant: '"destructive"',
      onClick: "{() => void handleClear()}",
      className: '"rounded-md px-3 py-1.5 text-sm"',
    },
  },
  {
    id: "BTN-010",
    file: "src/renderer/components/LogsPanel.tsx",
    elementIndex: 1,
    resolvedType: "button",
    resolvedVariant: '"secondary"',
    attributes: {
      variant: '"secondary"',
      onClick: "{() => void handleCopy()}",
      className: '"rounded-md px-3 py-1.5 text-sm"',
    },
  },
  {
    id: "BTN-011",
    file: "src/renderer/components/LogsPanel.tsx",
    elementIndex: 2,
    resolvedType: "button",
    resolvedVariant: '"primary"',
    attributes: {
      variant: '"primary"',
      onClick: "{() => void handleExport()}",
      className: '"rounded-md px-3 py-1.5 text-sm"',
    },
  },
  {
    id: "BTN-021",
    file: "src/renderer/components/ModelSelect.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '"ghost"',
    attributes: {
      variant: '"ghost"',
      "aria-label": '{t("models.select.refetch")}',
      title: '{t("models.select.refetch")}',
      className: '"px-2 py-1 rounded"',
      onClick: "{() => fetchModels(true)}",
      disabled: "{modelsLoading}",
    },
  },
  {
    id: "BTN-022",
    file: "src/renderer/components/ModelSelect.tsx",
    elementIndex: 1,
    resolvedType: "button",
    resolvedVariant: '"ghost"',
    attributes: {
      variant: '"ghost"',
      "aria-label": '{t("models.select.resetToDefault")}',
      title: '{t("models.select.resetToDefault")}',
      className: '"px-2 py-1 rounded"',
      onClick:
        '{async () => { if (window.electronAPI?.setFeatureModel) { try { await window.electronAPI.setFeatureModel(featureId, ""); setSavedFeatureModel(""); setSelectedModel(""); if (onChange) onChange(""); } catch (err) { console.error("Error resetting to default model:", err); } } }}',
      disabled: "{!savedFeatureModel}",
    },
  },
  {
    id: "BTN-023",
    file: "src/renderer/components/ModelsPanel.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '"ghost"',
    attributes: {
      variant: '"ghost"',
      onClick: "{() => setExpanded((v) => !v)}",
      className: '"mt-1 w-full rounded-md px-2 py-1.5 text-xs text-primary"',
    },
  },
  {
    id: "BTN-024",
    file: "src/renderer/components/MultiSelect/MultiSelect.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '"outline"',
    attributes: {
      ref: "{triggerRef}",
      variant: '"outline"',
      "aria-label": "{ariaLabel}",
      "aria-expanded": "{isOpen}",
      "aria-haspopup": '"true"',
      "aria-controls": "{isOpen ? listId : undefined}",
      onClick: "{() => setIsOpen((open) => !open)}",
      className:
        '{twMerge(selectControlClassName, "flex w-full items-center justify-between gap-2 px-2 py-1.5 text-sm",)}',
    },
  },
  {
    id: "BTN-025",
    file: "src/renderer/components/usage/OpenRouterUsagePanel.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '"primary"',
    attributes: {
      onClick: "{onOpenSettings}",
      className: '"rounded px-3 py-1.5 text-sm"',
    },
  },
  {
    id: "BTN-026",
    file: "src/renderer/components/usage/OpenRouterUsagePanel.tsx",
    elementIndex: 1,
    resolvedType: "button",
    resolvedVariant: '{range === r.id ? "primary" : "secondary"}',
    attributes: {
      key: "{r.id}",
      variant: '{range === r.id ? "primary" : "secondary"}',
      onClick: "{() => setRange(r.id)}",
      "aria-pressed": "{range === r.id}",
      className: '{twJoin("px-2 py-0.5 text-xs rounded-sm",)}',
    },
  },
  {
    id: "BTN-027",
    file: "src/renderer/components/usage/OpenRouterUsagePanel.tsx",
    elementIndex: 2,
    resolvedType: "button",
    resolvedVariant: '"secondary"',
    attributes: {
      variant: '"secondary"',
      onClick: "{debouncedRefresh}",
      disabled: "{loading}",
      className: '"ml-auto rounded-sm px-2 py-0.5 text-xs"',
    },
  },
  {
    id: "BTN-040",
    file: "src/renderer/components/SearchInput.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '"ghost"',
    attributes: {
      type: '"button"',
      variant: '"ghost"',
      onClick: '{() => { setInputValue(""); onSearch(""); }}',
      className:
        '"absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"',
      "aria-label": '{t("common.searchInput.clearAriaLabel")}',
    },
  },
  {
    id: "BTN-041",
    file: "src/renderer/components/SettingAppearance.tsx",
    elementIndex: 0,
    resolvedType: "button",
    resolvedVariant: '{isSelected ? "primary" : "outline"}',
    attributes: {
      key: "{preset.id}",
      type: '"button"',
      variant: '{isSelected ? "primary" : "outline"}',
      role: '"radio"',
      "aria-checked": "{isSelected}",
      "aria-label": "{preset.label}",
      disabled: "{isLoading}",
      onClick: "{() => { void handleSelect(preset.id); }}",
      style: "{{ maxWidth: THEME_CARD_MAX }}",
      className:
        '{twJoin("group mx-auto flex w-full min-w-0 flex-col rounded-lg border text-left", isSelected ? "border-ring ring-2 ring-ring ring-offset-2 ring-offset-background" : "border-card-control-border hover:border-primary/50 hover:bg-accent/40",)}',
    },
  },
] as const satisfies readonly ConsumerContract[];

const contractsByFile = Map.groupBy(consumers, ({ file }) => file);
const cardFiles = [...contractsByFile.keys()];

extend([a11yPlugin]);

describe("Card 05 Button consumer contracts", () => {
  it.each(consumers)(
    "preserves the exact native and visual contract for $id",
    ({ id, file, elementIndex, resolvedType, resolvedVariant, attributes }) => {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      const element = buttonElementsInSource(source, file)[elementIndex];
      const expectedAttributes = Object.fromEntries(
        Object.entries(attributes).map(([name, value]) => [
          name,
          typeof value === "string" ? normalizeSyntax(value) : value,
        ]),
      );

      expect(source).not.toContain("<button");
      expect(element, id).toBeDefined();
      expect(element?.attributes, id).toEqual(expectedAttributes);
      expect(element?.attributes.type ?? normalizeSyntax('"button"'), id).toBe(
        normalizeSyntax(`"${resolvedType}"`),
      );
      expect(
        element?.attributes.variant ?? normalizeSyntax('"primary"'),
        id,
      ).toBe(normalizeSyntax(resolvedVariant));
      expect(element?.attributes.type, id).not.toBe(
        normalizeSyntax('"submit"'),
      );
    },
  );

  it("accounts for every Button element in each owned file", () => {
    for (const [file, fileContracts] of contractsByFile) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(buttonElementsInSource(source, file), file).toHaveLength(
        fileContracts.length,
      );
    }
  });

  it("does not recombine fragments from different Button elements", () => {
    const elements = buttonElementsInSource(`
      <div>
        <Button variant="primary" onClick={save}>Save</Button>
        <Button variant="ghost" onClick={cancel}>Cancel</Button>
      </div>
    `);
    const splitContract = ['variant="primary"', "onClick={cancel}"].map(
      normalizeSource,
    );

    expect(
      elements.some(({ element }) =>
        splitContract.every((fragment) => element.includes(fragment)),
      ),
    ).toBe(false);
  });

  it("leaves shared focus and transition behavior owned by Button", () => {
    const sharedStateClasses = [
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
      "focus-visible:ring-offset-2",
      "focus-visible:ring-offset-background",
      "transition-colors",
      "motion-reduce:transition-none",
    ];

    for (const file of cardFiles) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const { opening } of buttonElementsInSource(source, file)) {
        for (const className of sharedStateClasses) {
          expect(opening, `${file} duplicates ${className}`).not.toContain(
            className,
          );
        }
      }
    }
  });

  it("uses the readable primary foreground for selected theme-card descendants in all 149 themes", () => {
    const generatedDir = path.join(
      process.cwd(),
      "src/renderer/themes/generated",
    );
    const presetFiles = THEME_IDS.map((themeId) => `preset-${themeId}.css`);
    const ratios: number[] = [];

    expect(THEME_IDS).toHaveLength(149);
    for (const file of presetFiles) {
      expect(existsSync(path.join(generatedDir, file)), file).toBe(true);
      const css = readFileSync(path.join(generatedDir, file), "utf8");
      const primary = css.match(/\s--primary:\s*([^;]+);/)?.[1];
      const primaryForeground = css.match(
        /\s--primary-foreground:\s*([^;]+);/,
      )?.[1];

      expect(primary, file).toBeDefined();
      expect(primaryForeground, file).toBeDefined();
      ratios.push(colord(primaryForeground).contrast(colord(primary)));
    }

    expect(ratios).toHaveLength(149);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });
});
