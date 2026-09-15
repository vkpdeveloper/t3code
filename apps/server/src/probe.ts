import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { runServer } from "./server.ts";
import * as ModelManifest from "./provider/ModelManifest.ts";

type ReqOf<T> =
  T extends Layer.Layer<infer _A, infer _E, infer R>
    ? R
    : T extends Effect.Effect<infer _A, infer _E, infer R>
      ? R
      : never;

type R = ReqOf<typeof runServer>;
export const probe = {} as R;
