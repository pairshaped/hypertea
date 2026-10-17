import type { Linter } from "eslint";

/** @public Part of the package boundary documented in README.md. */
export type HyperteaPurityOptions = {
  files: string[];
  effectFiles?: string[];
  allowedGlobals?: string[];
  extraRestrictedSyntax?: Array<{
    selector: string;
    message: string;
  }>;
};

/** @public Part of the package boundary documented in README.md. */
export declare function hyperteaPurity(options: HyperteaPurityOptions): Linter.Config[];
