const sideEffectGlobals = [
  "fetch",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "document",
  "window",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "crypto",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  "navigator",
  "location",
  "history",
  "performance",
  "console",
];

const boundaryMessage =
  "Unmanaged side effects belong in a declared effect adapter. Add the file to effectFiles, or use a narrow disable with a reason when the exception is genuinely local.";

const fixedSideEffectSyntax = [
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: boundaryMessage,
  },
  {
    selector: "MemberExpression[object.object.name='globalThis'][object.property.name='Date']",
    message: boundaryMessage,
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message: boundaryMessage,
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message: boundaryMessage,
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: boundaryMessage,
  },
  {
    selector: "MemberExpression[object.object.name='globalThis'][object.property.name='Math'][property.name='random']",
    message: boundaryMessage,
  },
  {
    selector: "CallExpression[callee.property.name=/^(addEventListener|removeEventListener)$/]",
    message: boundaryMessage,
  },
];

function sideEffectRules(allowedGlobals, extraRestrictedSyntax) {
  const restrictedGlobals = sideEffectGlobals.filter((name) => !allowedGlobals.includes(name));
  const qualifiedSideEffectNames = restrictedGlobals.join("|");
  const qualifiedSyntax =
    restrictedGlobals.length === 0
      ? []
      : [
          {
            selector: `MemberExpression[object.name='globalThis'][computed=false][property.name=/^(${qualifiedSideEffectNames})$/]`,
            message: boundaryMessage,
          },
          {
            selector: `MemberExpression[object.name='globalThis'][computed=true][property.value=/^(${qualifiedSideEffectNames})$/]`,
            message: boundaryMessage,
          },
        ];

  return {
    "no-restricted-globals": [
      "error",
      ...restrictedGlobals.map((name) => ({ name, message: boundaryMessage })),
    ],
    "no-restricted-syntax": [
      "error",
      ...qualifiedSyntax,
      ...fixedSideEffectSyntax,
      ...extraRestrictedSyntax,
    ],
  };
}

/**
 * Build flat ESLint config entries for ordinary Hypertea application modules.
 * Files listed in effectFiles are explicit side-effect boundaries and are not
 * subject to these rules.
 *
 * @param {{ files: string[], effectFiles?: string[], allowedGlobals?: string[], extraRestrictedSyntax?: Array<{ selector: string, message: string }> }} options
 * @returns {import("eslint").Linter.Config[]}
 */
export function hyperteaPurity({
  files,
  effectFiles = [],
  allowedGlobals = [],
  extraRestrictedSyntax = [],
}) {
  if (files.length === 0) {
    throw new Error("hyperteaPurity requires at least one file pattern");
  }

  const configs = [
    {
      name: "@pairshaped/hypertea/purity",
      files,
      ...(effectFiles.length > 0 ? { ignores: effectFiles } : {}),
      linterOptions: {
        reportUnusedDisableDirectives: "error",
      },
      rules: sideEffectRules(allowedGlobals, extraRestrictedSyntax),
    },
  ];

  if (effectFiles.length > 0) {
    configs.push({
      name: "@pairshaped/hypertea/effect-adapters",
      files: effectFiles,
    });
  }

  return configs;
}
