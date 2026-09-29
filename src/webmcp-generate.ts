import ts from "typescript";

import type { WebMCPInputSchema } from "./webmcp.js";

/** Build-time only. Read the explicit exposeMessages<Msg> declaration without executing application code. */
export function generateWebMCPSchemas(program: ts.Program, sourcePath: string): Readonly<Record<string, WebMCPInputSchema>> {
  const options = program.getCompilerOptions();
  if ((options.strictNullChecks ?? options.strict) !== true || options.exactOptionalPropertyTypes !== true) {
    throw new Error("WebMCP generation requires strictNullChecks and exactOptionalPropertyTypes");
  }
  const source = program.getSourceFile(sourcePath);
  if (source === undefined) throw new Error(`Source is not in the TypeScript program: ${sourcePath}`);
  const location: ts.Node = source;
  const checker = program.getTypeChecker();
  let invocationType: ts.Type | undefined;
  const calls: Array<ts.CallExpression> = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const signature = checker.getResolvedSignature(node)?.declaration;
      if (signature !== undefined && ts.isFunctionDeclaration(signature) && signature.name?.text === "exposeMessages"
        && /[/\\]webmcp\.(?:d\.)?ts$/.test(signature.getSourceFile().fileName)) {
        calls.push(node);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- The resolved exported function belongs to this module.
        const module = checker.getSymbolAtLocation(signature.getSourceFile())!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- The Hypertea module exports this type beside exposeMessages.
        const invocation = checker.getExportsOfModule(module).find((entry) => entry.name === "WebMCPInvocation")!;
        invocationType = checker.getDeclaredTypeOfSymbol(invocation);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const call = calls[0];
  if (calls.length !== 1 || call === undefined) throw new Error("Expected exactly one exposeMessages<Msg> declaration per source file");
  const messageNode = call.typeArguments?.[0];
  const selection = call.arguments[0];
  if (messageNode === undefined || selection === undefined || !ts.isArrayLiteralExpression(selection)) {
    throw new Error("Use exposeMessages<Msg> with an array literal allowlist");
  }
  const message = checker.getTypeFromTypeNode(messageNode);
  const members = message.isUnion() ? message.types : [message];
  const schemas: Record<string, WebMCPInputSchema> = Object.create(null) as Record<string, WebMCPInputSchema>;
  for (const entry of selection.elements) {
    if (!ts.isObjectLiteralExpression(entry)) throw new Error("Allowlist entries must be object literals");
    let name: string | undefined;
    for (const property of entry.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
        throw new Error("Allowlist entries must have explicit property names");
      }
      if (property.name.text === "message") {
        if (name !== undefined || !ts.isStringLiteral(property.initializer)) throw new Error("Each entry needs one literal message name");
        name = property.initializer.text;
      }
    }
    if (name === undefined) throw new Error("Each entry needs one literal message name");
    if (Object.hasOwn(schemas, name)) throw new Error(`Duplicate message: ${name}`);
    const selected = members.filter((member) => {
      const tag = member.getProperty("type");
      if (tag === undefined) return false;
      const type = checker.getTypeOfSymbolAtLocation(tag, messageNode);
      return type.isStringLiteral() && type.value === name;
    });
    if (selected.length === 0) throw new Error(`Unknown message: ${name}`);
    const variants = selected.map((member) => {
      const invocation = member.getProperty("invocation");
      if (invocation === undefined || checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(invocation, location)) !== invocationType) {
        throw new Error(`${name} must declare an invocation field of type WebMCPInvocation`);
      }
      return objectSchema(member, new Set([member]), true);
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Length is checked here.
    schemas[name] = variants.length === 1 ? variants[0]! : { type: "object", anyOf: variants };
  }
  return schemas;

  function schema(type: ts.Type, ancestors: ReadonlySet<ts.Type>): WebMCPInputSchema {
    if (ancestors.has(type)) throw new Error(`Recursive input type: ${checker.typeToString(type)}`);
    const nested = new Set([...ancestors, type]);
    if (type.isStringLiteral() || type.isNumberLiteral()) return { const: type.value };
    if (type.flags & ts.TypeFlags.BooleanLiteral) return { const: checker.typeToString(type) === "true" };
    if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
    if (type.flags & ts.TypeFlags.String) return { type: "string" };
    if (type.flags & ts.TypeFlags.Number) return { type: "number" };
    if (type.flags & ts.TypeFlags.Null) return { type: "null" };
    if (type.isUnion()) return { anyOf: type.types.map((member) => schema(member, nested)) };
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- A TypeScript array has exactly one element type.
    if (checker.isArrayType(type)) return { type: "array", items: schema(checker.getTypeArguments(type as ts.TypeReference)[0]!, nested) };
    if (type.flags & ts.TypeFlags.Object || type.isIntersection()) return objectSchema(type, nested, false);
    throw new Error(`Unsupported input type: ${checker.typeToString(type)}`);
  }

  function objectSchema(type: ts.Type, ancestors: ReadonlySet<ts.Type>, message: boolean): WebMCPInputSchema {
    if (!(type.flags & ts.TypeFlags.Object || type.isIntersection()) || checker.isTupleType(type)
      || ((type.getSymbol()?.flags ?? 0) & ts.SymbolFlags.Class) !== 0
      || checker.getIndexInfosOfType(type).length !== 0
      || type.getProperties().some((property) => property.getEscapedName().toString().startsWith("__@") || (property.flags & ts.SymbolFlags.Method) !== 0)
      || type.getCallSignatures().length !== 0 || type.getConstructSignatures().length !== 0
      || (type.isIntersection() && !type.types.every((member) => member.flags & ts.TypeFlags.Object))) {
      throw new Error(`Unsupported input type: ${checker.typeToString(type)}`);
    }
    const properties: Record<string, WebMCPInputSchema> = Object.create(null) as Record<string, WebMCPInputSchema>;
    const required: Array<string> = [];
    for (const field of type.getProperties()) {
      if (message && (field.name === "type" || field.name === "invocation")) continue;
      const value = checker.getTypeOfSymbolAtLocation(field, field.valueDeclaration ?? location);
      const optional = Boolean(field.flags & ts.SymbolFlags.Optional);
      properties[field.name] = schema(value, ancestors);
      if (!optional) required.push(field.name);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
}
