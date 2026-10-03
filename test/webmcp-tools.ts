import { exposeMessages } from "../dist/webmcp.js";
import schemas from "./webmcp.generated.js";

export type CounterMsg =
  | Readonly<{ type: "add"; amount: number }>
  | Readonly<{ type: "save" }>;

export const mcpTools = exposeMessages<CounterMsg>([
  { message: "add", description: "Add a number between 1 and 10 to the visible counter" },
  { message: "save", description: "Simulate an async save of the visible counter in this example" },
], schemas);
