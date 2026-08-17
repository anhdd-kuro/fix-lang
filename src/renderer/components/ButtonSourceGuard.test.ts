import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const rendererRoot = path.join(repositoryRoot, "src/renderer");
const buttonLeafPath = "src/renderer/components/Button.tsx";
const nativeButtonTag = ["<", "button", ">"].join("");

type FindingKind =
  | "native JSX"
  | "native JSX alias"
  | "namespaced native JSX"
  | 'createElement("button")'
  | "PrimaryButton"
  | "foreign Button module";

type Finding = {
  file: string;
  line: number;
  kind: FindingKind;
  detail: string;
};

type ScanResult = {
  buttonConsumers: ButtonConsumer[];
  findings: Finding[];
  nativeLeaves: Finding[];
  sourceFiles: string[];
};

type SourceScanResult = Omit<ScanResult, "sourceFiles">;

type ButtonConsumer = {
  column: number;
  file: string;
  line: number;
  semanticId: string;
};

type ChecklistConsumer = ButtonConsumer & {
  id: string;
  stableId: string;
};

type StableSiteShape = {
  currentElement: string;
  disabledRule: string | null;
  file: string;
  forwarding: {
    aria: string[];
    ref: string | null;
    spreadProps: string[];
    title: string | null;
  };
  geometryClasses: string | null;
  handlers: { name: string; value: string }[];
  kind: string;
  sourcePreview: string;
  wrapperIdentity: string;
};

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const stableSiteFingerprint = (site: StableSiteShape): string =>
  sha256(
    JSON.stringify({
      file: site.file,
      kind: site.kind,
      currentElement: site.currentElement,
      wrapperIdentity: site.wrapperIdentity,
      handlers: site.handlers,
      disabledRule: site.disabledRule,
      forwarding: site.forwarding,
      geometryClasses: site.geometryClasses,
      sourcePreview: site.sourcePreview,
    }),
  );

const sourceFileFor = (fileName: string, source: string): ts.SourceFile =>
  ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const buttonLeafModule = buttonLeafPath.replace(/\.tsx$/, "");

const toPosixPath = (value: string): string => value.replaceAll("\\", "/");

const isRendererSourcePath = (file: string): boolean =>
  toPosixPath(file).startsWith("src/renderer/");

const hasButtonModuleName = (moduleName: string): boolean =>
  /(?:^|\/)Button(?:\.tsx?)?$/.test(toPosixPath(moduleName));

// A module merely *named* Button is not the sanctioned leaf. The scanner only ever reads
// files under src/renderer, so a Button-named module outside that root has its own source
// unread: matching it by basename alone would accept `<button {...props} />` living in, say,
// src/features/ui/shared/Button.tsx as a legitimate consumer of the design-system Button.
const resolvesToButtonLeaf = (
  moduleName: string,
  importerFile: string,
): boolean => {
  const specifier = toPosixPath(moduleName);
  // `~/*` maps to `./src/*` (tsconfig paths, applied by vite-tsconfig-paths) and is this
  // repo's canonical import form, so `~/renderer/components/Button` is the leaf itself.
  const resolved = specifier.startsWith("~/")
    ? `src/${specifier.slice("~/".length)}`
    : specifier.startsWith(".")
      ? path.posix.normalize(
          path.posix.join(
            path.posix.dirname(toPosixPath(importerFile)),
            specifier,
          ),
        )
      : null;
  return (
    resolved !== null && resolved.replace(/\.tsx?$/, "") === buttonLeafModule
  );
};

// Real renderer sources must resolve to the leaf. Synthetic fixture paths used by this
// file's unit tests are not part of the tree and cannot resolve to anything, so they keep
// the basename rule; every path the renderer scan feeds in is a real renderer source.
const isButtonModule = (moduleName: string, importerFile: string): boolean =>
  isRendererSourcePath(importerFile)
    ? resolvesToButtonLeaf(moduleName, importerFile)
    : hasButtonModuleName(moduleName);

const importsForeignButtonModule = (
  moduleName: string,
  importerFile: string,
): boolean =>
  isRendererSourcePath(importerFile) &&
  hasButtonModuleName(moduleName) &&
  !resolvesToButtonLeaf(moduleName, importerFile);

const isPrimaryButtonModule = (moduleName: string): boolean => {
  const baseName = path.posix.basename(moduleName.replaceAll("\\", "/"));
  return baseName === "PrimaryButton" || baseName.startsWith("PrimaryButton.");
};

type ImportedKind =
  | "button-component"
  | "button-namespace"
  | "create-element"
  | "primary-button-component"
  | "primary-button-namespace"
  | "react-namespace"
  | null;

type BindingSource =
  | {
      expression: ts.Expression;
      kind: "expression";
    }
  | {
      initializer: ts.Expression;
      kind: "default";
      source: BindingSource | null;
    }
  | {
      kind: "property";
      propertyName: string;
      source: BindingSource;
    }
  | {
      excludedPropertyNames: string[];
      kind: "object-rest";
      source: BindingSource;
    };

type AliasBinding = {
  assignments: {
    bindingSource: BindingSource;
    node: ts.BinaryExpression;
  }[];
  bindingSource: BindingSource | null;
  declaration: ts.Node;
  importedKind: ImportedKind;
};

type AliasScope = {
  bindings: Map<string, AliasBinding>;
  isFunctionScope: boolean;
  parent: AliasScope | null;
};

const isFunctionScopeNode = (node: ts.Node): node is ts.SignatureDeclaration =>
  ts.isFunctionLike(node);

const isLoopScopeNode = (
  node: ts.Node,
): node is ts.ForStatement | ts.ForInStatement | ts.ForOfStatement =>
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node);

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

