import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  type OrchestrationV2ServerCommand,
  type ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";

import * as ServerConfig from "../config.ts";
import * as GitManager from "../git/GitManager.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as BotService from "./BotService.ts";

type ThreadManagementApi = ThreadManagement.ThreadManagementService["Service"];

interface Harness {
  readonly baseDir: string;
  readonly launches: Array<ThreadLaunch.ThreadLaunchInput>;
  readonly commands: Array<OrchestrationV2ServerCommand>;
  /** What the fake Codex reports as its saved image. */
  generatedImagePath: string;
  /** The project the fake calling thread belongs to. */
  threadProjectId: ProjectId | undefined;
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const layerEnrichment = ProjectEnrichmentService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        invalidate: () => Effect.void,
        resolvePath: () => Effect.succeed(null),
      }),
    ),
  ),
);

const layerGitWorkflow = GitWorkflow.layer.pipe(
  Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provide(Layer.mock(GitManager.GitManager)({})),
);

const layerFakes = (harness: Harness) =>
  Layer.mergeAll(
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (input) =>
        Effect.sync(() => {
          harness.launches.push(input);
          return {
            threadId: input.threadId ?? ThreadId.make("unused"),
            projection: {} as ThreadLaunch.ThreadLaunchResult["projection"],
            resumed: false,
          };
        }),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      dispatch: (command) =>
        Effect.sync(() => {
          harness.commands.push(command);
          return {} as Effect.Success<ReturnType<ThreadManagementApi["dispatch"]>>;
        }),
      getThreadShell: (threadId) =>
        Effect.sync(() =>
          harness.threadProjectId === undefined
            ? null
            : ({ id: threadId, projectId: harness.threadProjectId } as Effect.Success<
                ReturnType<ThreadManagementApi["getThreadShell"]>
              >),
        ),
    }),
    Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      listInstances: Effect.sync(() => [
        // Only the fields BotService reads.
        {
          instanceId: ProviderInstanceId.make("codex"),
          driverKind: ProviderDriverKind.make("codex"),
          enabled: true,
          snapshot: { getSnapshot: Effect.succeed({ models: [{ slug: "gpt-test" }] }) },
          textGeneration: {
            generateImage: () => Effect.sync(() => ({ imagePath: harness.generatedImagePath })),
          },
        } as unknown as ProviderInstance,
      ]),
    }),
  );

