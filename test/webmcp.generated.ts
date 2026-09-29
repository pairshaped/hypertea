// Do not edit. Regenerate from the message type and exposeMessages allowlist.
import type { WebMCPInputSchema } from "@pairshaped/hypertea/webmcp";

export default {
  "add": {
    "type": "object",
    "properties": {
      "amount": {
        "type": "number"
      }
    },
    "required": [
      "amount"
    ],
    "additionalProperties": false
  },
  "save": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  }
} satisfies Readonly<Record<string, WebMCPInputSchema>>;