const buildLexicalAliasResolver = (
  sourceFile: ts.SourceFile,
): {
  resolvesToButton: (
    expression: ts.JsxTagNameExpression,
    atNode: ts.Node,
  ) => boolean;
  resolvesToCreateElement: (
    expression: ts.LeftHandSideExpression,
    atNode: ts.Node,
  ) => boolean;
  resolvesToNativeProperty: (
    expression: ts.JsxTagNameExpression,
    atNode: ts.Node,
  ) => boolean;
  resolvesToNativeExpression: (
    expression: ts.Expression,
    atNode: ts.Node,
  ) => boolean;
  resolvesToNativeTag: (name: string, atNode: ts.Node) => boolean;
  resolvesToPrimaryButton: (
    expression: ts.JsxTagNameExpression,
    atNode: ts.Node,
  ) => boolean;
} => {
  const rootScope: AliasScope = {
    bindings: new Map(),
    isFunctionScope: true,
    parent: null,
  };
  const scopeByNode = new WeakMap<ts.Node, AliasScope>();

  const staticPropertyName = (name: ts.PropertyName): string | null => {
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name) ||
      ts.isNoSubstitutionTemplateLiteral(name)
    ) {
      return name.text;
    }
    if (ts.isComputedPropertyName(name)) {
      const expression = unwrapExpression(name.expression);
      return ts.isStringLiteral(expression) ||
        ts.isNumericLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression)
        ? expression.text
        : null;
    }
    return null;
  };

  const addBinding = (
    scope: AliasScope,
    name: string,
    declaration: ts.Node,
    bindingSource: BindingSource | null = null,
    importedKind: ImportedKind = null,
    preserveExisting = false,
  ): void => {
    if (preserveExisting && scope.bindings.has(name)) {
      return;
    }
    scope.bindings.set(name, {
      assignments: [],
      bindingSource,
      declaration,
      importedKind,
    });
  };

  const addBindingName = (
    scope: AliasScope,
    name: ts.BindingName,
    declaration: ts.Node,
    bindingSource: BindingSource | null = null,
    preserveExisting = false,
  ): void => {
    if (ts.isIdentifier(name)) {
      addBinding(
        scope,
        name.text,
        declaration,
        bindingSource,
        null,
        preserveExisting,
      );
      return;
    }
    const excludedPropertyNames: string[] = [];
    for (const [index, element] of name.elements.entries()) {
      if (ts.isBindingElement(element)) {
        const propertyNameNode =
          element.propertyName ??
          (ts.isIdentifier(element.name) ? element.name : null);
        const propertyName = ts.isArrayBindingPattern(name)
          ? String(index)
          : propertyNameNode
            ? staticPropertyName(propertyNameNode)
            : null;
        const propertySource =
          bindingSource &&
          element.dotDotDotToken &&
          ts.isObjectBindingPattern(name)
            ? {
                excludedPropertyNames: [...excludedPropertyNames],
                kind: "object-rest" as const,
                source: bindingSource,
              }
            : bindingSource && propertyName !== null
              ? {
                  kind: "property" as const,
                  propertyName,
                  source: bindingSource,
                }
              : null;
        if (!element.dotDotDotToken && propertyName !== null) {
          excludedPropertyNames.push(propertyName);
        }
        addBindingName(
          scope,
          element.name,
          element,
          element.initializer
            ? {
                initializer: element.initializer,
                kind: "default",
                source: propertySource,
              }
            : propertySource,
          preserveExisting,
        );
      }
    }
  };

  const nearestFunctionScope = (scope: AliasScope): AliasScope => {
    let currentScope: AliasScope | null = scope;
    while (currentScope && !currentScope.isFunctionScope) {
      currentScope = currentScope.parent;
    }
    return currentScope ?? rootScope;
  };

  const isVarDeclaration = (node: ts.VariableDeclaration): boolean =>
    ts.isVariableDeclarationList(node.parent) &&
    (node.parent.flags & ts.NodeFlags.BlockScoped) === 0;

  const collectBindings = (node: ts.Node, inheritedScope: AliasScope): void => {
    if (
      (ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name
    ) {
      addBinding(inheritedScope, node.name.text, node);
    }

    let currentScope = inheritedScope;
    if (
      node !== sourceFile &&
      (isFunctionScopeNode(node) ||
        ts.isClassExpression(node) ||
        ts.isBlock(node) ||
        ts.isCatchClause(node) ||
        isLoopScopeNode(node) ||
        ts.isSwitchStatement(node))
    ) {
      currentScope = {
        bindings: new Map(),
        isFunctionScope: isFunctionScopeNode(node),
        parent: inheritedScope,
      };
    }
    scopeByNode.set(node, currentScope);

    if (ts.isClassExpression(node) && node.name) {
      addBinding(currentScope, node.name.text, node.name);
    }

    if (ts.isImportDeclaration(node) && node.importClause) {
      const moduleName = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : "";
      const { importClause } = node;
      if (importClause.name) {
        addBinding(
          currentScope,
          importClause.name.text,
          importClause.name,
          null,
          moduleName === "react"
            ? "react-namespace"
            : isButtonModule(moduleName, sourceFile.fileName)
              ? "button-component"
              : isPrimaryButtonModule(moduleName)
                ? "primary-button-component"
                : null,
        );
      }
      const bindings = importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        addBinding(
          currentScope,
          bindings.name.text,
          bindings.name,
          null,
          moduleName === "react"
            ? "react-namespace"
            : isButtonModule(moduleName, sourceFile.fileName)
              ? "button-namespace"
              : isPrimaryButtonModule(moduleName)
                ? "primary-button-namespace"
                : null,
        );
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          addBinding(
            currentScope,
            element.name.text,
            element,
            null,
            moduleName === "react" && importedName === "createElement"
              ? "create-element"
              : isButtonModule(moduleName, sourceFile.fileName) &&
                  importedName === "Button"
                ? "button-component"
                : isPrimaryButtonModule(moduleName) &&
                    importedName === "PrimaryButton"
                  ? "primary-button-component"
                  : null,
          );
        }
      }
    }

    if (isFunctionScopeNode(node)) {
      if (ts.isFunctionExpression(node) && node.name) {
        addBinding(currentScope, node.name.text, node.name);
      }
      for (const parameter of node.parameters) {
        addBindingName(
          currentScope,
          parameter.name,
          parameter,
          parameter.initializer
            ? {
                initializer: parameter.initializer,
                kind: "default",
                source: null,
              }
            : null,
        );
      }
    }

    if (ts.isVariableDeclaration(node)) {
      const varDeclaration = isVarDeclaration(node);
      addBindingName(
        varDeclaration ? nearestFunctionScope(currentScope) : currentScope,
        node.name,
        node,
        node.initializer
          ? { expression: node.initializer, kind: "expression" }
          : null,
        varDeclaration && !node.initializer,
      );
    }

    if (ts.isCatchClause(node) && node.variableDeclaration) {
      addBindingName(
        currentScope,
        node.variableDeclaration.name,
        node.variableDeclaration,
      );
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const assignmentTarget = unwrapExpression(node.left);
      if (ts.isIdentifier(assignmentTarget)) {
        let targetScope: AliasScope | null = currentScope;
        while (targetScope) {
          const binding = targetScope.bindings.get(assignmentTarget.text);
          if (binding) {
            binding.assignments.push({
              bindingSource: {
                expression: node.right,
                kind: "expression",
              },
              node,
            });
            break;
          }
          targetScope = targetScope.parent;
        }
      }
    }

    ts.forEachChild(node, (child) => collectBindings(child, currentScope));
  };
  collectBindings(sourceFile, rootScope);

  const bindingAt = (name: string, atNode: ts.Node): AliasBinding | null => {
    let scope: AliasScope | null = scopeByNode.get(atNode) ?? rootScope;
    while (scope) {
      const binding = scope.bindings.get(name);
      if (binding) {
        return binding;
      }
      scope = scope.parent;
    }
    return null;
  };

  const bindingStateAt = (
    binding: AliasBinding,
    atNode: ts.Node,
  ): {
    bindingSource: BindingSource | null;
    evaluationNode: ts.Node;
    importedKind: ImportedKind;
  } => {
    const readPosition = atNode.getStart(sourceFile);
    let bindingSource = binding.bindingSource;
    let evaluationNode = binding.declaration;
    let importedKind = binding.importedKind;
    for (const assignment of binding.assignments) {
      if (assignment.node.getStart(sourceFile) >= readPosition) {
        continue;
      }
      bindingSource = assignment.bindingSource;
      evaluationNode = assignment.node;
      importedKind = null;
    }
    return { bindingSource, evaluationNode, importedKind };
  };

  function resolvesIdentifierToKind(
    name: string,
    atNode: ts.Node,
    importedKind: Exclude<ImportedKind, null>,
    visited = new Set<ts.Node>(),
  ): boolean {
    const binding = bindingAt(name, atNode);
    if (!binding || visited.has(binding.declaration)) {
      return false;
    }
    const bindingState = bindingStateAt(binding, atNode);
    if (bindingState.importedKind === importedKind) {
      return true;
    }
    visited.add(binding.declaration);
    return Boolean(
      bindingState.bindingSource &&
      resolvesBindingSourceToKind(
        bindingState.bindingSource,
        bindingState.evaluationNode,
        importedKind,
        visited,
      ),
    );
  }

  const namespaceKindFor = (
    importedKind: Exclude<ImportedKind, null>,
    propertyName: string,
  ): Exclude<ImportedKind, null> | null => {
    if (importedKind === "button-component" && propertyName === "Button") {
      return "button-namespace";
    }
    if (
      importedKind === "primary-button-component" &&
      propertyName === "PrimaryButton"
    ) {
      return "primary-button-namespace";
    }
    if (importedKind === "create-element" && propertyName === "createElement") {
      return "react-namespace";
    }
    return null;
  };

  const staticPropertyAccess = (
    expression: ts.Expression,
  ): { propertyName: string; source: ts.Expression } | null => {
    const unwrappedExpression = unwrapExpression(expression);
    if (ts.isPropertyAccessExpression(unwrappedExpression)) {
      return {
        propertyName: unwrappedExpression.name.text,
        source: unwrappedExpression.expression,
      };
    }
    if (ts.isElementAccessExpression(unwrappedExpression)) {
      const argument = unwrappedExpression.argumentExpression
        ? unwrapExpression(unwrappedExpression.argumentExpression)
        : null;
      if (
        argument &&
        (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument))
      ) {
        return {
          propertyName: argument.text,
          source: unwrappedExpression.expression,
        };
      }
    }
    return null;
  };

  function resolvesExpressionToKind(
    expression: ts.Expression,
    atNode: ts.Node,
    importedKind: Exclude<ImportedKind, null>,
    visited: Set<ts.Node>,
  ): boolean {
    const unwrappedExpression = unwrapExpression(expression);
    if (ts.isIdentifier(unwrappedExpression)) {
      return resolvesIdentifierToKind(
        unwrappedExpression.text,
        atNode,
        importedKind,
        visited,
      );
    }
    const propertyAccess = staticPropertyAccess(unwrappedExpression);
    if (!propertyAccess) {
      return false;
    }
    const namespaceKind = namespaceKindFor(
      importedKind,
      propertyAccess.propertyName,
    );
    if (
      namespaceKind &&
      resolvesExpressionToKind(
        propertyAccess.source,
        propertyAccess.source,
        namespaceKind,
        new Set(visited),
      )
    ) {
      return true;
    }
    const propertyValue = resolveExpressionPropertyToBindingValue(
      propertyAccess.source,
      propertyAccess.propertyName,
      atNode,
      new Set(visited),
    );
    return Boolean(
      propertyValue &&
      resolvesExpressionToKind(
        propertyValue,
        propertyValue,
        importedKind,
        visited,
      ),
    );
  }

  function resolvesBindingSourceToKind(
    bindingSource: BindingSource,
    atNode: ts.Node,
    importedKind: Exclude<ImportedKind, null>,
    visited: Set<ts.Node>,
  ): boolean {
    if (bindingSource.kind === "expression") {
      return resolvesExpressionToKind(
        bindingSource.expression,
        atNode,
        importedKind,
        visited,
      );
    }
    if (bindingSource.kind === "default") {
      const sourceExpression = resolveBindingSourceToExpression(
        bindingSource,
        atNode,
        new Set(visited),
      );
      return Boolean(
        sourceExpression &&
        resolvesExpressionToKind(
          sourceExpression,
          sourceExpression,
          importedKind,
          visited,
        ),
      );
    }
    if (bindingSource.kind === "object-rest") {
      return false;
    }
    const namespaceKind = namespaceKindFor(
      importedKind,
      bindingSource.propertyName,
    );
    if (
      namespaceKind &&
      resolvesBindingSourceToKind(
        bindingSource.source,
        atNode,
        namespaceKind,
        new Set(visited),
      )
    ) {
      return true;
    }
    const sourceExpression = resolveBindingSourceToExpression(
      bindingSource,
      atNode,
      new Set(visited),
    );
    return Boolean(
      sourceExpression &&
      resolvesExpressionToKind(
        sourceExpression,
        sourceExpression,
        importedKind,
        visited,
      ),
    );
  }

  function propertyValueExpression(
    expression: ts.Expression,
    propertyName: string,
    atNode: ts.Node,
    visited: Set<ts.Node>,
  ): ts.Expression | null {
    const unwrappedExpression = unwrapExpression(expression);
    if (ts.isObjectLiteralExpression(unwrappedExpression)) {
      for (const candidate of [...unwrappedExpression.properties].reverse()) {
        if (
          (ts.isPropertyAssignment(candidate) ||
            ts.isShorthandPropertyAssignment(candidate)) &&
          staticPropertyName(candidate.name) === propertyName
        ) {
          return ts.isPropertyAssignment(candidate)
            ? candidate.initializer
            : candidate.name;
        }
        if (ts.isSpreadAssignment(candidate)) {
          const spreadValue = resolveExpressionPropertyToBindingValue(
            candidate.expression,
            propertyName,
            atNode,
            new Set(visited),
          );
          if (spreadValue) {
            return spreadValue;
          }
        }
      }
      return null;
    }
    if (ts.isArrayLiteralExpression(unwrappedExpression)) {
      const index = Number(propertyName);
      if (!Number.isInteger(index) || index < 0) {
        return null;
      }
      const element = unwrappedExpression.elements[index];
      return element &&
        !ts.isOmittedExpression(element) &&
        !ts.isSpreadElement(element)
        ? element
        : null;
    }
    return null;
  }

  function resolveExpressionToBindingValue(
    expression: ts.Expression,
    atNode: ts.Node,
    visited: Set<ts.Node>,
  ): ts.Expression | null {
    const unwrappedExpression = unwrapExpression(expression);
    const propertyAccess = staticPropertyAccess(unwrappedExpression);
    if (propertyAccess) {
      return (
        resolveExpressionPropertyToBindingValue(
          propertyAccess.source,
          propertyAccess.propertyName,
          atNode,
          visited,
        ) ?? unwrappedExpression
      );
    }
    if (!ts.isIdentifier(unwrappedExpression)) {
      return unwrappedExpression;
    }
    const binding = bindingAt(unwrappedExpression.text, atNode);
    if (!binding) {
      return unwrappedExpression;
    }
    const bindingState = bindingStateAt(binding, atNode);
    if (bindingState.importedKind || visited.has(binding.declaration)) {
      return bindingState.importedKind ? unwrappedExpression : null;
    }
    if (!bindingState.bindingSource) {
      return null;
    }
    visited.add(binding.declaration);
    return resolveBindingSourceToExpression(
      bindingState.bindingSource,
      bindingState.evaluationNode,
      visited,
    );
  }

  function resolveExpressionPropertyToBindingValue(
    expression: ts.Expression,
    propertyName: string,
    atNode: ts.Node,
    visited: Set<ts.Node>,
  ): ts.Expression | null {
    const unwrappedExpression = unwrapExpression(expression);
    if (ts.isIdentifier(unwrappedExpression)) {
      const binding = bindingAt(unwrappedExpression.text, atNode);
      const bindingState = binding ? bindingStateAt(binding, atNode) : null;
      if (
        binding &&
        bindingState &&
        !bindingState.importedKind &&
        bindingState.bindingSource &&
        !visited.has(binding.declaration)
      ) {
        visited.add(binding.declaration);
        return resolveBindingSourcePropertyToExpression(
          bindingState.bindingSource,
          propertyName,
          bindingState.evaluationNode,
          visited,
        );
      }
    }
    const containingExpression = resolveExpressionToBindingValue(
      unwrappedExpression,
      atNode,
      visited,
    );
    if (!containingExpression) {
      return null;
    }
    const propertyValue = propertyValueExpression(
      containingExpression,
      propertyName,
      atNode,
      visited,
    );
    return propertyValue
      ? resolveExpressionToBindingValue(propertyValue, propertyValue, visited)
      : null;
  }

  function resolveBindingSourcePropertyToExpression(
    bindingSource: BindingSource,
    propertyName: string,
    atNode: ts.Node,
    visited: Set<ts.Node>,
  ): ts.Expression | null {
    if (bindingSource.kind === "object-rest") {
      if (bindingSource.excludedPropertyNames.includes(propertyName)) {
        return null;
      }
      return resolveBindingSourcePropertyToExpression(
        bindingSource.source,
        propertyName,
        atNode,
        visited,
      );
    }
    const containingExpression = resolveBindingSourceToExpression(
      bindingSource,
      atNode,
      visited,
    );
    if (!containingExpression) {
      return null;
    }
    const propertyValue = propertyValueExpression(
      containingExpression,
      propertyName,
      atNode,
      visited,
    );
    return propertyValue
      ? resolveExpressionToBindingValue(propertyValue, propertyValue, visited)
      : null;
  }

  const isExplicitUndefinedExpression = (
    expression: ts.Expression,
    atNode: ts.Node,
  ): boolean => {
    const unwrappedExpression = unwrapExpression(expression);
    return (
      ts.isVoidExpression(unwrappedExpression) ||
      (ts.isIdentifier(unwrappedExpression) &&
        unwrappedExpression.text === "undefined" &&
        bindingAt(unwrappedExpression.text, atNode) === null)
    );
  };

  function resolveBindingSourceToExpression(
    bindingSource: BindingSource,
    atNode: ts.Node,
    visited: Set<ts.Node>,
  ): ts.Expression | null {
    if (bindingSource.kind === "expression") {
      return resolveExpressionToBindingValue(
        bindingSource.expression,
        atNode,
        visited,
      );
    }
    if (bindingSource.kind === "default") {
      const sourceExpression = bindingSource.source
        ? resolveBindingSourceToExpression(
            bindingSource.source,
            atNode,
            new Set(visited),
          )
        : null;
      return !sourceExpression ||
        isExplicitUndefinedExpression(sourceExpression, sourceExpression)
        ? resolveExpressionToBindingValue(
            bindingSource.initializer,
            bindingSource.initializer,
            visited,
          )
        : sourceExpression;
    }
    if (bindingSource.kind === "object-rest") {
      return resolveBindingSourceToExpression(
        bindingSource.source,
        atNode,
        visited,
      );
    }
    return resolveBindingSourcePropertyToExpression(
      bindingSource.source,
      bindingSource.propertyName,
      atNode,
      visited,
    );
  }

  function resolvesBindingSourceToNativeTag(
    bindingSource: BindingSource,
    atNode: ts.Node,
    visited: Set<ts.Node>,
  ): boolean {
    const sourceExpression = resolveBindingSourceToExpression(
      bindingSource,
      atNode,
      visited,
    );
    return Boolean(
      sourceExpression &&
      resolvesToNativeExpression(sourceExpression, sourceExpression, visited),
    );
  }

  function resolvesToNativeTag(
    name: string,
    atNode: ts.Node,
    visited = new Set<ts.Node>(),
  ): boolean {
    const binding = bindingAt(name, atNode);
    if (!binding || visited.has(binding.declaration)) {
      return false;
    }
    const bindingState = bindingStateAt(binding, atNode);
    visited.add(binding.declaration);
    return Boolean(
      bindingState.bindingSource &&
      resolvesBindingSourceToNativeTag(
        bindingState.bindingSource,
        bindingState.evaluationNode,
        visited,
      ),
    );
  }

  function resolvesObjectPropertyToNativeTag(
    expression: ts.Expression,
    propertyName: string,
    atNode: ts.Node,
    visited = new Set<ts.Node>(),
  ): boolean {
    return resolvesBindingSourceToNativeTag(
      {
        kind: "property",
        propertyName,
        source: { expression, kind: "expression" },
      },
      atNode,
      visited,
    );
  }

  const resolvesToReactNamespace = (
    name: string,
    atNode: ts.Node,
    visited = new Set<ts.Node>(),
  ): boolean => {
    const binding = bindingAt(name, atNode);
    if (!binding) {
      return name === "React";
    }
    if (visited.has(binding.declaration)) {
      return false;
    }
    const bindingState = bindingStateAt(binding, atNode);
    if (bindingState.importedKind === "react-namespace") {
      return true;
    }
    visited.add(binding.declaration);
    const sourceExpression = bindingState.bindingSource
      ? resolveBindingSourceToExpression(
          bindingState.bindingSource,
          bindingState.evaluationNode,
          visited,
        )
      : null;
    return Boolean(
      sourceExpression &&
      ts.isIdentifier(sourceExpression) &&
      resolvesToReactNamespace(
        sourceExpression.text,
        sourceExpression,
        visited,
      ),
    );
  };

  function resolvesBindingSourceToCreateElement(
    bindingSource: BindingSource,
    atNode: ts.Node,
    visited: Set<ts.Node>,
  ): boolean {
    if (bindingSource.kind === "expression") {
      return resolvesToCreateElement(
        bindingSource.expression,
        bindingSource.expression,
        visited,
      );
    }
    if (bindingSource.kind === "default") {
      return (
        Boolean(
          bindingSource.source &&
          resolvesBindingSourceToCreateElement(
            bindingSource.source,
            atNode,
            new Set(visited),
          ),
        ) ||
        resolvesToCreateElement(
          bindingSource.initializer,
          bindingSource.initializer,
          visited,
        )
      );
    }
    if (bindingSource.kind === "object-rest") {
      return false;
    }
    if (bindingSource.propertyName === "createElement") {
      const namespaceExpression = resolveBindingSourceToExpression(
        bindingSource.source,
        atNode,
        new Set(visited),
      );
      if (
        namespaceExpression &&
        ts.isIdentifier(namespaceExpression) &&
        resolvesToReactNamespace(
          namespaceExpression.text,
          namespaceExpression,
          new Set(visited),
        )
      ) {
        return true;
      }
    }
    const sourceExpression = resolveBindingSourceToExpression(
      bindingSource,
      atNode,
      new Set(visited),
    );
    return Boolean(
      sourceExpression &&
      resolvesToCreateElement(sourceExpression, sourceExpression, visited),
    );
  }

  function resolvesToCreateElement(
    expression: ts.Expression,
    atNode: ts.Node,
    visited = new Set<ts.Node>(),
  ): boolean {
    const unwrappedExpression = unwrapExpression(expression);
    if (ts.isIdentifier(unwrappedExpression)) {
      const binding = bindingAt(unwrappedExpression.text, atNode);
      if (!binding) {
        return unwrappedExpression.text === "createElement";
      }
      if (visited.has(binding.declaration)) {
        return false;
      }
      const bindingState = bindingStateAt(binding, atNode);
      if (bindingState.importedKind === "create-element") {
        return true;
      }
      visited.add(binding.declaration);
      return Boolean(
        bindingState.bindingSource &&
        resolvesBindingSourceToCreateElement(
          bindingState.bindingSource,
          bindingState.evaluationNode,
          visited,
        ),
      );
    }
    if (
      ts.isPropertyAccessExpression(unwrappedExpression) &&
      unwrappedExpression.name.text === "createElement"
    ) {
      const namespace = unwrapExpression(unwrappedExpression.expression);
      if (
        ts.isIdentifier(namespace) &&
        resolvesToReactNamespace(namespace.text, atNode, visited)
      ) {
        return true;
      }
    }
    if (ts.isElementAccessExpression(unwrappedExpression)) {
      const namespace = unwrapExpression(unwrappedExpression.expression);
      const property = unwrappedExpression.argumentExpression
        ? unwrapExpression(unwrappedExpression.argumentExpression)
        : null;
      if (
        ts.isIdentifier(namespace) &&
        property &&
        ts.isStringLiteral(property) &&
        property.text === "createElement" &&
        resolvesToReactNamespace(namespace.text, atNode, visited)
      ) {
        return true;
      }
    }
    const propertyAccess = staticPropertyAccess(unwrappedExpression);
    if (propertyAccess) {
      const propertyValue = resolveExpressionPropertyToBindingValue(
        propertyAccess.source,
        propertyAccess.propertyName,
        atNode,
        new Set(visited),
      );
      return Boolean(
        propertyValue &&
        resolvesToCreateElement(propertyValue, propertyValue, visited),
      );
    }
    return false;
  }

  function resolvesToNativeExpression(
    expression: ts.Expression,
    atNode: ts.Node,
    visited = new Set<ts.Node>(),
  ): boolean {
    const unwrappedExpression = unwrapExpression(expression);
    if (ts.isStringLiteralLike(unwrappedExpression)) {
      return unwrappedExpression.text === "button";
    }
    if (ts.isIdentifier(unwrappedExpression)) {
      return resolvesToNativeTag(
        unwrappedExpression.text,
        unwrappedExpression,
        visited,
      );
    }
    if (ts.isPropertyAccessExpression(unwrappedExpression)) {
      return resolvesObjectPropertyToNativeTag(
        unwrappedExpression.expression,
        unwrappedExpression.name.text,
        atNode,
      );
    }
    if (ts.isElementAccessExpression(unwrappedExpression)) {
      const argument = unwrappedExpression.argumentExpression
        ? unwrapExpression(unwrappedExpression.argumentExpression)
        : null;
      return Boolean(
        argument &&
        (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) &&
        resolvesObjectPropertyToNativeTag(
          unwrappedExpression.expression,
          argument.text,
          atNode,
          visited,
        ),
      );
    }
    return false;
  }

  const resolvesComponent = (
    expression: ts.JsxTagNameExpression,
    atNode: ts.Node,
    componentKind: "button-component" | "primary-button-component",
  ): boolean => {
    if (
      !ts.isIdentifier(expression) &&
      !ts.isPropertyAccessExpression(expression)
    ) {
      return false;
    }
    return resolvesExpressionToKind(
      expression,
      atNode,
      componentKind,
      new Set(),
    );
  };

  return {
    resolvesToButton: (expression, atNode) =>
      resolvesComponent(expression, atNode, "button-component"),
    resolvesToCreateElement,
    resolvesToNativeProperty: (expression, atNode) =>
      ts.isPropertyAccessExpression(expression) &&
      resolvesObjectPropertyToNativeTag(
        expression.expression,
        expression.name.text,
        atNode,
      ),
    resolvesToNativeExpression,
    resolvesToNativeTag,
    resolvesToPrimaryButton: (expression, atNode) =>
      resolvesComponent(expression, atNode, "primary-button-component"),
  };
};

