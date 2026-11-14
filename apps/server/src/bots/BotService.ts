import {
  type BotCreateInput,
  type BotCreateResult,
  type BotDeleteInput,
  BotError,
  type BotGenerateAvatarInput,
  type BotGenerateAvatarResult,
  type BotMutationResult,
  BotPreview,
  type BotPreviewsResult,
  type BotUpdateInput,
  CommandId,
  type ModelSelection,
  type Project,
  type ProjectBot,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { newProjectFolderName } from "@t3tools/shared/path";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import { indexedMessageCondition } from "../orchestration-v2/messageSearchIndex.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

export interface BotProfileUpdateInput {
  readonly threadId: ThreadId;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
}

export class BotService extends Context.Service<
  BotService,
  {
    readonly create: (input: BotCreateInput) => Effect.Effect<BotCreateResult, BotError>;
    readonly update: (input: BotUpdateInput) => Effect.Effect<BotMutationResult, BotError>;
    readonly delete: (input: BotDeleteInput) => Effect.Effect<BotMutationResult, BotError>;
    readonly generateAvatar: (
      input: BotGenerateAvatarInput,
    ) => Effect.Effect<BotGenerateAvatarResult, BotError>;
    /** The bot's own agent edits its profile from inside its thread. */
    readonly updateProfile: (
      input: BotProfileUpdateInput,
    ) => Effect.Effect<BotMutationResult, BotError>;
    readonly previews: () => Effect.Effect<BotPreviewsResult, BotError>;
  }
>()("t3/bots/BotService") {}

const MAX_FOLDER_ATTEMPTS = 100;
const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024;
const AVATAR_SIZE_PX = 256;

function botInstructions(name: string): string {
  return [
    `# ${name}`,
    "",
    `You are ${name}, a personal bot in T3 Code. This thread is your single long-lived session with the user, and this folder is your home.`,
    "",
    "- Save files you make for the user in `artifacts/`. The user browses them in your Artifacts tab.",
    "- Keep notes, memory and scripts anywhere else in this folder.",
    "- Routines: create them with `schedule_task`, which runs them in this thread. For a one-time routine, delete the task after it runs.",
    "- Other machines: `t3_environment_links` lists the linked machines you can work on.",
    "- Profile: call `t3_bot_update` to set your description, one or two sentences on what you do for the user. Update it when your job changes. Change your name only when the user asks.",
    "",
    "## First conversation",
    "",
    "Greet the user, ask a few short questions about what they want you to do, then set your description.",
    "",
  ].join("\n");
}

const kickoffMessage = (name: string) =>
  `Hi ${name}. Ask me a few questions about what you'll be doing for me, then write your description.`;

const isImageBytes = (bytes: Uint8Array) => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  return (
    startsWith(0x89, 0x50, 0x4e, 0x47) ||
    startsWith(0xff, 0xd8, 0xff) ||
    (startsWith(0x52, 0x49, 0x46, 0x46) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50)
  );
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const projects = yield* ProjectService.ProjectService;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const providers = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const sql = yield* SqlClient.SqlClient;

  // Bot edits read the stored record and write it back whole; serialize them.
  const mutations = yield* Semaphore.make(1);
  // Creation is rare; one at a time keeps a retry from racing its original.
  const creations = yield* Semaphore.make(1);
  const botsRoot = path.resolve(config.baseDir, "bots");

  const fail = (message: string, projectId?: ProjectId) => (cause: unknown) =>
    new BotError({
      message,
      ...(projectId === undefined ? {} : { projectId }),
      cause,
    });

  const newCommandId = (prefix: string) =>
    random.uuidV4().pipe(
      Effect.map((uuid) => CommandId.make(`${prefix}:${uuid}`)),
      Effect.mapError(fail("Could not allocate an id.")),
    );

  const readBot = Effect.fn("BotService.readBot")(function* (projectId: ProjectId) {
    const project = yield* projects
      .getById(projectId)
      .pipe(Effect.mapError(fail("Could not read the bot.", projectId)));
    if (Option.isNone(project) || project.value.bot == null) {
      return yield* new BotError({ message: "The bot was not found.", projectId });
    }
    return { project: project.value, bot: project.value.bot };
  });

  const writeBot = Effect.fn("BotService.writeBot")(function* (input: {
    readonly project: Project;
    readonly bot: ProjectBot;
    readonly title?: string;
  }) {
    const projectId = input.project.id;
    yield* projects
      .update({
        commandId: yield* newCommandId("bot-update"),
        projectId,
        bot: input.bot,
        ...(input.title === undefined ? {} : { title: input.title }),
      })
      .pipe(Effect.mapError((error) => fail(error.message, projectId)(error)));
    if (input.title !== undefined && input.title !== input.project.title) {
      yield* threads
        .dispatch({
          type: "thread.metadata.update",
          commandId: yield* newCommandId("bot-rename"),
          threadId: input.bot.threadId,
          title: input.title,
        })
        .pipe(Effect.mapError(fail("Could not rename the bot's thread.", projectId)));
    }
    return { projectId };
  });

  // Non-recursive mkdir claims a folder name atomically.
  const claimFolder = Effect.fn("BotService.claimFolder")(function* (name: string) {
    yield* fileSystem
      .makeDirectory(botsRoot, { recursive: true })
      .pipe(Effect.mapError(fail("Could not create the bots folder.")));
    const base = newProjectFolderName(name);
    for (let attempt = 1; attempt <= MAX_FOLDER_ATTEMPTS; attempt++) {
      const folder = path.join(botsRoot, attempt === 1 ? base : `${base}-${attempt}`);
      const claimed = yield* fileSystem.makeDirectory(folder).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.reason._tag === "AlreadyExists",
          () => Effect.succeed(false),
        ),
        Effect.mapError(fail("Could not create the bot's folder.")),
      );
      if (claimed) return folder;
    }
    return yield* new BotError({ message: `Every folder name for "${base}" is taken.` });
  });

  const scaffoldFolder = Effect.fn("BotService.scaffoldFolder")(function* (
    folder: string,
    name: string,
  ) {
    yield* fileSystem.makeDirectory(path.join(folder, "artifacts"));
    yield* fileSystem.writeFileString(path.join(folder, "AGENTS.md"), botInstructions(name));
    yield* fileSystem.writeFileString(path.join(folder, "CLAUDE.md"), "@AGENTS.md\n");
  });

  const createOnce = Effect.fn("BotService.createOnce")(function* (input: BotCreateInput) {
    const projectId = ProjectId.make(input.commandId);
    // A retried create returns the bot it already made instead of building a second one.
    const existing = yield* projects
      .getById(projectId, { includeDeleted: true })
      .pipe(Effect.mapError(fail("Could not read the bot.", projectId)));
    if (Option.isSome(existing)) {
      const bot = existing.value.bot;
      if (existing.value.deletedAt !== null || bot == null) {
        return yield* new BotError({ message: "This request was already used.", projectId });
      }
      return { projectId, threadId: bot.threadId };
    }

    // Claim the folder and arm its cleanup together, so an interrupt between them cannot leak it.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const folder = yield* claimFolder(input.name);
        return yield* restore(setUp(input, folder)).pipe(
          Effect.onExit((exit) => (Exit.isFailure(exit) ? rollback(input, folder) : Effect.void)),
        );
      }),
    );
  });

  // The folder was claimed by this attempt, so only this attempt's project can own it.
  const rollback = Effect.fn("BotService.rollback")(function* (
    input: BotCreateInput,
    folder: string,
  ) {
    const projectId = ProjectId.make(input.commandId);
    const owner = yield* projects.getByWorkspaceRoot(folder).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined),
    );
    if (owner !== undefined) {
      if (owner.id !== projectId) return;
      const deleted = yield* projects
        .delete({
          commandId: CommandId.make(`${input.commandId}:rollback`),
          projectId,
          force: true,
        })
        .pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
      if (!deleted) return;
    }
    yield* fileSystem.remove(folder, { recursive: true }).pipe(Effect.ignore);
  });

  const setUp = Effect.fn("BotService.setUp")(function* (input: BotCreateInput, folder: string) {
    const projectId = ProjectId.make(input.commandId);
    const threadId = ThreadId.make(input.commandId);
    yield* scaffoldFolder(folder, input.name).pipe(
      Effect.mapError(fail("Could not set up the bot's folder.")),
    );
    // Its own repository keeps checkpoints out of any checkout the data dir lives in.
    yield* git
      .execute({
        operation: "BotService.init",
        cwd: folder,
        args: ["init", "--quiet"],
        timeoutMs: 10_000,
      })
      .pipe(Effect.mapError(fail("Could not create the bot's repository.")));
    yield* projects
      .create({
        commandId: CommandId.make(`${input.commandId}:project`),
        projectId,
        title: input.name,
        workspaceRoot: folder,
        bot: {
          threadId,
          avatar: { shape: input.avatar.shape, color: input.avatar.color, imagePath: null },
          description: null,
        },
      })
      .pipe(Effect.mapError((error) => fail(error.message)(error)));
    yield* launches
      .launch({
        commandId: CommandId.make(`${input.commandId}:thread`),
        threadId,
        projectId,
        title: input.name,
        modelSelection: input.modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
        initialMessage: { text: kickoffMessage(input.name), attachments: [] },
        createdBy: "user",
        creationSource: "server",
      })
      .pipe(
        Effect.mapError((error) => fail("Could not start the bot's session.", projectId)(error)),
      );
    // Settled threads drop out of shell snapshots; a bot's session stays in view.
    yield* threads
      .dispatch({
        type: "thread.auto-settle.set",
        commandId: CommandId.make(`${input.commandId}:auto-settle`),
        threadId,
        enabled: false,
      })
      .pipe(Effect.ignore);
    return { projectId, threadId };
  });

  const create: BotService["Service"]["create"] = (input) =>
    creations.withPermits(1)(createOnce(input));

  const update: BotService["Service"]["update"] = Effect.fn("BotService.update")(function* (input) {
    return yield* mutations.withPermits(1)(
      Effect.gen(function* () {
        const { project, bot } = yield* readBot(input.projectId);
        return yield* writeBot({
          project,
          bot: {
            ...bot,
            ...(input.avatar === undefined
              ? {}
              : {
                  avatar: {
                    shape: input.avatar.shape,
                    color: input.avatar.color,
                    imagePath:
                      input.avatar.imagePath === undefined
                        ? (bot.avatar.imagePath ?? null)
                        : input.avatar.imagePath,
                  },
                }),
            ...(input.description === undefined ? {} : { description: input.description }),
          },
          ...(input.name === undefined ? {} : { title: input.name }),
        });
      }),
    );
  });

  const updateProfile: BotService["Service"]["updateProfile"] = Effect.fn(
    "BotService.updateProfile",
  )(function* (input) {
    const shell = yield* threads
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError(fail("Could not read the calling thread.")));
    if (shell === null)
      return yield* new BotError({ message: "The calling thread was not found." });
    return yield* mutations.withPermits(1)(
      Effect.gen(function* () {
        const { project, bot } = yield* readBot(shell.projectId).pipe(
          Effect.filterOrFail(
            ({ bot }) => bot.threadId === input.threadId,
            () => new BotError({ message: "This thread is not a bot's session." }),
          ),
        );
        return yield* writeBot({
          project,
          bot: input.description === undefined ? bot : { ...bot, description: input.description },
          ...(input.name === undefined ? {} : { title: input.name }),
        });
      }),
    );
  });

  const remove: BotService["Service"]["delete"] = Effect.fn("BotService.delete")(function* (input) {
    yield* readBot(input.projectId);
    yield* projects
      .delete({
        commandId: yield* newCommandId("bot-delete"),
        projectId: input.projectId,
        force: true,
      })
      .pipe(Effect.mapError((error) => fail(error.message, input.projectId)(error)));
    return { projectId: input.projectId };
  });

  const resolveImageGenerator = Effect.fn("BotService.resolveImageGenerator")(function* () {
    const codex = ProviderDriverKind.make("codex");
    const preferred = yield* settings.getSettings.pipe(
      Effect.map((current) => current.textGenerationModelSelection),
      Effect.orElseSucceed(() => undefined),
    );
    const candidates = (yield* providers.listInstances).filter(
      (instance) =>
        instance.driverKind === codex &&
        instance.enabled &&
        instance.textGeneration.generateImage !== undefined,
    );
    const instance =
      candidates.find((candidate) => candidate.instanceId === preferred?.instanceId) ??
      candidates[0];
    const generateImage = instance?.textGeneration.generateImage;
    if (instance === undefined || generateImage === undefined) {
      return yield* new BotError({ message: "Avatar generation needs Codex." });
    }
    const snapshot = yield* instance.snapshot.getSnapshot;
    const model =
      preferred?.instanceId === instance.instanceId ? preferred.model : snapshot.models[0]?.slug;
    if (model === undefined) {
      return yield* new BotError({ message: "Codex has no model available." });
    }
    // Codex saves images under <CODEX_HOME>/generated_images; the shadow home is the one it runs with.
    const imageRoots = [snapshot.runtimePaths?.homePath, snapshot.runtimePaths?.shadowHomePath]
      .filter((home): home is string => typeof home === "string")
      .map((home) => path.join(home, "generated_images"));
    const modelSelection: ModelSelection = { instanceId: instance.instanceId, model };
    return { generateImage, modelSelection, imageRoots };
  });

  // The path comes from model output: accept only an image Codex saved itself.
  const readGeneratedImage = Effect.fn("BotService.readGeneratedImage")(function* (
    imagePath: string,
    imageRoots: ReadonlyArray<string>,
    projectId: ProjectId,
  ) {
    const invalid = new BotError({
      message: "Codex did not return a generated image.",
      projectId,
    });
    if (!path.isAbsolute(imagePath)) return yield* invalid;
    const real = yield* fileSystem.realPath(imagePath).pipe(Effect.mapError(() => invalid));
    const realRoots = yield* Effect.forEach(imageRoots, (root) =>
      fileSystem.realPath(root).pipe(Effect.option),
    );
    const contained = realRoots.some((root) => {
      if (Option.isNone(root)) return false;
      const relative = path.relative(root.value, real);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
    if (!contained || !/\.(png|jpe?g|webp)$/i.test(real)) return yield* invalid;
    const info = yield* fileSystem.stat(real).pipe(Effect.mapError(() => invalid));
    if (info.type !== "File" || Number(info.size) > MAX_GENERATED_IMAGE_BYTES) {
      return yield* invalid;
    }
    const bytes = yield* fileSystem.readFile(real).pipe(Effect.mapError(() => invalid));
    if (!isImageBytes(bytes)) return yield* invalid;
    return { real, bytes, extension: path.extname(real).slice(1).toLowerCase() };
  });

  const generateAvatar: BotService["Service"]["generateAvatar"] = Effect.fn(
    "BotService.generateAvatar",
  )(function* (input) {
    const { project } = yield* readBot(input.projectId);
    const { generateImage, modelSelection, imageRoots } = yield* resolveImageGenerator();
    const prompt = [
      `Use your image generation tool to create one square avatar image for a personal assistant bot named "${project.title}".`,
      input.prompt === undefined
        ? "Make it a simple, friendly, iconic character on a plain background."
        : `The user describes it as: ${input.prompt}`,
      "No text or letters in the image.",
      "Then reply with the absolute path of the saved image file as imagePath.",
    ].join("\n");
    const generated = yield* generateImage({
      cwd: project.workspaceRoot,
      prompt,
      modelSelection,
    }).pipe(Effect.mapError((error) => fail(error.message, input.projectId)(error)));
    const image = yield* readGeneratedImage(generated.imagePath, imageRoots, input.projectId);

    const avatarsDir = path.join(project.workspaceRoot, "avatars");
    const stamp = DateTime.formatIso(yield* DateTime.now).replace(/[^0-9]/g, "");
    const relativePath = `avatars/${stamp}.png`;
    const target = path.join(project.workspaceRoot, relativePath);
    const saveFailed = fail("Could not save the avatar.", input.projectId);
    yield* fileSystem
      .makeDirectory(avatarsDir, { recursive: true })
      .pipe(Effect.mapError(saveFailed));
    // Generated images are ~1.5MB; a sidebar avatar should be a few KB. sips ships with macOS.
    const resized =
      (yield* HostProcess.Platform) === "darwin"
        ? yield* spawner
            .exitCode(
              ChildProcess.make("sips", [
                "-s",
                "format",
                "png",
                "-Z",
                String(AVATAR_SIZE_PX),
                image.real,
                "--out",
                target,
              ]),
            )
            .pipe(
              Effect.map((code) => code === 0),
              Effect.orElseSucceed(() => false),
            )
        : false;
    const imagePath = resized
      ? relativePath
      : `avatars/${stamp}.${image.extension === "jpeg" ? "jpg" : image.extension}`;
    if (!resized) {
      yield* fileSystem
        .writeFile(path.join(project.workspaceRoot, imagePath), image.bytes)
        .pipe(Effect.mapError(saveFailed));
    }

    yield* mutations.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* readBot(input.projectId);
        yield* writeBot({
          project: current.project,
          bot: { ...current.bot, avatar: { ...current.bot.avatar, imagePath } },
        });
      }),
    );
    return { imagePath };
  });

  const decodePreviews = Schema.decodeUnknownEffect(Schema.Array(BotPreview));

  // One indexed lookup per bot walks its thread backwards to the newest visible message,
  // so the cost stays flat as a bot's chat grows. Text is cut short; the list shows a line.
  const previews: BotService["Service"]["previews"] = Effect.fn("BotService.previews")(
    function* () {
      const rows = yield* sql`
        SELECT
          messages.thread_id AS "threadId",
          messages.role AS "role",
          substr(json_extract(messages.payload_json, '$.text'), 1, 400) AS "text",
          messages.updated_at AS "updatedAt"
        FROM orchestration_v2_projection_messages AS messages
        WHERE messages.message_id IN (
          SELECT (
            SELECT latest.message_id
            FROM orchestration_v2_projection_messages AS latest
            WHERE latest.thread_id = bots.thread_id
              AND ${indexedMessageCondition(sql, "latest")}
              -- The transcript hides rolled-back runs and cancelled queued messages.
              AND NOT EXISTS (
                SELECT 1 FROM orchestration_v2_projection_runs AS run
                WHERE run.run_id = latest.run_id
                  AND (
                    run.status = 'rolled_back'
                    OR (
                      run.status = 'cancelled'
                      AND latest.role = 'user'
                      AND EXISTS (
                        SELECT 1 FROM orchestration_v2_projection_turn_items AS item
                        WHERE item.thread_id = latest.thread_id
                          AND item.run_id = latest.run_id
                          AND item.type = 'user_message'
                          AND json_extract(item.payload_json, '$.messageId') = latest.message_id
                          AND json_extract(item.payload_json, '$.inputIntent') = 'queued_turn'
                      )
                    )
                  )
              )
            ORDER BY latest.created_at DESC, latest.message_id DESC
            LIMIT 1
          )
          FROM (
            SELECT json_extract(bot_json, '$.threadId') AS thread_id
            FROM projection_projects
            WHERE bot_json IS NOT NULL AND deleted_at IS NULL
          ) AS bots
        )
      `;
      return { previews: yield* decodePreviews(rows) };
    },
    Effect.mapError(fail("Could not read bot messages.")),
  );

  return BotService.of({
    create,
    update,
    delete: remove,
    generateAvatar,
    updateProfile,
    previews,
  });
});

export const layer = Layer.effect(BotService, make);
