/**
 * A lesson is the unit of teaching inside an example: the block of code that gets copied, byte for
 * byte, into the generated skill. Everything between the markers travels, comments included — an
 * example's doc comments record what a signature cannot, and paraphrasing them would lose the only
 * content here that no model could reproduce.
 *
 * The marker keeps the editor's `#region` syntax, so a lesson folds like any other region; what
 * says the block is a lesson rather than a fold is the `lesson:` namespace after it.
 */

const OPEN = /^\s*\/\/\s*#region\s+lesson:([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/;
const CLOSE = /^\s*\/\/\s*#endregion\s*$/;

export class LessonError extends Error {
  constructor(message, { file, line }) {
    super(`${file}:${line}: ${message}`);
    this.name = "LessonError";
    this.file = file;
    this.line = line;
  }
}

/**
 * Parse the lessons declared in one source file.
 *
 * An id that is not kebab-case does not match OPEN and is therefore not a lesson at all, rather
 * than a malformed one. The manifest cross-check in `example-contract.mjs` is what turns a typo
 * into a named error: the id it declares will have no match here.
 */
export function parseLessons(source, file) {
  const lessons = [];
  let open = null;

  source.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;

    const opened = OPEN.exec(text);
    if (opened !== null) {
      const id = opened[1];
      if (open !== null) {
        throw new LessonError(`lesson "${id}" opens inside lesson "${open.id}"`, { file, line });
      }
      open = { id, startLine: line, body: [] };
      return;
    }

    if (CLOSE.test(text)) {
      if (open === null) {
        throw new LessonError("#endregion with no open lesson", { file, line });
      }
      lessons.push({
        id: open.id,
        file,
        startLine: open.startLine,
        endLine: line,
        code: open.body.join("\n"),
      });
      open = null;
      return;
    }

    if (open !== null) open.body.push(text);
  });

  if (open !== null) {
    throw new LessonError(`lesson "${open.id}" is never closed`, { file, line: open.startLine });
  }

  return lessons;
}