const normalizedSourceText = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): string => node.getText(sourceFile).replace(/\s+/g, " ").trim();

const componentIdentity = (node: ts.Node): string => {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      (ts.isArrowFunction(current.initializer) ||
        ts.isFunctionExpression(current.initializer))
    ) {
      return current.name.text;
    }
    current = current.parent;
  }
  return "(module)";
};

const attributeValue = (
  sourceFile: ts.SourceFile,
  attribute: ts.JsxAttribute,
): string => {
  if (!attribute.initializer) {
    return "true";
  }
  if (ts.isStringLiteral(attribute.initializer)) {
    return JSON.stringify(attribute.initializer.text);
  }
  if (!ts.isJsxExpression(attribute.initializer)) {
    return normalizedSourceText(sourceFile, attribute.initializer);
  }
  const expression = attribute.initializer.expression;
  if (expression && ts.isStringLiteral(expression)) {
    return JSON.stringify(expression.text);
  }
  return normalizedSourceText(sourceFile, attribute.initializer);
};

const semanticIdentityFor = (
  sourceFile: ts.SourceFile,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  file: string,
): string => {
  const attributes = opening.attributes.properties.map((property) =>
    ts.isJsxSpreadAttribute(property)
      ? {
          kind: "spread",
          value: normalizedSourceText(sourceFile, property.expression),
        }
      : {
          kind: "attribute",
          name: property.name.getText(sourceFile),
          value: attributeValue(sourceFile, property),
        },
  );
  const namedAttributes = opening.attributes.properties.filter(
    ts.isJsxAttribute,
  );
  const findAttribute = (name: string): ts.JsxAttribute | undefined =>
    namedAttributes.find(
      (attribute) => attribute.name.getText(sourceFile) === name,
    );
  const readAttribute = (name: string): string | null => {
    const attribute = findAttribute(name);
    return attribute ? attributeValue(sourceFile, attribute) : null;
  };
  const handlers = namedAttributes
    .filter((attribute) => /^on[A-Z]/.test(attribute.name.getText(sourceFile)))
    .map((attribute) => ({
      name: attribute.name.getText(sourceFile),
      value: attributeValue(sourceFile, attribute),
    }));
  const aria = namedAttributes
    .filter((attribute) =>
      attribute.name.getText(sourceFile).startsWith("aria-"),
    )
    .map(
      (attribute) =>
        `${attribute.name.getText(sourceFile)}=${attributeValue(sourceFile, attribute)}`,
    );
  const semanticContract = {
    attributes,
    children: ts.isJsxElement(node)
      ? node.children.map((child) => normalizedSourceText(sourceFile, child))
      : [],
    resolvedType: readAttribute("type") ?? '"button"',
    resolvedVariant: readAttribute("variant") ?? '"primary"',
  };

  return `LIVE-${stableSiteFingerprint({
    file,
    kind: "shared-button-jsx",
    currentElement: "Button",
    wrapperIdentity: componentIdentity(node),
    handlers,
    disabledRule: readAttribute("disabled"),
    forwarding: {
      aria,
      title: readAttribute("title"),
      ref: readAttribute("ref"),
      spreadProps: opening.attributes.properties
        .filter(ts.isJsxSpreadAttribute)
        .map((property) =>
          normalizedSourceText(sourceFile, property.expression),
        ),
    },
    geometryClasses: readAttribute("className"),
    sourcePreview: JSON.stringify(semanticContract),
  }).slice(0, 16)}`;
};

