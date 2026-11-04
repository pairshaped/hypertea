export type WebMCPValue =
  | string
  | number
  | boolean
  // null is allowed at the JSON protocol boundary, not as runtime state.
  | null
  | ReadonlyArray<WebMCPValue>
  | Readonly<{ [key: string]: WebMCPValue; }>;

/** Inspect data descriptors without executing getters or custom JSON serialization. */
export function readJsonData(input: unknown, ancestors: Set<object>): WebMCPValue | undefined {
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
  if (typeof input !== "object" || ancestors.has(input)) return undefined;
  try {
    const array = Array.isArray(input);
    const prototype: unknown = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) return undefined;
    if (!Object.prototype.hasOwnProperty.call(descriptors, "toJSON") && (Object.getOwnPropertyDescriptor(Object.prototype, "toJSON") !== undefined
      || (array && Object.getOwnPropertyDescriptor(Array.prototype, "toJSON") !== undefined))) return undefined;
    ancestors.add(input);
    try {
      if (array) {
        const length: unknown = descriptors.length?.value;
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || Object.keys(descriptors).length !== length + 1) return undefined;
        const result: Array<WebMCPValue> = [];
        for (let index = 0; index < length; index++) {
          const entry = descriptors[String(index)];
          if (entry === undefined || !("value" in entry) || entry.enumerable !== true) return undefined;
          const value = readJsonData(entry.value, ancestors);
          if (value === undefined) return undefined;
          result.push(value);
        }
        return result;
      }
      const result: Record<string, WebMCPValue> = Object.create(null) as Record<string, WebMCPValue>;
      for (const [key, entry] of Object.entries(descriptors)) {
        if (!("value" in entry) || entry.enumerable !== true) return undefined;
        const value = readJsonData(entry.value, ancestors);
        if (value === undefined) return undefined;
        result[key] = value;
      }
      return result;
    } finally { ancestors.delete(input); }
  } catch { return undefined; }
}

