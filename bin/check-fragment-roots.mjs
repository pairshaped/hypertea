#!/usr/bin/env node
import ts from "typescript";
import process from "node:process";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

/** Follow view results, not element children: fragments are only valid in children. */
export function checkFragmentRoots(program) {
  const checker = program.getTypeChecker();
  const errors = [];
  const reported = new Set();
  function inspect(node, seen, bindings = new Map()) {
    if (!node || seen.has(node)) return;
    const next = new Set(seen).add(node);
    if (ts.isJsxFragment(node) || ts.isArrayLiteralExpression(node)
      || ts.isCallExpression(node) && checker.isArrayType(checker.getTypeAtLocation(node))) {
      if (!reported.has(node)) {
        reported.add(node);
        const source = node.getSourceFile();
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart());
        errors.push(`${source.fileName}:${line + 1}:${character + 1}: Hypertea views require one root VNode; wrap the fragment in an element.`);
      }
    } else if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      // The element supplies the root; any fragments below it are ordinary children.
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      inspect(node.expression, next, bindings);
    } else if (ts.isConditionalExpression(node)) {
      inspect(node.whenTrue, next, bindings); inspect(node.whenFalse, next, bindings);
    } else if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) inspect(node.left, next, bindings);
      inspect(node.right, next, bindings);
    } else if (ts.isCallExpression(node)) {
      const declaration = checker.getResolvedSignature(node)?.declaration;
      const argumentsByParameter = new Map(bindings);
      declaration?.parameters.forEach((parameter, index) => argumentsByParameter.set(parameter, node.arguments[index]));
      inspect(declaration, next, argumentsByParameter);
    } else if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      for (const declaration of symbol?.declarations ?? []) inspect(bindings.get(declaration) ?? declaration, next, bindings);
    } else if (ts.isShorthandPropertyAssignment(node)) {
      for (const declaration of checker.getShorthandAssignmentValueSymbol(node)?.declarations ?? []) inspect(declaration, next, bindings);
    } else if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyAssignment(node)) {
      inspect(node.initializer, next, bindings);
    } else if (ts.isFunctionLike(node) && node.body) {
      if (!ts.isBlock(node.body)) inspect(node.body, next, bindings);
      else {
        function returns(child) {
          if (ts.isReturnStatement(child)) inspect(child.expression, next, bindings);
          else if (!ts.isFunctionLike(child)) ts.forEachChild(child, returns);
        }
        ts.forEachChild(node.body, returns);
      }
    }
  }
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || /[/\\]node_modules[/\\]/.test(source.fileName)) continue;
    function visit(node) {
      if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node)) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === "view"
        && ts.isObjectLiteralExpression(node.parent) && checker.getTypeAtLocation(node.parent).getProperty("init")) {
        inspect(ts.isPropertyAssignment(node) ? node.initializer : node, new Set());
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const project = resolve(process.argv[2] ?? "tsconfig.json");
  const config = ts.readConfigFile(project, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(project));
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  const errors = checkFragmentRoots(ts.createProgram(parsed.fileNames, parsed.options));
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
}