const scanSource = (file: string, source: string): SourceScanResult => {
  const sourceFile = sourceFileFor(file, source);
  const findings: Finding[] = [];
  const nativeLeaves: Finding[] = [];
  const buttonConsumers: ButtonConsumer[] = [];
  const aliasResolver = buildLexicalAliasResolver(sourceFile);

  const addFinding = (
    node: ts.Node,
    kind: FindingKind,
    detail: string,
  ): void => {
    findings.push({ file, line: lineOf(sourceFile, node), kind, detail });
  };

  const addButtonConsumer = (
    node: ts.JsxElement | ts.JsxSelfClosingElement,
    opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  ): void => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      opening.getStart(sourceFile),
    );
    buttonConsumers.push({
      column: position.character + 1,
      file,
      line: position.line + 1,
      semanticId: semanticIdentityFor(sourceFile, node, opening, file),
    });
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isPrimaryButtonModule(statement.moduleSpecifier.text)
    ) {
      addFinding(
        statement,
        "PrimaryButton",
        `export from ${statement.moduleSpecifier.text}`,
      );
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      importsForeignButtonModule(statement.moduleSpecifier.text, file)
    ) {
      addFinding(
        statement,
        "foreign Button module",
        `export from ${statement.moduleSpecifier.text}`,
      );
    }
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : "";
    if (isPrimaryButtonModule(moduleName)) {
      addFinding(statement, "PrimaryButton", `import from ${moduleName}`);
    }
    if (importsForeignButtonModule(moduleName, file)) {
      addFinding(
        statement,
        "foreign Button module",
        `import from ${moduleName}`,
      );
    }
    if (!statement.importClause) {
      continue;
    }

    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (
          (element.propertyName?.text ?? element.name.text) === "PrimaryButton"
        ) {
          addFinding(element, "PrimaryButton", "PrimaryButton import");
        }
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "PrimaryButton") {
      addFinding(node, "PrimaryButton", "PrimaryButton definition or use");
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tagName = opening.tagName;
      if (ts.isIdentifier(tagName)) {
        if (tagName.text === "button") {
          const leaf = {
            file,
            line: lineOf(sourceFile, opening),
            kind: "native JSX" as const,
            detail: nativeButtonTag,
          };
          if (file === buttonLeafPath) {
            nativeLeaves.push(leaf);
          } else {
            findings.push(leaf);
          }
        } else if (aliasResolver.resolvesToNativeTag(tagName.text, opening)) {
          addFinding(opening, "native JSX alias", `<${tagName.text}>`);
        }
      } else if (aliasResolver.resolvesToNativeProperty(tagName, opening)) {
        addFinding(
          opening,
          "namespaced native JSX",
          `<${tagName.getText(sourceFile)}>`,
        );
      }
      if (aliasResolver.resolvesToButton(tagName, opening)) {
        addButtonConsumer(node, opening);
      }
      if (aliasResolver.resolvesToPrimaryButton(tagName, opening)) {
        addFinding(
          opening,
          "PrimaryButton",
          `<${tagName.getText(sourceFile)}>`,
        );
      }
    }

    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const moduleName = ts.isStringLiteralLike(node.arguments[0])
        ? node.arguments[0].text
        : "";
      const isPrimaryButtonLoad =
        isPrimaryButtonModule(moduleName) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"));
      if (isPrimaryButtonLoad) {
        addFinding(node, "PrimaryButton", `load from ${moduleName}`);
      }

      const isCreateElement = aliasResolver.resolvesToCreateElement(
        node.expression,
        node,
      );
      const nativeArgument = aliasResolver.resolvesToNativeExpression(
        node.arguments[0],
        node.arguments[0],
      );
      if (isCreateElement && nativeArgument) {
        addFinding(node, 'createElement("button")', node.getText(sourceFile));
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { buttonConsumers, findings, nativeLeaves };
};

const listRendererSources = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listRendererSources(absolutePath);
      }
      return /\.(?:ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
    }),
  );
  return files.flat().sort((left, right) => left.localeCompare(right));
};

const scanRenderer = async (): Promise<ScanResult> => {
  const files = await listRendererSources(rendererRoot);
  const results = await Promise.all(
    files.map(async (absolutePath) => {
      const source = await readFile(absolutePath, "utf8");
      return scanSource(path.relative(repositoryRoot, absolutePath), source);
    }),
  );
  const aggregate = results.reduce<SourceScanResult>(
    (aggregate, result) => ({
      buttonConsumers: [
        ...aggregate.buttonConsumers,
        ...result.buttonConsumers,
      ],
      findings: [...aggregate.findings, ...result.findings],
      nativeLeaves: [...aggregate.nativeLeaves, ...result.nativeLeaves],
    }),
    { buttonConsumers: [], findings: [], nativeLeaves: [] },
  );

  return {
    ...aggregate,
    sourceFiles: files.map((file) => path.relative(repositoryRoot, file)),
  };
};

