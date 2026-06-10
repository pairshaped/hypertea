export type Effect<Msg> = {
  readonly kind: "none";
  readonly messages?: ReadonlyArray<Msg>;
};

export function noEffect<Msg>(): Effect<Msg> {
  return { kind: "none" };
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(value)}`);
}
