import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  buildDevinElicitationAcceptResponse,
  DevinElicitationRequest,
  extractDevinElicitationQuestions,
  extractDevinPermissionCommand,
  selectDevinPermissionOptionId,
} from "./DevinAcpExtension.ts";

const decodeRequest = Schema.decodeUnknownSync(DevinElicitationRequest);

// Captured from devin 3000.10.21 after asking it to use ask_user_question.
const COLOR_REQUEST = decodeRequest({
  mode: "form",
  sessionId: "tarry-generation",
  message: "Which color do you prefer?",
  requestedSchema: {
    type: "object",
    required: ["q0"],
    properties: {
      q0: {
        type: "string",
        title: "Color preference",
        description: "Which color do you prefer?",
        oneOf: [
          { const: "Red", title: "The color red" },
          { const: "Green", title: "The color green" },
          { const: "Blue", title: "The color blue" },
        ],
      },
    },
  },
  _meta: { "cognition.ai/allowOther": true },
});

describe("extractDevinElicitationQuestions", () => {
  it("maps a oneOf form property onto a single-select question with a custom answer", () => {
    const questions = extractDevinElicitationQuestions(COLOR_REQUEST);
    expect(questions).toEqual([
      {
        id: "q0",
        header: "Color preference",
        question: "Which color do you prefer?",
        options: [
          { label: "Red", description: "The color red", value: "Red" },
          { label: "Green", description: "The color green", value: "Green" },
          { label: "Blue", description: "The color blue", value: "Blue" },
        ],
        allowCustomAnswer: true,
        multiSelect: false,
      },
    ]);
  });

  it("uses enum choices, array properties, and the message as fallbacks", () => {
    const questions = extractDevinElicitationQuestions(
      decodeRequest({
        sessionId: "s",
        message: "Pick tools",
        requestedSchema: {
          properties: {
            tools: { type: "array", enum: ["bun", "pnpm", 3] },
            note: { type: "string" },
          },
        },
      }),
    );
    expect(questions.map((question) => question.id)).toEqual(["tools", "note"]);
    expect(questions[0]).toMatchObject({
      header: "Question",
      question: "Pick tools",
      multiSelect: true,
      allowCustomAnswer: false,
    });
    expect(questions[0]?.options.map((option) => option.value)).toEqual(["bun", "pnpm", "3"]);
    // A free-form property has no options, so the user must be able to type.
    expect(questions[1]).toMatchObject({ options: [], allowCustomAnswer: true });
  });

  it("asks a single free-form question when the schema has no properties", () => {
    const questions = extractDevinElicitationQuestions(
      decodeRequest({ sessionId: "s", message: "What should the branch be called?" }),
    );
    expect(questions).toEqual([
      {
        id: "answer",
        header: "Question",
        question: "What should the branch be called?",
        options: [],
        allowCustomAnswer: true,
        multiSelect: false,
      },
    ]);
  });
});

describe("buildDevinElicitationAcceptResponse", () => {
  it("returns answers keyed by the schema property", () => {
    const questions = extractDevinElicitationQuestions(COLOR_REQUEST);
    expect(
      buildDevinElicitationAcceptResponse(questions, { q0: "Blue", unrelated: "ignored" }),
    ).toEqual({ action: "accept", content: { q0: "Blue" } });
    expect(buildDevinElicitationAcceptResponse(questions, { q0: ["Red", 2] })).toEqual({
      action: "accept",
      content: { q0: ["Red", "2"] },
    });
    expect(buildDevinElicitationAcceptResponse(questions, {})).toEqual({
      action: "accept",
      content: {},
    });
  });
});

// Captured from devin 3000.10.21 for a mutating shell command in Code mode.
const SHELL_PERMISSION_REQUEST = {
  sessionId: "dull-cupboard",
  toolCall: {
    toolCallId: "call_0c483bd1aa8b4f6c9fdcebaa",
    _meta: { "cognition.ai/editableCommand": "mkdir -p out && date > out/stamp.txt" },
  },
  options: [
    { optionId: "allow_once", name: "Allow", kind: "allow_once" as const },
    {
      optionId: "switch_bypass",
      name: "Yes, switch to bypass mode",
      kind: "allow_always" as const,
    },
    { optionId: "reject_once", name: "Reject", kind: "reject_once" as const },
  ],
};

describe("selectDevinPermissionOptionId", () => {
  it("answers with Devin's own option ids by kind", () => {
    expect(selectDevinPermissionOptionId(SHELL_PERMISSION_REQUEST, "accept")).toBe("allow_once");
    expect(selectDevinPermissionOptionId(SHELL_PERMISSION_REQUEST, "acceptForSession")).toBe(
      "switch_bypass",
    );
    expect(selectDevinPermissionOptionId(SHELL_PERMISSION_REQUEST, "decline")).toBe("reject_once");
  });

  it("falls back across allow kinds and reports missing reject options", () => {
    const allowOnly = { options: SHELL_PERMISSION_REQUEST.options.slice(0, 1) };
    expect(selectDevinPermissionOptionId(allowOnly, "acceptForSession")).toBe("allow_once");
    expect(selectDevinPermissionOptionId(allowOnly, "decline")).toBeUndefined();
  });
});

describe("extractDevinPermissionCommand", () => {
  it("reads the editable command Devin attaches to the permission request", () => {
    expect(extractDevinPermissionCommand(SHELL_PERMISSION_REQUEST)).toBe(
      "mkdir -p out && date > out/stamp.txt",
    );
    expect(
      extractDevinPermissionCommand({ toolCall: { toolCallId: "x", _meta: { other: 1 } } }),
    ).toBeUndefined();
    expect(extractDevinPermissionCommand({ toolCall: { toolCallId: "x" } })).toBeUndefined();
  });
});