const consumerContractRows = [
    [
    "BTN-001",
    "SITE-377098cab4701111-01",
    "LIVE-377098cab4701111",
    "src/renderer/AskResultWindow/index.tsx",
    117,
    9,
  ],
    [
    "BTN-002",
    "SITE-08e5c95965d6039a-01",
    "LIVE-08e5c95965d6039a",
    "src/renderer/components/about/AboutPanel.tsx",
    47,
    13,
  ],
    [
    "BTN-003",
    "SITE-ef98536bd53f7615-01",
    "LIVE-ef98536bd53f7615",
    "src/renderer/components/about/UserGuidePanel.tsx",
    242,
    9,
  ],
    [
    "BTN-004",
    "SITE-52877eaef757f7ef-01",
    "LIVE-52877eaef757f7ef",
    "src/renderer/components/about/UserGuidePanel.tsx",
    319,
    11,
  ],
    [
    "BTN-005",
    "SITE-3bc4fcee3f1b9bd6-01",
    "LIVE-3bc4fcee3f1b9bd6",
    "src/renderer/components/about/UserGuidePanel.tsx",
    325,
    11,
  ],
    [
    "BTN-006",
    "SITE-d625f04039490f68-01",
    "LIVE-d625f04039490f68",
    "src/renderer/components/about/UserGuidePanel.tsx",
    340,
    17,
  ],
    [
    "BTN-007",
    "SITE-b3521eab8d34cca7-01",
    "LIVE-b3521eab8d34cca7",
    "src/renderer/components/about/UserGuidePanel.tsx",
    358,
    17,
  ],
    [
    "BTN-008",
    "SITE-d29b2d638d60e13e-01",
    "LIVE-d29b2d638d60e13e",
    "src/renderer/components/about/UserGuidePanel.tsx",
    387,
    17,
  ],
    [
    "BTN-009",
    "SITE-a8490affbbc66fbf-01",
    "LIVE-a8490affbbc66fbf",
    "src/renderer/components/CopyButton/index.tsx",
    47,
    5,
  ],
    [
    "BTN-010",
    "SITE-ffaaad62c6e612d8-01",
    "LIVE-ffaaad62c6e612d8",
    "src/renderer/components/Dialog.tsx",
    32,
    11,
  ],
    [
    "BTN-011",
    "SITE-a5b58a39e0be1f98-01",
    "LIVE-a5b58a39e0be1f98",
    "src/renderer/components/HistoryEntryItem.tsx",
    100,
    17,
  ],
    [
    "BTN-012",
    "SITE-8264f7f6bcd8085d-01",
    "LIVE-8264f7f6bcd8085d",
    "src/renderer/components/HistoryPanel.tsx",
    89,
    11,
  ],
    [
    "BTN-013",
    "SITE-8975613823778fc5-01",
    "LIVE-8975613823778fc5",
    "src/renderer/components/HistoryPanel.tsx",
    97,
    13,
  ],
    [
    "BTN-014",
    "SITE-5cbddd24a7826d4b-01",
    "LIVE-5cbddd24a7826d4b",
    "src/renderer/components/HistoryReviewModal.tsx",
    82,
    11,
  ],
    [
    "BTN-015",
    "SITE-ae28524fa5a91a81-01",
    "LIVE-ae28524fa5a91a81",
    "src/renderer/components/HistorySessionDetailsModal.tsx",
    139,
    15,
  ],
    [
    "BTN-016",
    "SITE-36b0efef55fb64e4-01",
    "LIVE-36b0efef55fb64e4",
    "src/renderer/components/HistorySessionDetailsModal.tsx",
    192,
    11,
  ],
    [
    "BTN-017",
    "SITE-5961fe9e2b8ba32a-01",
    "LIVE-5961fe9e2b8ba32a",
    "src/renderer/components/HotkeyInput.tsx",
    221,
    9,
  ],
    [
    "BTN-018",
    "SITE-97e7bb1c3ab4305f-01",
    "LIVE-97e7bb1c3ab4305f",
    "src/renderer/components/KeyBinding.tsx",
    28,
    7,
  ],
    [
    "BTN-019",
    "SITE-700a4122e599ffe1-01",
    "LIVE-700a4122e599ffe1",
    "src/renderer/components/LogsPanel.tsx",
    336,
    9,
  ],
    [
    "BTN-020",
    "SITE-501f82e78a2b09c9-01",
    "LIVE-501f82e78a2b09c9",
    "src/renderer/components/LogsPanel.tsx",
    343,
    9,
  ],
    [
    "BTN-021",
    "SITE-29f318d8be62f1d9-01",
    "LIVE-29f318d8be62f1d9",
    "src/renderer/components/LogsPanel.tsx",
    350,
    9,
  ],
    [
    "BTN-022",
    "SITE-7197db62a76969f7-01",
    "LIVE-7197db62a76969f7",
    "src/renderer/components/ModelManagerDialog.tsx",
    195,
    11,
  ],
    [
    "BTN-023",
    "SITE-67f4724e126c10d4-01",
    "LIVE-67f4724e126c10d4",
    "src/renderer/components/ModelManagerDialog.tsx",
    207,
    11,
  ],
    [
    "BTN-024",
    "SITE-04748a61b30e3ef8-01",
    "LIVE-04748a61b30e3ef8",
    "src/renderer/components/ModelManagerDialog.tsx",
    218,
    11,
  ],
    [
    "BTN-025",
    "SITE-7c4301fb38c9808d-01",
    "LIVE-7c4301fb38c9808d",
    "src/renderer/components/ModelManagerDialog.tsx",
    230,
    13,
  ],
    [
    "BTN-026",
    "SITE-fc298046a960042d-01",
    "LIVE-fc298046a960042d",
    "src/renderer/components/ModelManagerDialog.tsx",
    256,
    19,
  ],
    [
    "BTN-027",
    "SITE-c09e1d790b99f3f9-01",
    "LIVE-c09e1d790b99f3f9",
    "src/renderer/components/ModelManagerDialog.tsx",
    276,
    27,
  ],
    [
    "BTN-028",
    "SITE-e25d0c965e5599f3-01",
    "LIVE-e25d0c965e5599f3",
    "src/renderer/components/ModelManagerDialog.tsx",
    330,
    27,
  ],
    [
    "BTN-029",
    "SITE-5526ee17ec81f974-01",
    "LIVE-5526ee17ec81f974",
    "src/renderer/components/ModelManagerDialog.tsx",
    405,
    17,
  ],
    [
    "BTN-030",
    "SITE-73361c5a5c8f4108-01",
    "LIVE-73361c5a5c8f4108",
    "src/renderer/components/ModelManagerDialog.tsx",
    412,
    17,
  ],
    [
    "BTN-031",
    "SITE-0bb225c5fce87465-01",
    "LIVE-0bb225c5fce87465",
    "src/renderer/components/ModelSelect.tsx",
    425,
    9,
  ],
    [
    "BTN-032",
    "SITE-38539922a7e16c77-01",
    "LIVE-38539922a7e16c77",
    "src/renderer/components/ModelSelect.tsx",
    456,
    11,
  ],
    [
    "BTN-033",
    "SITE-edf192add08f8fcb-01",
    "LIVE-edf192add08f8fcb",
    "src/renderer/components/ModelsPanel.tsx",
    161,
    15,
  ],
    [
    "BTN-034",
    "SITE-f817bc24bfff4be1-01",
    "LIVE-264ac29656e00cd9",
    "src/renderer/components/MultiSelect/MultiSelect.tsx",
    96,
    7,
  ],
    [
    "BTN-035",
    "SITE-73a48ff1f5f9296f-01",
    "LIVE-73a48ff1f5f9296f",
    "src/renderer/components/ProfileManager.tsx",
    279,
    11,
  ],
    [
    "BTN-036",
    "SITE-e99c02ce9aba9550-01",
    "LIVE-e99c02ce9aba9550",
    "src/renderer/components/ProfileManager.tsx",
    287,
    11,
  ],
    [
    "BTN-037",
    "SITE-7c9f643148cf3085-01",
    "LIVE-7c9f643148cf3085",
    "src/renderer/components/ProfileManager.tsx",
    360,
    23,
  ],
    [
    "BTN-038",
    "SITE-0a1b7ac2d9c1f374-01",
    "LIVE-0a1b7ac2d9c1f374",
    "src/renderer/components/ProfileManager.tsx",
    368,
    21,
  ],
    [
    "BTN-039",
    "SITE-6da333e1baf89565-01",
    "LIVE-6da333e1baf89565",
    "src/renderer/components/ProfileManager.tsx",
    377,
    23,
  ],
    [
    "BTN-040",
    "SITE-34a9863fc49e6b83-01",
    "LIVE-34a9863fc49e6b83",
    "src/renderer/components/ProfileManager.tsx",
    437,
    13,
  ],
    [
    "BTN-041",
    "SITE-826dace3c3bc2a71-01",
    "LIVE-826dace3c3bc2a71",
    "src/renderer/components/ProfileManager.tsx",
    445,
    13,
  ],
    [
    "BTN-042",
    "SITE-ea57f4d3fc631133-01",
    "LIVE-ea57f4d3fc631133",
    "src/renderer/components/ProfileManager.tsx",
    481,
    13,
  ],
    [
    "BTN-043",
    "SITE-0a4e93dbd86acef1-01",
    "LIVE-0a4e93dbd86acef1",
    "src/renderer/components/ProfileManager.tsx",
    489,
    13,
  ],
    [
    "BTN-044",
    "SITE-7e4c2589c888f87d-01",
    "LIVE-7e4c2589c888f87d",
    "src/renderer/components/ProfileManager.tsx",
    525,
    13,
  ],
    [
    "BTN-045",
    "SITE-d89fe00914eba1d2-01",
    "LIVE-d89fe00914eba1d2",
    "src/renderer/components/ProfileManager.tsx",
    533,
    13,
  ],
    [
    "BTN-046",
    "SITE-d971b19360ec4666-01",
    "LIVE-d971b19360ec4666",
    "src/renderer/components/SearchInput.tsx",
    96,
    9,
  ],
    [
    "BTN-047",
    "SITE-38b41e9662ef85eb-01",
    "LIVE-38b41e9662ef85eb",
    "src/renderer/components/security/SettingSecurity.tsx",
    732,
    17,
  ],
    [
    "BTN-048",
    "SITE-b1fefcea3824a139-01",
    "LIVE-6a59bc31fcc6d246",
    "src/renderer/components/security/SettingSecurity.tsx",
    757,
    11,
  ],
    [
    "BTN-049",
    "SITE-fd75f166a3e391cd-01",
    "LIVE-0ec083a0c6614349",
    "src/renderer/components/security/SettingSecurity.tsx",
    760,
    11,
  ],
    [
    "BTN-050",
    "SITE-8afb88035a3e0cf1-01",
    "LIVE-8afb88035a3e0cf1",
    "src/renderer/components/security/SettingSecurity.tsx",
    783,
    17,
  ],
    [
    "BTN-051",
    "SITE-73eb9ca62146352c-01",
    "LIVE-73eb9ca62146352c",
    "src/renderer/components/security/SettingSecurity.tsx",
    908,
    9,
  ],
    [
    "BTN-052",
    "SITE-19310a96f693ae27-01",
    "LIVE-19310a96f693ae27",
    "src/renderer/components/SegmentedControl.tsx",
    62,
    11,
  ],
    [
    "BTN-053",
    "SITE-9568e1f27af6a345-01",
    "LIVE-9568e1f27af6a345",
    "src/renderer/components/SettingAppearance.tsx",
    211,
    17,
  ],
    [
    "BTN-054",
    "SITE-e1edc22effccf2d2-01",
    "LIVE-e1edc22effccf2d2",
    "src/renderer/components/SettingCombos.tsx",
    590,
    11,
  ],
    [
    "BTN-055",
    "SITE-0aee59564402ec3a-01",
    "LIVE-6a491ec61d9d725b",
    "src/renderer/components/SettingCombos.tsx",
    617,
    19,
  ],
    [
    "BTN-056",
    "SITE-65a1273b03b9d8fb-01",
    "LIVE-65a1273b03b9d8fb",
    "src/renderer/components/SettingCombos.tsx",
    759,
    21,
  ],
    [
    "BTN-057",
    "SITE-88523f64c949d38d-01",
    "LIVE-88523f64c949d38d",
    "src/renderer/components/SettingCombos.tsx",
    794,
    23,
  ],
    [
    "BTN-058",
    "SITE-16265e474e2f98ca-01",
    "LIVE-16265e474e2f98ca",
    "src/renderer/components/SettingCombos.tsx",
    967,
    31,
  ],
    [
    "BTN-059",
    "SITE-376a2f482e57e0e5-01",
    "LIVE-376a2f482e57e0e5",
    "src/renderer/components/SettingCombos.tsx",
    1018,
    31,
  ],
    [
    "BTN-060",
    "SITE-5c07a3dcdb7ff819-01",
    "LIVE-81d3f6b70313cfa7",
    "src/renderer/components/SettingCombos.tsx",
    1070,
    21,
  ],
    [
    "BTN-061",
    "SITE-4b84063b743490d2-01",
    "LIVE-4b84063b743490d2",
    "src/renderer/components/SettingCombos.tsx",
    1088,
    9,
  ],
    [
    "BTN-062",
    "SITE-bc36161d674c7650-01",
    "LIVE-bc36161d674c7650",
    "src/renderer/components/SettingCorrection.tsx",
    492,
    13,
  ],
    [
    "BTN-063",
    "SITE-6a514323795e6dd7-01",
    "LIVE-6a514323795e6dd7",
    "src/renderer/components/SettingCorrection.tsx",
    506,
    19,
  ],
    [
    "BTN-064",
    "SITE-31930ebb84cc797f-01",
    "LIVE-31930ebb84cc797f",
    "src/renderer/components/SettingCorrection.tsx",
    562,
    15,
  ],
    [
    "BTN-065",
    "SITE-be46cc9ab1065d84-01",
    "LIVE-be46cc9ab1065d84",
    "src/renderer/components/SettingCorrection.tsx",
    570,
    15,
  ],
    [
    "BTN-066",
    "SITE-6b4e0c40672f1a9f-01",
    "LIVE-6b4e0c40672f1a9f",
    "src/renderer/components/SettingCorrection.tsx",
    579,
    15,
  ],
    [
    "BTN-067",
    "SITE-d092e1365d74f58e-01",
    "LIVE-d092e1365d74f58e",
    "src/renderer/components/SettingCorrection.tsx",
    636,
    15,
  ],
    [
    "BTN-068",
    "SITE-526689e2a7d58f90-01",
    "LIVE-526689e2a7d58f90",
    "src/renderer/components/SettingCorrection.tsx",
    669,
    15,
  ],
    [
    "BTN-069",
    "SITE-7ddd61f39a4603c1-01",
    "LIVE-7ddd61f39a4603c1",
    "src/renderer/components/SettingCorrection.tsx",
    755,
    9,
  ],
    [
    "BTN-070",
    "SITE-07f2a8ba23e043f1-01",
    "LIVE-07f2a8ba23e043f1",
    "src/renderer/components/SettingGeneral.tsx",
    759,
    11,
  ],
    [
    "BTN-071",
    "SITE-c4546c1f1b582275-01",
    "LIVE-c4546c1f1b582275",
    "src/renderer/components/SettingGeneral.tsx",
    772,
    13,
  ],
    [
    "BTN-072",
    "SITE-f528b6225f5af211-01",
    "LIVE-f528b6225f5af211",
    "src/renderer/components/SettingGeneral.tsx",
    806,
    15,
  ],
    [
    "BTN-073",
    "SITE-d3d535844d3ea12d-01",
    "LIVE-d3d535844d3ea12d",
    "src/renderer/components/SettingGeneral.tsx",
    814,
    15,
  ],
    [
    "BTN-074",
    "SITE-9366f8ce82dfacc2-01",
    "LIVE-9366f8ce82dfacc2",
    "src/renderer/components/SettingGeneral.tsx",
    932,
    9,
  ],
    [
    "BTN-075",
    "SITE-f3c8ca23590954fc-01",
    "LIVE-f3c8ca23590954fc",
    "src/renderer/components/SettingPromptGen.tsx",
    270,
    15,
  ],
    [
    "BTN-076",
    "SITE-f3f343d2e0482049-01",
    "LIVE-f3f343d2e0482049",
    "src/renderer/components/SettingPromptGen.tsx",
    290,
    15,
  ],
    [
    "BTN-077",
    "SITE-b3f4857089946438-01",
    "LIVE-b3f4857089946438",
    "src/renderer/components/SettingPromptGen.tsx",
    365,
    9,
  ],
    [
    "BTN-078",
    "SITE-69e4e918b6516bfe-01",
    "LIVE-69e4e918b6516bfe",
    "src/renderer/components/SettingPromptGen.tsx",
    371,
    9,
  ],
    [
    "BTN-079",
    "SITE-ccaa63ee68a2a8a1-01",
    "LIVE-ccaa63ee68a2a8a1",
    "src/renderer/components/SettingsIcon.tsx",
    28,
    5,
  ],
    [
    "BTN-080",
    "SITE-426eacdcf8f96389-01",
    "LIVE-426eacdcf8f96389",
    "src/renderer/components/SettingsModal.tsx",
    316,
    11,
  ],
    [
    "BTN-081",
    "SITE-131332cadfcd6d7c-01",
    "LIVE-131332cadfcd6d7c",
    "src/renderer/components/SettingsModal.tsx",
    358,
    17,
  ],
    [
    "BTN-082",
    "SITE-c0f45b98e17a7b20-01",
    "LIVE-c0f45b98e17a7b20",
    "src/renderer/components/SettingTabBtn.tsx",
    31,
    5,
  ],
    [
    "BTN-083",
    "SITE-f63727c376cb5050-01",
    "LIVE-f63727c376cb5050",
    "src/renderer/components/SettingUpdates.tsx",
    726,
    11,
  ],
    [
    "BTN-084",
    "SITE-31d2760b23787e23-01",
    "LIVE-31d2760b23787e23",
    "src/renderer/components/SettingUpdates.tsx",
    751,
    11,
  ],
    [
    "BTN-085",
    "SITE-91ba4b4f640490e2-01",
    "LIVE-91ba4b4f640490e2",
    "src/renderer/components/SettingUpdates.tsx",
    779,
    13,
  ],
    [
    "BTN-086",
    "SITE-663c55705a5cc3f0-01",
    "LIVE-663c55705a5cc3f0",
    "src/renderer/components/SettingUpdates.tsx",
    799,
    15,
  ],
    [
    "BTN-087",
    "SITE-43414753ace2ab81-01",
    "LIVE-da3e264ff5bff86c",
    "src/renderer/components/SettingUpdates.tsx",
    858,
    15,
  ],
    [
    "BTN-088",
    "SITE-ad68949b3a58f46b-01",
    "LIVE-ad68949b3a58f46b",
    "src/renderer/components/SettingUpdates.tsx",
    879,
    15,
  ],
    [
    "BTN-089",
    "SITE-c11f9621b2e3d72c-01",
    "LIVE-c11f9621b2e3d72c",
    "src/renderer/components/SettingUpdates.tsx",
    894,
    15,
  ],
    [
    "BTN-090",
    "SITE-f4ccea28d324b33f-01",
    "LIVE-f4ccea28d324b33f",
    "src/renderer/components/SettingUpdates.tsx",
    907,
    13,
  ],
    [
    "BTN-091",
    "SITE-fbcd67d29270d287-01",
    "LIVE-fbcd67d29270d287",
    "src/renderer/components/SettingUpdates.tsx",
    923,
    13,
  ],
    [
    "BTN-092",
    "SITE-bfa98039be039f30-01",
    "LIVE-bfa98039be039f30",
    "src/renderer/components/SettingUpdates.tsx",
    1019,
    13,
  ],
    [
    "BTN-093",
    "SITE-5815552ee2096fa5-01",
    "LIVE-5815552ee2096fa5",
    "src/renderer/components/SettingUpdates.tsx",
    1048,
    13,
  ],
    [
    "BTN-094",
    "SITE-8d81c1044d88aa9b-01",
    "LIVE-8d81c1044d88aa9b",
    "src/renderer/components/SettingUpdates.tsx",
    1060,
    13,
  ],
    [
    "BTN-095",
    "SITE-cfd38745f41c80f2-01",
    "LIVE-0d366a2b4a3aa757",
    "src/renderer/components/SettingUpdates.tsx",
    1271,
    15,
  ],
    [
    "BTN-096",
    "SITE-2b5e02b82b63d6af-01",
    "LIVE-1a247b82dcc22868",
    "src/renderer/components/SettingUpdates.tsx",
    1292,
    15,
  ],
    [
    "BTN-097",
    "SITE-e1569fb1897b6372-01",
    "LIVE-a3ccf02b8ad14fce",
    "src/renderer/components/SettingUpdates.tsx",
    1311,
    15,
  ],
    [
    "BTN-098",
    "SITE-d2dc6b542709b453-01",
    "LIVE-d2dc6b542709b453",
    "src/renderer/components/TrashButton.tsx",
    23,
    5,
  ],
    [
    "BTN-099",
    "SITE-57f775bd4fae66ec-01",
    "LIVE-57f775bd4fae66ec",
    "src/renderer/components/usage/OpenAIUsagePanel.tsx",
    154,
    11,
  ],
    [
    "BTN-100",
    "SITE-faf927e806407b15-01",
    "LIVE-faf927e806407b15",
    "src/renderer/components/usage/OpenAIUsagePanel.tsx",
    191,
    9,
  ],
    [
    "BTN-101",
    "SITE-3c1c72456ff99197-01",
    "LIVE-3c1c72456ff99197",
    "src/renderer/components/usage/OpenRouterUsagePanel.tsx",
    113,
    11,
  ],
    [
    "BTN-102",
    "SITE-aff47f3a90bf9c5b-01",
    "LIVE-aff47f3a90bf9c5b",
    "src/renderer/components/usage/OpenRouterUsagePanel.tsx",
    150,
    9,
  ],
    [
    "BTN-103",
    "SITE-4375aafcfe900c3b-01",
    "LIVE-4375aafcfe900c3b",
    "src/renderer/components/usage/UsagePanel.tsx",
    117,
    13,
  ],
    [
    "BTN-104",
    "SITE-cda3ee060bf9b96d-01",
    "LIVE-cda3ee060bf9b96d",
    "src/renderer/components/usage/UsagePanel.tsx",
    162,
    15,
  ],
    [
    "BTN-105",
    "SITE-22b46580f1bd13d0-01",
    "LIVE-22b46580f1bd13d0",
    "src/renderer/CorrectionResultWindow/index.tsx",
    63,
    9,
  ],
    [
    "BTN-106",
    "SITE-212540f76558cdfa-01",
    "LIVE-212540f76558cdfa",
    "src/renderer/MainWindow/App.tsx",
    350,
    15,
  ],
    [
    "BTN-107",
    "SITE-3fc2016e431469db-01",
    "LIVE-3fc2016e431469db",
    "src/renderer/TrayWindow/components/TrayProviderSummary.tsx",
    203,
    17,
  ],
    [
    "BTN-108",
    "SITE-5889a078aeafb4c2-01",
    "LIVE-5889a078aeafb4c2",
    "src/renderer/TrayWindow/components/TrayProviderSummary.tsx",
    233,
    13,
  ],
    [
    "BTN-109",
    "SITE-022a9db6eed9fbc4-01",
    "LIVE-022a9db6eed9fbc4",
    "src/renderer/TrayWindow/components/TrayToolbar.tsx",
    23,
    3,
  ],
] as const;

