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
  | "createElement(\"button\")"
  | "PrimaryButton";

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

const isButtonModule = (moduleName: string): boolean =>
  /(?:^|\/)Button(?:\.tsx?)?$/.test(moduleName);

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

const isFunctionScopeNode = (
  node: ts.Node,
): node is ts.SignatureDeclaration => ts.isFunctionLike(node);

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
  resolvesToButton: (expression: ts.JsxTagNameExpression, atNode: ts.Node) => boolean;
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
        const propertyName =
          ts.isArrayBindingPattern(name)
            ? String(index)
            : propertyNameNode
              ? staticPropertyName(propertyNameNode)
              : null;
        const propertySource =
          bindingSource && element.dotDotDotToken && ts.isObjectBindingPattern(name)
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
            : isButtonModule(moduleName)
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
            : isButtonModule(moduleName)
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
              : isButtonModule(moduleName) && importedName === "Button"
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
    if (
      bindingState.importedKind ||
      visited.has(binding.declaration)
    ) {
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
    if (
      bindingSource.propertyName === "createElement"
    ) {
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
        resolvesToCreateElement(
          sourceExpression,
          sourceExpression,
          visited,
        ),
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
          resolvesToCreateElement(
            propertyValue,
            propertyValue,
            visited,
          ),
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
      resolvesComponent(
        expression,
        atNode,
        "button-component",
      ),
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
      resolvesComponent(
        expression,
        atNode,
        "primary-button-component",
      ),
  };
};

