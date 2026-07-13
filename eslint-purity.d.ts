import type { Linter } from "eslint";

export type HyperteaPurityOptions = {
  files: string[];
  effectFiles?: string[];
  allowedGlobals?: string[];
  extraRestrictedSyntax?: Array<{
    selector: string;
    message: string;
  }>;
};

export declare function hyperteaPurity(options: HyperteaPurityOptions): Linter.Config[];
