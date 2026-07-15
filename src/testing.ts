import {
  mountProgram as mountProductionProgram,
  type Program,
  type ProgramEffect,
  type ProgramHandle,
  type ProgramMount,
  type ProgramMsg,
} from "./index.js";

export type PendingEffect<Msg extends ProgramMsg, Effect extends ProgramEffect> =
  Readonly<{
    effect: Effect;
    dispatch: (message: Msg) => void;
  }>;

export type TestProgramMount<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
> = Readonly<{
  flags: Flags;
  node: HTMLElement;
  program: Program<Flags, Model, Msg, Effect>;
}>;

export type TestProgramHandle<
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
> = ProgramHandle<Model, Msg> &
  Readonly<{
    effects: () => ReadonlyArray<PendingEffect<Msg, Effect>>;
    takeEffect: (index?: number) => PendingEffect<Msg, Effect> | undefined;
  }>;

export function mountProgram<
  Flags,
  Model,
  Msg extends ProgramMsg,
  Effect extends ProgramEffect,
>(
  options: TestProgramMount<Flags, Model, Msg, Effect>,
): TestProgramHandle<Model, Msg, Effect> {
  const pendingEffects: Array<PendingEffect<Msg, Effect>> = [];
  const mount = {
    ...options,
    runEffect: (dispatch: (message: Msg) => void, effect: Effect) => {
      pendingEffects.push(Object.freeze({ effect, dispatch }));
    },
  } as unknown as ProgramMount<Flags, Model, Msg, Effect>;
  const handle = mountProductionProgram(mount);

  return {
    ...handle,
    effects: () => Object.freeze([...pendingEffects]),
    takeEffect: (index = 0) => {
      if (index < 0 || index >= pendingEffects.length) {
        return undefined;
      }
      return pendingEffects.splice(index, 1)[0];
    },
  };
}

export type { ProgramHandle } from "./index.js";
