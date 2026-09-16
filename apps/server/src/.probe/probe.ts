import * as Layer from "effect/Layer";
import * as ModelManifest from "../provider/ModelManifest.ts";
import { runServer } from "../server.ts";

// does runServer's R still contain ModelManifest?
type R = typeof runServer extends import("effect/Effect").Effect<infer _A, infer _E, infer R>
  ? R
  : never;
export const hasModelManifestInR: R extends ModelManifest.ModelManifest ? true : false =
  null as unknown as R extends ModelManifest.ModelManifest ? true : false;
