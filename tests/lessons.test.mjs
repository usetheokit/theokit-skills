import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLessons, LessonError } from "../lib/lessons.mjs";

/** node:assert's throws() returns undefined, so capture the error to assert on its fields. */
function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to throw");
}

test("parses one lesson and excludes its markers", () => {
  const source = [
    "const before = 1;",
    "// #region lesson:create-agent",
    "const agent = 2;",
    "// #endregion",
    "const after = 3;",
  ].join("\n");

  const lessons = parseLessons(source, "src/a.ts");

  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].id, "create-agent");
  assert.equal(lessons[0].file, "src/a.ts");
  assert.equal(lessons[0].startLine, 2);
  assert.equal(lessons[0].endLine, 4);
  assert.equal(lessons[0].code, "const agent = 2;");
});

test("keeps comments inside a lesson, because that is where the hard-won prose lives", () => {
  const source = [
    "// #region lesson:ask",
    "// TWO CALLS, not one. send() hands back a handle.",
    "const run = await agent.send(message);",
    "// #endregion",
  ].join("\n");

  const [lesson] = parseLessons(source, "src/a.ts");

  assert.match(lesson.code, /TWO CALLS, not one/);
});

test("a lesson that is never closed names the file and the opening line", () => {
  const source = ["// #region lesson:orphan", "const a = 1;"].join("\n");

  const error = captureError(() => parseLessons(source, "src/a.ts"));
  assert.ok(error instanceof LessonError);
  assert.equal(error.file, "src/a.ts");
  assert.equal(error.line, 1);
  assert.match(error.message, /orphan/);
});

test("a nested lesson is rejected, naming both ids", () => {
  const source = [
    "// #region lesson:outer",
    "// #region lesson:inner",
    "// #endregion",
    "// #endregion",
  ].join("\n");

  const error = captureError(() => parseLessons(source, "src/a.ts"));
  assert.ok(error instanceof LessonError);
  assert.match(error.message, /inner/);
  assert.match(error.message, /outer/);
});

test("an #endregion with no open lesson is rejected", () => {
  const error = captureError(() => parseLessons("// #endregion", "src/a.ts"));
  assert.ok(error instanceof LessonError);
  assert.equal(error.line, 1);
});

test("a non-kebab-case id is not recognised as a lesson marker", () => {
  assert.deepEqual(parseLessons("// #region lesson:Create_Agent", "src/a.ts"), []);
});

test("a CRLF source yields code with no stray carriage returns", () => {
  const source = ["// #region lesson:crlf", "const a = 1;", "const b = 2;", "// #endregion"].join("\r\n");

  const [lesson] = parseLessons(source, "src/a.ts");

  assert.equal(lesson.code, "const a = 1;\nconst b = 2;");
  assert.doesNotMatch(lesson.code, /\r/);
});

test("a marker lookalike inside a string fails loudly rather than truncating silently", () => {
  const source = [
    "// #region lesson:with-template",
    "const doc = `",
    "// #endregion",
    "`;",
    "// #endregion",
  ].join("\n");

  const error = captureError(() => parseLessons(source, "src/a.ts"));

  assert.ok(error instanceof LessonError);
  assert.match(error.message, /#endregion with no open lesson/);
});