type ConsumerContractRow = readonly [
  id: string,
  stableId: string,
  semanticId: string,
  file: string,
  line: number,
  column: number,
];

// The single reviewed count. Every assertion and title below reads it, so bumping the
// inventory is one deliberate edit instead of a seven-site search-and-replace across a file
// where the count's digits also appear in row ids (`BTN-109`), line numbers and hashes — and
// a stray hit inside a SITE- id is the one that used to be silent.
const EXPECTED_CONSUMER_COUNT = 109;

// The one place a row tuple becomes a consumer object. The regeneration block below reuses
// it, so the emitted sha256 is computed over the same key order the assertion hashes —
// JSON.stringify is key-order sensitive, and a second hand-written mapping drifted from
// this one before.
const toChecklistConsumer = ([
  id,
  stableId,
  semanticId,
  file,
  line,
  column,
]: ConsumerContractRow): ChecklistConsumer => ({
  column,
  file,
  id,
  line,
  semanticId,
  stableId,
});

const expectedButtonConsumers: ChecklistConsumer[] =
  consumerContractRows.map(toChecklistConsumer);
const consumerContractSha256 =
  "9c9db085307f271c5b93a79aaa25d02e6c0d13ce46f43ac5f1ef0deb6fc43f48";

// A row's stableId normally mirrors its own semanticId: SITE-<hash>-01 for LIVE-<hash>.
// It diverges only where a site was edited in place, moving its identity hash while staying
// the same button, and the previous stableId was carried by hand so the site keeps one
// lineage across history. Every such carry is listed here, so the binding is reviewed data
// rather than an unverifiable claim in a commit message: the pairs below are the complete
// set of rows whose stableId is not derivable from the row itself.
const carriedStableIdentities: readonly (readonly [string, string])[] = [
  ["SITE-f817bc24bfff4be1-01", "LIVE-264ac29656e00cd9"],
  ["SITE-b1fefcea3824a139-01", "LIVE-6a59bc31fcc6d246"],
  ["SITE-fd75f166a3e391cd-01", "LIVE-0ec083a0c6614349"],
  ["SITE-0aee59564402ec3a-01", "LIVE-6a491ec61d9d725b"],
  ["SITE-5c07a3dcdb7ff819-01", "LIVE-81d3f6b70313cfa7"],
  ["SITE-43414753ace2ab81-01", "LIVE-da3e264ff5bff86c"],
  ["SITE-cfd38745f41c80f2-01", "LIVE-0d366a2b4a3aa757"],
  ["SITE-2b5e02b82b63d6af-01", "LIVE-1a247b82dcc22868"],
  ["SITE-e1569fb1897b6372-01", "LIVE-a3ccf02b8ad14fce"],
];

const carriedStableIdBySemanticId = new Map(
  carriedStableIdentities.map(([stableId, semanticId]) => [
    semanticId,
    stableId,
  ]),
);

