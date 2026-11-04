import {readJsonData,type WebMCPValue} from "./json-data.js";

/** Discovery text supplied by the trusted server render, alongside business flags. */
export type WebMCPDescriptionPacket = Readonly<{
  scope: string;
  language: "en" | "fr";
  binding: string;
  tools: Readonly<Record<string, Readonly<{ key: string; description: string }>>>;
}>;

/** Invalid discovery data never prevents the human Program from mounting. */
export function parseWebMCPDescriptions(value: unknown): WebMCPDescriptionPacket {
  const data = readJsonData(value, new Set<object>());
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("Invalid WebMCP description packet");
  const packet = data as Record<string, WebMCPValue>;
  const tools = packet.tools;
  if (typeof packet.scope !== "string" || packet.scope.length === 0 || packet.scope.length > 512
    || (packet.language !== "en" && packet.language !== "fr") || typeof packet.binding !== "string" || packet.binding.length === 0 || packet.binding.length > 8192
    || typeof tools !== "object" || tools === null || Array.isArray(tools) || Object.keys(tools).length > 64) throw new Error("Invalid WebMCP description packet");
  for (const [name, value] of Object.entries(tools)) {
    if (name.length === 0 || name.length > 128 || typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid WebMCP description packet");
    const entry = value as Readonly<Record<string, WebMCPValue>>;
    if (typeof entry.key !== "string" || entry.key.length === 0 || entry.key.length > 512
      || typeof entry.description !== "string" || entry.description.trim() === "" || entry.description.length > 12288) throw new Error("Invalid WebMCP description packet");
  }
  return data as unknown as WebMCPDescriptionPacket;
}


export type WebMCPDescriptions = ReadonlyArray<WebMCPDescriptionPacket>;

/** A composed island may host tools declared by more than one source. */
export function parseWebMCPDescriptionPackets(value: unknown): WebMCPDescriptions {
  if (!Array.isArray(value) || value.length > 16) throw new Error("Invalid WebMCP description packets");
  return value.map(parseWebMCPDescriptions);
}