const normalizedSourceText = (sourceFile: ts.SourceFile, node: ts.Node): string =>
  node.getText(sourceFile).replace(/\s+/g, " ").trim();

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
      ? { kind: "spread", value: normalizedSourceText(sourceFile, property.expression) }
      : {
          kind: "attribute",
          name: property.name.getText(sourceFile),
          value: attributeValue(sourceFile, property),
        },
  );
  const namedAttributes = opening.attributes.properties.filter(ts.isJsxAttribute);
  const findAttribute = (name: string): ts.JsxAttribute | undefined =>
    namedAttributes.find((attribute) => attribute.name.getText(sourceFile) === name);
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
    .filter((attribute) => attribute.name.getText(sourceFile).startsWith("aria-"))
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
        .map((property) => normalizedSourceText(sourceFile, property.expression)),
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

  const addFinding = (node: ts.Node, kind: FindingKind, detail: string): void => {
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
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : "";
    if (isPrimaryButtonModule(moduleName)) {
      addFinding(statement, "PrimaryButton", `import from ${moduleName}`);
    }
    if (!statement.importClause) {
      continue;
    }

    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === "PrimaryButton") {
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
        addFinding(opening, "namespaced native JSX", `<${tagName.getText(sourceFile)}>`);
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
      if (
        isCreateElement &&
        nativeArgument
      ) {
        addFinding(node, "createElement(\"button\")", node.getText(sourceFile));
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
      buttonConsumers: [...aggregate.buttonConsumers, ...result.buttonConsumers],
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
  ["BTN-001", "SITE-71a619fb8e003614-01", "LIVE-08e5c95965d6039a", "src/renderer/components/about/AboutPanel.tsx", 47, 13],
  ["BTN-002", "SITE-417a8eccd8888fbb-01", "LIVE-ef98536bd53f7615", "src/renderer/components/about/UserGuidePanel.tsx", 231, 9],
  ["BTN-003", "SITE-53c5206a200385ea-01", "LIVE-53c5206a200385ea", "src/renderer/components/about/UserGuidePanel.tsx", 305, 9],
  ["BTN-004", "SITE-7e1e56cf7fda34ba-01", "LIVE-d625f04039490f68", "src/renderer/components/about/UserGuidePanel.tsx", 318, 17],
  ["BTN-005", "SITE-1065769a4b88dda5-01", "LIVE-b3521eab8d34cca7", "src/renderer/components/about/UserGuidePanel.tsx", 336, 17],
  ["BTN-006", "SITE-05c810b08ba1c358-01", "LIVE-d29b2d638d60e13e", "src/renderer/components/about/UserGuidePanel.tsx", 362, 17],
  ["BTN-007", "SITE-39ed459ad85dbb78-01", "LIVE-8e1c5ad13fa650d3", "src/renderer/components/CopyButton.tsx", 39, 5],
  ["BTN-008", "SITE-ce68b5faf1fd3005-01", "LIVE-ffaaad62c6e612d8", "src/renderer/components/Dialog.tsx", 62, 11],
  ["BTN-009", "SITE-e35751537426a2bd-01", "LIVE-8264f7f6bcd8085d", "src/renderer/components/HistoryPanel.tsx", 89, 11],
  ["BTN-010", "SITE-e25a3433178b56b8-01", "LIVE-8975613823778fc5", "src/renderer/components/HistoryPanel.tsx", 97, 13],
  ["BTN-011", "SITE-8fdea92d910bdd00-01", "LIVE-5cbddd24a7826d4b", "src/renderer/components/HistoryReviewModal.tsx", 81, 11],
  ["BTN-012", "SITE-c877a1e0899402b2-01", "LIVE-5961fe9e2b8ba32a", "src/renderer/components/HotkeyInput.tsx", 206, 9],
  ["BTN-013", "SITE-b80fe11c3231d41f-01", "LIVE-97e7bb1c3ab4305f", "src/renderer/components/KeyBinding.tsx", 28, 7],
  ["BTN-014", "SITE-cf2a96097d8391ca-01", "LIVE-700a4122e599ffe1", "src/renderer/components/LogsPanel.tsx", 335, 9],
  ["BTN-015", "SITE-c06b8413945e78ff-01", "LIVE-501f82e78a2b09c9", "src/renderer/components/LogsPanel.tsx", 342, 9],
  ["BTN-016", "SITE-1a700da9051cb2fb-01", "LIVE-29f318d8be62f1d9", "src/renderer/components/LogsPanel.tsx", 349, 9],
  ["BTN-017", "SITE-88b7be651634ab62-01", "LIVE-7197db62a76969f7", "src/renderer/components/ModelManagerDialog.tsx", 195, 11],
  ["BTN-018", "SITE-d4a4643a9169ba2d-01", "LIVE-67f4724e126c10d4", "src/renderer/components/ModelManagerDialog.tsx", 207, 11],
  ["BTN-019", "SITE-2b1785462ba47bbc-01", "LIVE-04748a61b30e3ef8", "src/renderer/components/ModelManagerDialog.tsx", 218, 11],
  ["BTN-020", "SITE-653a97eac5289779-01", "LIVE-7c4301fb38c9808d", "src/renderer/components/ModelManagerDialog.tsx", 230, 13],
  ["BTN-021", "SITE-95841fb6da0f157b-01", "LIVE-fc298046a960042d", "src/renderer/components/ModelManagerDialog.tsx", 256, 19],
  ["BTN-022", "SITE-10a208454fdfae02-01", "LIVE-c09e1d790b99f3f9", "src/renderer/components/ModelManagerDialog.tsx", 276, 27],
  ["BTN-023", "SITE-df3d083a82cfb916-01", "LIVE-e25d0c965e5599f3", "src/renderer/components/ModelManagerDialog.tsx", 330, 27],
  ["BTN-024", "SITE-5e076e191fc2107a-01", "LIVE-5526ee17ec81f974", "src/renderer/components/ModelManagerDialog.tsx", 405, 17],
  ["BTN-025", "SITE-9712230411bd3a9b-01", "LIVE-73361c5a5c8f4108", "src/renderer/components/ModelManagerDialog.tsx", 412, 17],
  ["BTN-026", "SITE-b69cd75f874dca9c-01", "LIVE-9bea8fb78af9d78f", "src/renderer/components/ModelSelect.tsx", 412, 9],
  ["BTN-027", "SITE-8d6dde76b7c3ae63-01", "LIVE-38539922a7e16c77", "src/renderer/components/ModelSelect.tsx", 440, 11],
  ["BTN-028", "SITE-bb8eadbc51c6ba0f-01", "LIVE-edf192add08f8fcb", "src/renderer/components/ModelsPanel.tsx", 161, 15],
  ["BTN-029", "SITE-a68b89cb574e07eb-01", "LIVE-eca35f045362c69d", "src/renderer/components/MultiSelect.tsx", 94, 7],
  ["BTN-030", "SITE-dcfd07ba5e05696b-01", "LIVE-73a48ff1f5f9296f", "src/renderer/components/ProfileManager.tsx", 256, 11],
  ["BTN-031", "SITE-569e41898a468891-01", "LIVE-e99c02ce9aba9550", "src/renderer/components/ProfileManager.tsx", 264, 11],
  ["BTN-032", "SITE-5aa5015607225404-01", "LIVE-7c9f643148cf3085", "src/renderer/components/ProfileManager.tsx", 318, 23],
  ["BTN-033", "SITE-054023d19dd23352-01", "LIVE-0a1b7ac2d9c1f374", "src/renderer/components/ProfileManager.tsx", 326, 21],
  ["BTN-034", "SITE-4483808c41453b50-01", "LIVE-6da333e1baf89565", "src/renderer/components/ProfileManager.tsx", 335, 23],
  ["BTN-035", "SITE-37fc32119ce9e6ac-01", "LIVE-34a9863fc49e6b83", "src/renderer/components/ProfileManager.tsx", 395, 13],
  ["BTN-036", "SITE-dd3ac99966606746-01", "LIVE-826dace3c3bc2a71", "src/renderer/components/ProfileManager.tsx", 403, 13],
  ["BTN-037", "SITE-e1d74ac35a4d23e0-01", "LIVE-ea57f4d3fc631133", "src/renderer/components/ProfileManager.tsx", 439, 13],
  ["BTN-038", "SITE-c7c4cc0cbc6d8944-01", "LIVE-0a4e93dbd86acef1", "src/renderer/components/ProfileManager.tsx", 447, 13],
  ["BTN-039", "SITE-042c8112c0a9c8f9-01", "LIVE-7e4c2589c888f87d", "src/renderer/components/ProfileManager.tsx", 483, 13],
  ["BTN-040", "SITE-22b0fa1a3c9b5d7c-01", "LIVE-d89fe00914eba1d2", "src/renderer/components/ProfileManager.tsx", 491, 13],
  ["BTN-041", "SITE-c0e683be1ecf8790-01", "LIVE-d971b19360ec4666", "src/renderer/components/SearchInput.tsx", 95, 9],
  ["BTN-042", "SITE-7af05d8a3cba878c-01", "LIVE-19310a96f693ae27", "src/renderer/components/SegmentedControl.tsx", 62, 11],
  ["BTN-043", "SITE-b8755f02a8f21fbd-01", "LIVE-9568e1f27af6a345", "src/renderer/components/SettingAppearance.tsx", 87, 17],
  ["BTN-044", "SITE-02fb80de7b4d66ea-01", "LIVE-bc36161d674c7650", "src/renderer/components/SettingCorrection.tsx", 410, 13],
  ["BTN-045", "SITE-94ef38da6d54dea8-01", "LIVE-6dd70efb010592d0", "src/renderer/components/SettingCorrection.tsx", 424, 19],
  ["BTN-046", "SITE-0694ac46e40edf07-01", "LIVE-31930ebb84cc797f", "src/renderer/components/SettingCorrection.tsx", 482, 15],
  ["BTN-047", "SITE-19327cec6dd7ab56-01", "LIVE-be46cc9ab1065d84", "src/renderer/components/SettingCorrection.tsx", 490, 15],
  ["BTN-048", "SITE-084abdfaa3d706db-01", "LIVE-6b4e0c40672f1a9f", "src/renderer/components/SettingCorrection.tsx", 499, 15],
  ["BTN-049", "SITE-ec1cb639d0801535-01", "LIVE-d092e1365d74f58e", "src/renderer/components/SettingCorrection.tsx", 556, 15],
  ["BTN-050", "SITE-0331a5e36ffc4b2d-01", "LIVE-7ddd61f39a4603c1", "src/renderer/components/SettingCorrection.tsx", 618, 9],
  ["BTN-051", "SITE-edf33805b54733ba-01", "LIVE-07f2a8ba23e043f1", "src/renderer/components/SettingGeneral.tsx", 614, 11],
  ["BTN-052", "SITE-bd0c62470cfb4b04-01", "LIVE-c4546c1f1b582275", "src/renderer/components/SettingGeneral.tsx", 627, 13],
  ["BTN-053", "SITE-3c03205f66bb8f20-01", "LIVE-f528b6225f5af211", "src/renderer/components/SettingGeneral.tsx", 661, 15],
  ["BTN-054", "SITE-2985cfefb8259f94-01", "LIVE-d3d535844d3ea12d", "src/renderer/components/SettingGeneral.tsx", 669, 15],
  ["BTN-055", "SITE-aa523e0e3171e4e2-01", "LIVE-6174e716401ff26e", "src/renderer/components/SettingGeneral.tsx", 740, 11],
  ["BTN-056", "SITE-2a5ece0b4d8d01d5-01", "LIVE-9469c19cdb9b59e6", "src/renderer/components/SettingGeneral.tsx", 766, 11],
  ["BTN-057", "SITE-6f52173684d9b3f1-01", "LIVE-9366f8ce82dfacc2", "src/renderer/components/SettingGeneral.tsx", 826, 9],
  ["BTN-058", "SITE-2afefe8b58da16f2-01", "LIVE-f3c8ca23590954fc", "src/renderer/components/SettingPromptGen.tsx", 269, 15],
  ["BTN-059", "SITE-6cf41feb2844d94d-01", "LIVE-f3f343d2e0482049", "src/renderer/components/SettingPromptGen.tsx", 289, 15],
  ["BTN-060", "SITE-32f1f12f749c0a0f-01", "LIVE-b3f4857089946438", "src/renderer/components/SettingPromptGen.tsx", 364, 9],
  ["BTN-061", "SITE-d09064cc6567340e-01", "LIVE-69e4e918b6516bfe", "src/renderer/components/SettingPromptGen.tsx", 370, 9],
  ["BTN-062", "SITE-b033f456b9edb0d8-01", "LIVE-ccaa63ee68a2a8a1", "src/renderer/components/SettingsIcon.tsx", 28, 5],
  ["BTN-063", "SITE-187c46dab673fb0a-01", "LIVE-426eacdcf8f96389", "src/renderer/components/SettingsModal.tsx", 198, 11],
  ["BTN-064", "SITE-af6696a6812f0065-01", "LIVE-131332cadfcd6d7c", "src/renderer/components/SettingsModal.tsx", 240, 17],
  ["BTN-065", "SITE-544d0e735bcdc224-01", "LIVE-c0f45b98e17a7b20", "src/renderer/components/SettingTabBtn.tsx", 31, 5],
  ["BTN-066", "SITE-fe87dc426bd171bd-01", "LIVE-f63727c376cb5050", "src/renderer/components/SettingUpdates.tsx", 308, 11],
  ["BTN-067", "SITE-9c72f61ee91e0d49-01", "LIVE-31d2760b23787e23", "src/renderer/components/SettingUpdates.tsx", 333, 11],
  ["BTN-068", "SITE-1972ffe3da0bcde1-01", "LIVE-91ba4b4f640490e2", "src/renderer/components/SettingUpdates.tsx", 361, 13],
  ["BTN-069", "SITE-9ee18af8c12ab3af-02", "LIVE-663c55705a5cc3f0", "src/renderer/components/SettingUpdates.tsx", 381, 15],
  ["BTN-070", "SITE-cfd016770fe61f89-01", "LIVE-43414753ace2ab81", "src/renderer/components/SettingUpdates.tsx", 430, 15],
  ["BTN-071", "SITE-663c55705a5cc3f0-71", "LIVE-663c55705a5cc3f0", "src/renderer/components/SettingUpdates.tsx", 447, 15],
  ["BTN-072", "SITE-7c992efd6d29f812-01", "LIVE-c11f9621b2e3d72c", "src/renderer/components/SettingUpdates.tsx", 461, 15],
  ["BTN-073", "SITE-9ee18af8c12ab3af-04", "LIVE-f4ccea28d324b33f", "src/renderer/components/SettingUpdates.tsx", 474, 13],
  ["BTN-074", "SITE-eeef419824524c4a-01", "LIVE-fbcd67d29270d287", "src/renderer/components/SettingUpdates.tsx", 490, 13],
  ["BTN-075", "SITE-4d96952767063952-01", "LIVE-bfa98039be039f30", "src/renderer/components/SettingUpdates.tsx", 586, 13],
  ["BTN-076", "SITE-ca4cd81c50209cf6-01", "LIVE-5815552ee2096fa5", "src/renderer/components/SettingUpdates.tsx", 615, 13],
  ["BTN-077", "SITE-f4ccea28d324b33f-77", "LIVE-f4ccea28d324b33f", "src/renderer/components/SettingUpdates.tsx", 627, 13],
  ["BTN-078", "SITE-5d39d7c44db8e592-01", "LIVE-d2dc6b542709b453", "src/renderer/components/TrashButton.tsx", 23, 5],
  ["BTN-079", "SITE-bdf91dd57b1a8eab-01", "LIVE-57f775bd4fae66ec", "src/renderer/components/usage/OpenAIUsagePanel.tsx", 94, 11],
  ["BTN-080", "SITE-189b25e5188dce61-01", "LIVE-e630a70d66e34af0", "src/renderer/components/usage/OpenAIUsagePanel.tsx", 121, 13],
  ["BTN-081", "SITE-2ac783017cc928f4-01", "LIVE-450bee16aa4af761", "src/renderer/components/usage/OpenAIUsagePanel.tsx", 132, 9],
  ["BTN-082", "SITE-07c4c1eed32b1e05-01", "LIVE-3c1c72456ff99197", "src/renderer/components/usage/OpenRouterUsagePanel.tsx", 96, 11],
  ["BTN-083", "SITE-675f0652493e38fe-01", "LIVE-eb9419e711683c9d", "src/renderer/components/usage/OpenRouterUsagePanel.tsx", 126, 13],
  ["BTN-084", "SITE-af5b100d129e6dab-01", "LIVE-c0827e45b78b1651", "src/renderer/components/usage/OpenRouterUsagePanel.tsx", 139, 9],
  ["BTN-085", "SITE-ef9a2ca35cce009b-01", "LIVE-cda3ee060bf9b96d", "src/renderer/components/usage/UsagePanel.tsx", 102, 11],
  ["BTN-086", "SITE-88cac4abd73dba55-01", "LIVE-e27f5c86266c2ef9", "src/renderer/components/usage/UsagePanel.tsx", 128, 13],
  ["BTN-087", "SITE-cb7fadf7f125d0a4-01", "LIVE-22b46580f1bd13d0", "src/renderer/CorrectionResultWindow/index.tsx", 61, 9],
  ["BTN-088", "SITE-88c71677c4253b47-01", "LIVE-0186137c312ed90a", "src/renderer/MainWindow/App.tsx", 343, 15],
  ["BTN-089", "SITE-d33755b6903c0d0d-01", "LIVE-391b0616cadac9b3", "src/renderer/TrayWindow/components/TrayCreditBalance.tsx", 66, 5],
  ["BTN-090", "SITE-1af9bad65d4dd36b-01", "LIVE-022a9db6eed9fbc4", "src/renderer/TrayWindow/components/TrayToolbar.tsx", 23, 3],
] as const;

const expectedButtonConsumers: ChecklistConsumer[] = consumerContractRows.map(
  ([id, stableId, semanticId, file, line, column]) => ({
    column,
    file,
    id,
    line,
    semanticId,
    stableId,
  }),
);
const consumerContractSha256 =
  "d9da33f18b50da00e1cc64488c40c2c8dd04c1e90d5c1ea5608fcf8342f148b8";

const compareConsumers = (left: ButtonConsumer, right: ButtonConsumer): number =>
  left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column;

describe("renderer Button source guard", () => {
  it("rejects native button evasions and every PrimaryButton reference", () => {
    const result = scanSource(
      "fixture.tsx",
      [
        'import { createElement as h } from "react";',
        'import { PrimaryButton as Legacy } from "./PrimaryButton";',
        'const Native = "button";',
        'const Alias = Native;',
        'const render = h;',
        'const Elements = { button: "button" };',
        'const Example = () => <><Alias /><Elements.button /><Legacy /></>;',
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
        'const Example = () => <Elements.button />;',
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
        'const NativeFactory = h;',
        'const Outer = () => <Native />;',
        'const Inner = () => {',
        '  const Native = () => <span />;',
        '  const NativeFactory = () => null;',
        '  return <>{<Native />}{NativeFactory("button", null)}</>;',
        '};',
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
        'createElement(Native, null);',
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
        'const Example = () => <><Elements.button /><Native /></>;',
        'h(Native, null);',
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
        'const Before = () => <Native />;',
        'for (const Native of components) {',
        '  const InsideLoop = () => <Native />;',
        '}',
        'const After = () => <Native />;',
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
        'const WithObjectParameter = ({ Native }) => <Native />;',
        'const WithArrayParameter = ([Native]) => <Native />;',
        'const Outer = () => <Native />;',
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
    expect(isPrimaryButtonModule("src/renderer/components/PrimaryButton.test.ts")).toBe(
      true,
    );
    expect(isPrimaryButtonModule(String.raw`src\renderer\PrimaryButton.test.tsx`)).toBe(
      true,
    );
    expect(isPrimaryButtonModule("src/renderer/components/NotPrimaryButton.test.ts")).toBe(
      false,
    );

    const result = scanSource(
      "fixture.tsx",
      'import "./PrimaryButton.test";',
    );
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
    ]) {
      expect(scanConsumer(mutation)).not.toEqual(baseline);
    }
  });



  it("changes every one of the 90 live identities under a stable-coordinate mutation", async () => {
    const sourceByFile = new Map<string, string>();
    let mutatedIdentityCount = 0;

    for (const expected of expectedButtonConsumers) {
      let source = sourceByFile.get(expected.file);
      if (!source) {
        source = await readFile(path.join(repositoryRoot, expected.file), "utf8");
        sourceByFile.set(expected.file, source);
      }
      const lines = source.split("\n");
      const precedingLines = lines.slice(0, expected.line - 1);
      const offset =
        precedingLines.reduce((total, line) => total + line.length + 1, 0) +
        expected.column -
        1;
      expect(source.slice(offset, offset + "<Button".length)).toBe("<Button");

      const mutatedSource =
        source.slice(0, offset + "<Button".length) +
        ` data-card08-mutation="${expected.id}"` +
        source.slice(offset + "<Button".length);
      const mutatedConsumer = scanSource(expected.file, mutatedSource).buttonConsumers.find(
        ({ column, file, line }) =>
          file === expected.file &&
          line === expected.line &&
          column === expected.column,
      );

      expect(mutatedConsumer).toBeDefined();
      expect(mutatedConsumer?.semanticId).not.toBe(expected.semanticId);
      mutatedIdentityCount += 1;
    }

    expect(mutatedIdentityCount).toBe(90);
  });

  it("allows the shared native leaf and the exact 90-consumer migration inventory", async () => {
    const result = await scanRenderer();
    const locations = expectedButtonConsumers.map(
      ({ file, line, column }) => `${file}:${line}:${column}`,
    );

    expect(expectedButtonConsumers).toHaveLength(90);
    expect(sha256(JSON.stringify(expectedButtonConsumers))).toBe(
      consumerContractSha256,
    );
    expect(expectedButtonConsumers.map(({ id }) => id)).toEqual(
      Array.from(
        { length: 90 },
        (_, index) => `BTN-${String(index + 1).padStart(3, "0")}`,
      ),
    );
    expect(new Set(expectedButtonConsumers.map(({ stableId }) => stableId)).size).toBe(
      90,
    );
    expect(new Set(locations).size).toBe(90);
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
});