// stableId is the only durable identity in this file and the sha256 cannot protect it — the
// sanctioned regeneration step is "copy the Received: value", so the seal is redefined at
// exactly the moment the artifact changes. This rule can't be: it binds every stableId to
// its own row's semanticId, which the live scan pins to a coordinate.
//
// The -NN suffix is the occurrence of that semanticId in the inventory, not decoration. Two
// byte-identical Buttons inside one component hash the same (semanticIdentityFor never sees
// line or column), so the suffix is what keeps their stableIds distinct — without it, the
// legitimate repin that first introduces such a pair has no satisfying assignment at all.
const deriveStableIds = (semanticIds: readonly string[]): string[] => {
  const occurrences = new Map<string, number>();
  return semanticIds.map((semanticId) => {
    const occurrence = (occurrences.get(semanticId) ?? 0) + 1;
    occurrences.set(semanticId, occurrence);
    const carried = carriedStableIdBySemanticId.get(semanticId);
    return carried !== undefined && occurrence === 1
      ? carried
      : `SITE-${semanticId.replace(/^LIVE-/, "")}-${String(occurrence).padStart(2, "0")}`;
  });
};

const compareConsumers = (
  left: ButtonConsumer,
  right: ButtonConsumer,
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column;

export { scanRenderer, sha256 };

describe("renderer Button source guard", () => {
  it("rejects native button evasions and every PrimaryButton reference", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import { createElement as h } from "react";',
        'import { PrimaryButton as Legacy } from "./PrimaryButton";',
        'const Native = "button";',
        "const Alias = Native;",
        "const render = h;",
        'const Elements = { button: "button" };',
        "const Example = () => <><Alias /><Elements.button /><Legacy /></>;",
        'render("button", null);',
      ].join("\n"),
    );

    expect(result.findings.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "native JSX alias",
        "namespaced native JSX",
        'createElement("button")',
        "PrimaryButton",
      ]),
    );
    expect(
      result.findings.filter(({ kind }) => kind === 'createElement("button")'),
    ).toHaveLength(1);
  });

  it("detects proven JSX property aliases using TypeScript property-access syntax", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const Elements = { button: "button" };',
        "const Example = () => <Elements.button />;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "namespaced native JSX"),
    ).toHaveLength(1);
    expect(result.findings[0]?.detail).toBe("<Elements.button>");
  });

  it("resolves native-tag and createElement aliases in their lexical scope", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import { createElement as h } from "react";',
        'const Native = "button";',
        "const NativeFactory = h;",
        "const Outer = () => <Native />;",
        "const Inner = () => {",
        "  const Native = () => <span />;",
        "  const NativeFactory = () => null;",
        '  return <>{<Native />}{NativeFactory("button", null)}</>;',
        "};",
      ].join("\n"),
    );

    expect(
      result.findings.filter(
        ({ kind }) =>
          kind === "native JSX alias" || kind === 'createElement("button")',
      ),
    ).toHaveLength(1);
    expect(result.findings[0]?.detail).toBe("<Native>");
  });

  it("rejects native-tag aliases passed to createElement", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import { createElement } from "react";',
        'const Native = "button";',
        "createElement(Native, null);",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === 'createElement("button")'),
    ).toHaveLength(1);
  });

  it("normalizes TypeScript wrappers and computed createElement aliases", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import * as React from "react";',
        'const Elements = { button: "button" } as const;',
        'const Native = "button" as const;',
        'const h = React["createElement"] as typeof React.createElement;',
        "const Example = () => <><Elements.button /><Native /></>;",
        "h(Native, null);",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "namespaced native JSX"),
    ).toHaveLength(1);
    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(1);
    expect(
      result.findings.filter(({ kind }) => kind === 'createElement("button")'),
    ).toHaveLength(1);
  });

  it("keeps loop bindings in their lexical scope", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const Native = "button";',
        "const Before = () => <Native />;",
        "for (const Native of components) {",
        "  const InsideLoop = () => <Native />;",
        "}",
        "const After = () => <Native />;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(2);
    expect(result.findings.map(({ detail }) => detail)).toEqual([
      "<Native>",
      "<Native>",
    ]);
  });

  it("treats destructured parameters as shadowing bindings", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const Native = "button";',
        "const WithObjectParameter = ({ Native }) => <Native />;",
        "const WithArrayParameter = ([Native]) => <Native />;",
        "const Outer = () => <Native />;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(1);
    expect(result.findings[0]?.detail).toBe("<Native>");
  });

  it("hoists var bindings to their containing function scope", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const Native = "button";',
        "function Example() {",
        "  if (enabled) {",
        "    var Native = Span;",
        "  }",
        "  return <Native />;",
        "}",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toEqual([]);
  });

  it("keeps switch lexical bindings out of their parent scope", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const Native = "button";',
        "const Before = () => <Native />;",
        "switch (value) {",
        "  case 1:",
        "    const Native = Span;",
        "    const Inside = () => <Native />;",
        "    break;",
        "}",
        "const After = () => <Native />;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(2);
  });

  it("resolves destructured native-tag value aliases", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const Elements = { button: "button" } as const;',
        "const { button: Native } = Elements;",
        "const Example = () => <Native />;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(1);
  });

  it("resolves array-destructured native-tag value aliases", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const [Native] = ["button"] as const;',
        "const Example = () => <Native />;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(1);
  });

  it("resolves computed native-tag values passed to createElement", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import * as React from "react";',
        'const Elements = { button: "button" } as const;',
        'React.createElement(Elements["button"], null);',
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === 'createElement("button")'),
    ).toHaveLength(1);
  });

  it("resolves object-destructured createElement factory aliases", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import * as React from "react";',
        "const { createElement: h } = React;",
        'h("button", null);',
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === 'createElement("button")'),
    ).toHaveLength(1);
  });

  it("resolves BindingElement defaults and nested native property chains", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const [Native = "button"] = [];',
        'const Elements = { controls: { button: "button" } } as const;',
        "const Example = () => <><Native /><Elements.controls.button /></>;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(1);
    expect(
      result.findings.filter(({ kind }) => kind === "namespaced native JSX"),
    ).toHaveLength(1);
  });

  it("uses BindingElement defaults for explicitly undefined values", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const [Native = "button"] = [undefined];',
        'const { button: AlsoNative = "button" } = { button: undefined };',
        "const Example = () => <><Native /><AlsoNative /></>;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(2);
  });

  it("resolves computed literal and object-rest native properties", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const Elements = { ["button"]: "button" } as const;',
        'const { ...Rest } = { button: "button" } as const;',
        "const Example = () => <><Elements.button /><Rest.button /></>;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "namespaced native JSX"),
    ).toHaveLength(2);
  });

  it("counts arbitrary object values and nested member aliases to Button", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import { Button } from "./Button";',
        "const Controls = { save: Button };",
        "const { save: Shared } = Controls;",
        "const UI = { Controls: { Button } };",
        "const Example = () => <><Shared /><UI.Controls.Button /></>;",
      ].join("\n"),
    );

    expect(result.buttonConsumers).toHaveLength(2);
    expect(result.buttonConsumers.map(({ line }) => line)).toEqual([5, 5]);
  });

  it("preserves an initialized var binding across initializer-free redeclarations", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'var Native = "button";',
        "var Native;",
        "const Example = () => <Native />;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(1);
  });

  it("counts Button destructured from a proven namespace as a consumer", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import * as UI from "./Button";',
        "const { Button: Shared } = UI;",
        "const Extra = () => <Shared />;",
      ].join("\n"),
    );

    expect(result.buttonConsumers).toHaveLength(1);
    expect(result.buttonConsumers[0]).toMatchObject({
      file: "fixture.tsx",
      line: 3,
    });
  });

  it("counts a renderer import that resolves to the sanctioned Button leaf", () => {
    // Both spellings of the same file: the relative one every consumer uses today, and the
    // `~/` path alias that is this repo's canonical form and would otherwise read as foreign.
    for (const moduleName of ["../Button", "~/renderer/components/Button"]) {
      const result = scanSource(
        "src/renderer/components/probe/Fixture.tsx",
        [
          `import { Button } from "${moduleName}";`,
          "const Example = () => <Button />;",
        ].join("\n"),
      );

      expect(result.findings).toEqual([]);
      expect(result.buttonConsumers).toHaveLength(1);
    }
  });

  it("rejects a renderer re-export of a Button module outside the sanctioned leaf", () => {
    const result = scanSource(
      "src/renderer/components/probe/Fixture.tsx",
      ['export { Button } from "~/features/ui/shared/Button";'].join("\n"),
    );

    expect(result.findings).toEqual([
      {
        file: "src/renderer/components/probe/Fixture.tsx",
        line: 1,
        kind: "foreign Button module",
        detail: "export from ~/features/ui/shared/Button",
      },
    ]);
  });

  it("rejects a renderer import of a Button module outside the sanctioned leaf", () => {
    // The scanner reads only src/renderer, so a Button-named module anywhere else never has
    // its own source inspected. Accepting it by basename would let `<button {...props} />`
    // ship from src/features/ui/shared/Button.tsx behind a repointed import, with the whole
    // inventory still reporting green.
    for (const moduleName of [
      "~/features/ui/shared/Button",
      "../../../features/ui/shared/Button",
      "@acme/design-system/Button",
    ]) {
      const result = scanSource(
        "src/renderer/components/probe/Fixture.tsx",
        [
          `import { Button } from "${moduleName}";`,
          "const Example = () => <Button />;",
        ].join("\n"),
      );

      expect(result.findings).toEqual([
        {
          file: "src/renderer/components/probe/Fixture.tsx",
          line: 1,
          kind: "foreign Button module",
          detail: `import from ${moduleName}`,
        },
      ]);
      expect(result.buttonConsumers).toEqual([]);
    }
  });

  it("rejects dynamic import and CommonJS require PrimaryButton paths", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'void import("./PrimaryButton.test");',
        'require("./PrimaryButton.test");',
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "PrimaryButton"),
    ).toHaveLength(2);
  });

  it("keeps a named class expression binding inside the class scope", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const Native = "button";',
        "const Example = class Native {",
        "  render() {",
        "    return <Native />;",
        "  }",
        "};",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toEqual([]);
  });

  it("recognizes dotted PrimaryButton paths and imports", () => {
    expect(
      isPrimaryButtonModule("src/renderer/components/PrimaryButton.test.ts"),
    ).toBe(true);
    expect(
      isPrimaryButtonModule(String.raw`src\renderer\PrimaryButton.test.tsx`),
    ).toBe(true);
    expect(
      isPrimaryButtonModule("src/renderer/components/NotPrimaryButton.test.ts"),
    ).toBe(false);

    const result = scanSource("fixture.tsx", 'import "./PrimaryButton.test";');
    expect(
      result.findings.filter(({ kind }) => kind === "PrimaryButton"),
    ).toHaveLength(1);
  });

  it("resolves native tags from parameter defaults", () => {
    const result = scanSource(
      "fixture.tsx",
      'const Example = (Native = "button") => <Native />;',
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(1);
  });

  it("uses the latest assignment when resolving native-tag aliases", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        "let Native = Span;",
        'Native = "button";',
        "const Example = () => <Native />;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(1);
  });

  it("uses last-write object spread properties for native JSX aliases", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'const Elements = { button: Span, ...{ button: "button" } };',
        "const Example = () => <Elements.button />;",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "namespaced native JSX"),
    ).toHaveLength(1);
  });

  it("treats static template literals as native button values", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import * as React from "react";',
        "const Native = `button`;",
        "const Example = () => <Native />;",
        "React.createElement(`button`, null);",
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "native JSX alias"),
    ).toHaveLength(1);
    expect(
      result.findings.filter(({ kind }) => kind === 'createElement("button")'),
    ).toHaveLength(1);
  });

  it("resolves createElement factories stored under object properties", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import * as React from "react";',
        "const Factories = { render: React.createElement };",
        'Factories.render("button", null);',
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === 'createElement("button")'),
    ).toHaveLength(1);
  });

  it("rejects PrimaryButton re-export module paths", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'export * from "./PrimaryButton";',
        'export { default as Legacy } from "./PrimaryButton.test";',
      ].join("\n"),
    );

    expect(
      result.findings.filter(({ kind }) => kind === "PrimaryButton"),
    ).toHaveLength(2);
  });

  it("changes a consumer identity for semantic substitutions at a stable location", () => {
    const scanConsumer = (attributes: string): ButtonConsumer | undefined =>
      scanSource(
        "fixture.tsx",
        [
          'import { Button } from "./Button";',
          `const Example = () => <Button ${attributes}>Save</Button>;`,
        ].join("\n"),
      ).buttonConsumers[0];
    const baseline = scanConsumer(
      'variant="primary" type="button" onClick={save} aria-label="Save" disabled={busy} className="h-8"',
    );

    expect(baseline).toHaveProperty("semanticId");
    for (const mutation of [
      'variant="primary" type="button" onClick={remove} aria-label="Save" disabled={busy} className="h-8"',
      'variant="destructive" type="button" onClick={save} aria-label="Save" disabled={busy} className="h-8"',
      'variant="primary" type="button" onClick={save} aria-label="Remove" disabled={busy} className="h-8"',
      'variant="primary" type="submit" onClick={save} aria-label="Save" disabled={busy} className="h-8"',
      'variant="primary" type="button" onClick={save} aria-label="Save" disabled={ready} className="h-8"',
      'variant="primary" type="button" onClick={save} aria-label="Save" disabled={busy} className="w-8"',
      // An attribute the contract knows nothing about, merely appended. This is the claim the
      // deleted 109x mutation test made against every live site; semanticIdentityFor puts the
      // whole attribute list into the fingerprint, so one fixture settles it for all of them.
      'variant="primary" type="button" onClick={save} aria-label="Save" disabled={busy} className="h-8" data-probe="1"',
    ]) {
      expect(scanConsumer(mutation)).not.toEqual(baseline);
    }
  });

  // The 109x stable-coordinate mutation test that used to sit here was deleted. Its byte-offset
  // anchor (`source.slice(offset, …) === "<Button"`) is implied by the live-vs-pinned equality
  // below: a pinned coordinate that named no real Button site would be missing from the live
  // scan and the inventory equality would already be red. Its other claim — an injected
  // attribute moves the identity hash — is proved on a fixture in the test above and cannot
  // fail, since semanticIdentityFor hashes the whole attribute list. What it did do was go red,
  // loudly and for a stale reason, on every line-shifting edit to any of the 37 renderer files
  // holding a pinned Button, which trained reviewers to wave this guard's failures through.
  // What it alone caught: the literal text `<Button` at a pinned coordinate, so a Button
  // re-bound locally (`import { Button as Btn }`, or `<ButtonNs.Button …>`) at an unchanged
  // coordinate with unchanged props is now invisible. That is a rename of the sanctioned
  // component, not a substitution of it, and the ~1200-line alias resolver above exists
  // precisely to accept such re-bindings as legitimate consumers.

  it(`allows the shared native leaf and the exact ${EXPECTED_CONSUMER_COUNT}-consumer migration inventory`, async () => {
    const result = await scanRenderer();
    const locations = expectedButtonConsumers.map(
      ({ file, line, column }) => `${file}:${line}:${column}`,
    );

    expect(expectedButtonConsumers).toHaveLength(EXPECTED_CONSUMER_COUNT);
    expect(sha256(JSON.stringify(expectedButtonConsumers))).toBe(
      consumerContractSha256,
    );
    expect(expectedButtonConsumers.map(({ id }) => id)).toEqual(
      Array.from(
        { length: EXPECTED_CONSUMER_COUNT },
        (_, index) => `BTN-${String(index + 1).padStart(3, "0")}`,
      ),
    );
    expect(
      new Set(expectedButtonConsumers.map(({ stableId }) => stableId)).size,
    ).toBe(EXPECTED_CONSUMER_COUNT);
    expect(new Set(locations).size).toBe(EXPECTED_CONSUMER_COUNT);
    // BTN-NNN is positional, so row order IS the label-to-button binding. Nothing else here
    // pins it: the live comparison below re-sorts both sides, the id sequence is invariant
    // under any permutation, and the sha256 is regenerated from whatever order the file
    // holds. A repin that sorts with Array.sort()'s ASCII rule instead of compareConsumers'
    // localeCompare reshuffles all rows, reassigns every label, and is otherwise green.
    expect(expectedButtonConsumers).toEqual(
      [...expectedButtonConsumers].sort(compareConsumers),
    );
    // Binds each stableId to its own row's semanticId, which the live comparison below binds
    // to a coordinate. Without this the whole SITE- column can be rotated onto the wrong
    // buttons, or one character of one hash flipped, and every assertion still passes once
    // the sha256 is refreshed the way the regeneration procedure instructs.
    expect(expectedButtonConsumers.map(({ stableId }) => stableId)).toEqual(
      deriveStableIds(
        expectedButtonConsumers.map(({ semanticId }) => semanticId),
      ),
    );
    // A carried entry whose semanticId is no longer in the inventory is a stale exemption.
    // It does not stay harmless: an edit that puts a site back to a previous state re-derives
    // the identity it names, and the dead entry silently adopts that row.
    expect(
      carriedStableIdentities
        .map(([, semanticId]) => semanticId)
        .filter(
          (semanticId) =>
            !expectedButtonConsumers.some(
              (consumer) => consumer.semanticId === semanticId,
            ),
        ),
    ).toEqual([]);
    // A carry always names a RETIRED identity — the hash the site used to have. One naming an
    // identity some row still has is not a carry, it is the escape hatch being used to bless a
    // stableId that belongs to a different button; that is the shape a cross-wired repin takes
    // when the mirror rule above rejects it and the obvious next move is to exempt the rows.
    expect(
      carriedStableIdentities
        .map(([stableId]) => stableId)
        .filter((stableId) =>
          expectedButtonConsumers.some(
            ({ semanticId }) =>
              semanticId.replace(/^LIVE-/, "") ===
              stableId.replace(/^SITE-/, "").replace(/-\d+$/, ""),
          ),
        ),
    ).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.sourceFiles.filter(isPrimaryButtonModule)).toEqual([]);
    expect(result.nativeLeaves).toHaveLength(1);
    expect(result.nativeLeaves[0]).toMatchObject({
      file: buttonLeafPath,
      kind: "native JSX",
      detail: nativeButtonTag,
    });
    expect([...result.buttonConsumers].sort(compareConsumers)).toEqual(
      [...expectedButtonConsumers]
        .sort(compareConsumers)
        .map(({ file, line, column, semanticId }) => ({
          column,
          file,
          line,
          semanticId,
        })),
    );
  });

  // REGENERATION PROCEDURE — the whole of it, in the repository, because the file it rewrites
  // is 3000 lines of pinned data and the previous version of this block emitted an artifact
  // that could not be pasted in (wrong key order, so its sha never matched) and that minted
  // fresh SITE- ids (so every carried lineage was silently dropped).
  //
  //   1. `REGEN_BUTTON_CONTRACT=1 bun run test src/renderer/components/ButtonSourceGuard.test.ts`
  //   2. Read `.scratch/button-contract.json`. `reconciliation` lists what actually changed:
  //      `added` and `dropped` coordinates, and `identityChanges` — sites at an unchanged
  //      coordinate whose semanticId moved. Every entry must be explained by the diff you just
  //      made. An unexplained `dropped` + `added` pair is a button that moved, not two events.
  //   3. For each `identityChanges` entry that is still the same button, add
  //      `[<old stableId>, <new semanticId>]` to `carriedStableIdentities` above — that, not a
  //      commit message, is what carries the site's history. If that site was carried before,
  //      DELETE its old entry: the entry it supersedes now names a semanticId no site has, and
  //      the test says so rather than letting a dead exemption sit there waiting to adopt a row.
  //   4. **Regenerate again.** `rowsSource` is built from `carriedStableIdentities` as it stood
  //      when the run started, so the artifact from step 1 still carries the derived stableId
  //      for anything you exempted in step 3. Pasting it produces a stableId mismatch, not a
  //      sha mismatch, and the failure diff invites you to delete the carry you just added.
  //   5. Paste `rowsSource` over `consumerContractRows` and `sha256` over
  //      `consumerContractSha256`. Do NOT search-and-replace the count: edit
  //      EXPECTED_CONSUMER_COUNT, the one place it lives.
  //   6. Re-run the test. Nothing is ever copied out of `Received:` — not the sha, which is how
  //      the seal was hollowed out before, and not a stableId, which would reassign a lineage.
  //      A mismatch of either means the paste or step 3 is wrong; fix it and regenerate.
  if (process.env.REGEN_BUTTON_CONTRACT === "1") {
    it("regenerates consumer contract artifact", async () => {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const result = await scanRenderer();
      const sorted = [...result.buttonConsumers].sort(compareConsumers);
      const stableIds = deriveStableIds(
        sorted.map(({ semanticId }) => semanticId),
      );
      const rows: ConsumerContractRow[] = sorted.map((consumer, index) => [
        `BTN-${String(index + 1).padStart(3, "0")}`,
        stableIds[index],
        consumer.semanticId,
        consumer.file,
        consumer.line,
        consumer.column,
      ]);
      const locationOf = ({ file, line, column }: ButtonConsumer): string =>
        `${file}:${line}:${column}`;
      const liveByLocation = new Map(
        sorted.map((consumer) => [locationOf(consumer), consumer]),
      );
      const pinnedByLocation = new Map(
        expectedButtonConsumers.map((consumer) => [
          locationOf(consumer),
          consumer,
        ]),
      );
      const reconciliation = {
        added: [...liveByLocation.keys()].filter(
          (location) => !pinnedByLocation.has(location),
        ),
        dropped: [...pinnedByLocation.keys()].filter(
          (location) => !liveByLocation.has(location),
        ),
        identityChanges: [...pinnedByLocation.entries()]
          .filter(
            ([location, pinned]) =>
              liveByLocation.get(location) !== undefined &&
              liveByLocation.get(location)?.semanticId !== pinned.semanticId,
          )
          .map(([location, pinned]) => ({
            location,
            id: pinned.id,
            stableId: pinned.stableId,
            was: pinned.semanticId,
            now: liveByLocation.get(location)?.semanticId,
          })),
      };
      const rowsSource = [
        "const consumerContractRows = [",
        ...rows.map(([id, stableId, semanticId, file, line, column]) =>
          [
            "  [",
            `    "${id}",`,
            `    "${stableId}",`,
            `    "${semanticId}",`,
            `    "${file}",`,
            `    ${line},`,
            `    ${column},`,
            "  ],",
          ].join("\n"),
        ),
        "] as const;",
      ].join("\n");

      await mkdir(".scratch", { recursive: true });
      await writeFile(
        ".scratch/button-contract.json",
        JSON.stringify(
          {
            count: rows.length,
            reconciliation,
            rows,
            rowsSource,
            // Hashed through the same mapping the assertion uses, so a drop-in paste agrees.
            sha256: sha256(JSON.stringify(rows.map(toChecklistConsumer))),
          },
          null,
          2,
        ),
      );
      expect(rows.length).toBeGreaterThan(0);
    });
  }
});