const layer = (harness: Harness) =>
  BotService.layer.pipe(
    Layer.provide(layerFakes(harness)),
    Layer.provideMerge(RuntimeLayer.layerProjectService),
    Layer.provideMerge(layerEnrichment),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(layerGitWorkflow),
    Layer.provideMerge(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(harness.baseDir, harness.baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );

const withBots = <A, E>(
  body: (
    harness: Harness,
  ) => Effect.Effect<
    A,
    E,
    BotService.BotService | ProjectService.ProjectService | NodeServices.NodeServices | Scope.Scope
  >,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const harness: Harness = {
      baseDir: yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-bots-" }),
      launches: [],
      commands: [],
      generatedImagePath: "",
      threadProjectId: undefined,
    };
    return yield* body(harness).pipe(Effect.provide(layer(harness)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const createBot = (name: string, commandId: string) =>
  BotService.BotService.pipe(
    Effect.flatMap((bots) =>
      bots.create({
        commandId: CommandId.make(commandId),
        name,
        avatar: { shape: "star", color: "teal" },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-test" },
      }),
    ),
  );

const readProject = (projectId: ProjectId) =>
  ProjectService.ProjectService.pipe(
    Effect.flatMap((projects) => projects.getById(projectId)),
    Effect.map(Option.getOrThrow),
  );

it.effect("creates a bot as a project in its own folder with one always-on session", () =>
  withBots((harness) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const first = yield* createBot("Research Pal", "bot-1");
      const second = yield* createBot("Research Pal", "bot-2");

      const project = yield* readProject(first.projectId);
      assert.equal(project.workspaceRoot, path.resolve(harness.baseDir, "bots", "research-pal"));
      assert.deepEqual(project.bot, {
        threadId: first.threadId,
        avatar: { shape: "star", color: "teal", imagePath: null },
        description: null,
      });
      assert.equal(
        (yield* readProject(second.projectId)).workspaceRoot,
        path.resolve(harness.baseDir, "bots", "research-pal-2"),
      );
      assert.isTrue(yield* fileSystem.exists(path.join(project.workspaceRoot, "artifacts")));
      assert.include(
        yield* fileSystem.readFileString(path.join(project.workspaceRoot, "AGENTS.md")),
        "t3_bot_update",
      );

      const launch = harness.launches[0];
      assert.equal(launch?.threadId, first.threadId);
      assert.equal(launch?.projectId, first.projectId);
      assert.equal(launch?.runtimeMode, "full-access");
      assert.isTrue((launch?.initialMessage?.text.length ?? 0) > 0);
      assert.deepInclude(harness.commands, {
        type: "thread.auto-settle.set",
        commandId: CommandId.make("bot-1:auto-settle"),
        threadId: first.threadId,
        enabled: false,
      });
    }),
  ),
);

it.effect("keeps a generated avatar when only the shape changes", () =>
  withBots((harness) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const bots = yield* BotService.BotService;
      const { projectId } = yield* createBot("Painter", "bot-paint");

      const generatedDir = path.join(harness.baseDir, "codex", "generated_images", "session");
      yield* fileSystem.makeDirectory(generatedDir, { recursive: true });
      harness.generatedImagePath = path.join(generatedDir, "exec-1.png");
      yield* fileSystem.writeFile(harness.generatedImagePath, PNG_BYTES);
      const { imagePath } = yield* bots.generateAvatar({ projectId });

      const project = yield* readProject(projectId);
      assert.match(imagePath, /^avatars\/\d+\.png$/);
      assert.isTrue(yield* fileSystem.exists(path.join(project.workspaceRoot, imagePath)));
      assert.equal(project.bot?.avatar.imagePath, imagePath);

      yield* bots.update({ projectId, avatar: { shape: "heart", color: "red" } });
      assert.deepEqual((yield* readProject(projectId)).bot?.avatar, {
        shape: "heart",
        color: "red",
        imagePath,
      });
      yield* bots.update({ projectId, avatar: { shape: "heart", color: "red", imagePath: null } });
      assert.equal((yield* readProject(projectId)).bot?.avatar.imagePath, null);
    }),
  ),
);

it.effect("refuses a generated image path outside Codex's generated images", () =>
  withBots((harness) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const bots = yield* BotService.BotService;
      const { projectId } = yield* createBot("Painter", "bot-escape");
      harness.generatedImagePath = path.join(harness.baseDir, "secret.png");
      yield* fileSystem.writeFile(harness.generatedImagePath, PNG_BYTES);

      const error = yield* Effect.flip(bots.generateAvatar({ projectId }));
      assert.equal(error.message, "Codex did not return a generated image.");
      assert.equal((yield* readProject(projectId)).bot?.avatar.imagePath, null);
    }),
  ),
);

it.effect("lets only the bot's own session edit its profile", () =>
  withBots((harness) =>
    Effect.gen(function* () {
      const bots = yield* BotService.BotService;
      const { projectId, threadId } = yield* createBot("Scout", "bot-scout");
      harness.threadProjectId = projectId;

      const stranger = yield* Effect.flip(
        bots.updateProfile({ threadId: ThreadId.make("another-thread"), description: "Hijacked" }),
      );
      assert.equal(stranger.message, "This thread is not a bot's session.");

      yield* bots.updateProfile({ threadId, description: "Finds flights.", name: "Flight Scout" });
      const project = yield* readProject(projectId);
      assert.equal(project.bot?.description, "Finds flights.");
      assert.equal(project.title, "Flight Scout");
      const rename = harness.commands.find((command) => command.type === "thread.metadata.update");
      assert.equal(rename?.threadId, threadId);
      assert.equal(rename?.type === "thread.metadata.update" ? rename.title : null, "Flight Scout");
    }),
  ),
);
