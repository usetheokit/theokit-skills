/** The schema of `skill.json`, which is one half of the contract between the two repositories. */

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * What an example may claim to teach: a package of this ecosystem, optionally with a subpath.
 *
 * `theokit` is listed by name because the framework package carries no scope — a rule testing
 * `@theokit/` alone misses the one package a `framework` example teaches most.
 */
const TEACHES = /^(?:theokit|@theokit\/[a-z0-9-]+|@usetheo\/[a-z0-9-]+)(?:\/[a-z0-9-]+)*$/;

export class ManifestError extends Error {
  constructor(message, { path, field }) {
    super(`${path}: ${field}: ${message}`);
    this.name = "ManifestError";
    this.path = path;
    this.field = field;
  }
}

function requireNonEmptyStrings(value, { path, field }) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ManifestError("must be a non-empty array", { path, field });
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new ManifestError("every entry must be a non-empty string", { path, field });
    }
  }
  return value;
}

export function parseManifest(raw, path) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManifestError("must be a JSON object", { path, field: "<root>" });
  }

  const skill = raw.skill;
  if (typeof skill !== "string" || !skill.startsWith("theokit-") || !KEBAB.test(skill)) {
    throw new ManifestError('must be kebab-case and start with "theokit-"', { path, field: "skill" });
  }

  const concept = raw.concept;
  if (typeof concept !== "string" || concept.trim().length === 0) {
    throw new ManifestError("must be a non-empty string", { path, field: "concept" });
  }

  const teaches = requireNonEmptyStrings(raw.teaches, { path, field: "teaches" });
  for (const entry of teaches) {
    if (!TEACHES.test(entry)) {
      throw new ManifestError(`"${entry}" is not a theokit ecosystem package or subpath`, { path, field: "teaches" });
    }
  }

  const triggers = requireNonEmptyStrings(raw.triggers, { path, field: "triggers" });
  const notCovered = requireNonEmptyStrings(raw.notCovered, { path, field: "notCovered" });

  if (!Array.isArray(raw.lessons) || raw.lessons.length === 0) {
    throw new ManifestError("must be a non-empty array", { path, field: "lessons" });
  }
  const lessons = raw.lessons.map((lesson) => {
    if (lesson === null || typeof lesson !== "object") {
      throw new ManifestError("every entry must be an object", { path, field: "lessons" });
    }
    if (typeof lesson.id !== "string" || !KEBAB.test(lesson.id)) {
      throw new ManifestError(`id "${lesson.id}" must be kebab-case`, { path, field: "lessons" });
    }
    if (typeof lesson.explains !== "string" || lesson.explains.trim().length === 0) {
      throw new ManifestError(`lesson "${lesson.id}" needs a non-empty explains`, { path, field: "lessons" });
    }
    return { id: lesson.id, explains: lesson.explains };
  });

  const credentials = raw.credentials ?? [];
  if (!Array.isArray(credentials) || credentials.some((entry) => typeof entry !== "string")) {
    throw new ManifestError("must be an array of strings", { path, field: "credentials" });
  }

  const evidence = raw.evidence ?? [];
  if (!Array.isArray(evidence)) {
    throw new ManifestError("must be an array", { path, field: "evidence" });
  }
  const parsedEvidence = evidence.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.command !== "string" ||
      typeof entry.claims !== "string" ||
      entry.command.trim().length === 0 ||
      entry.claims.trim().length === 0
    ) {
      throw new ManifestError("every entry needs a command and a claims", { path, field: "evidence" });
    }
    return { command: entry.command, claims: entry.claims };
  });

  const seeAlso = parseNeighbours(raw.seeAlso, { path, field: "seeAlso", skill });
  const requires = parseNeighbours(raw.requires, { path, field: "requires", skill });

  return {
    skill,
    teaches,
    concept,
    triggers,
    lessons,
    notCovered,
    credentials,
    evidence: parsedEvidence,
    seeAlso,
    requires,
  };
}

/**
 * Parse `seeAlso` / `requires` — the two fields that place a skill among its neighbours.
 *
 * An agent that cannot reach the adjacent skill writes the adjacent code itself, from memory, and
 * that is the failure the whole corpus exists to prevent. Both fields are optional: an example with
 * no neighbours declares none rather than inventing one.
 */
function parseNeighbours(value, { path, field, skill }) {
  const entries = value ?? [];
  if (!Array.isArray(entries)) {
    throw new ManifestError("must be an array of skill names", { path, field });
  }
  for (const entry of entries) {
    if (typeof entry !== "string" || !entry.startsWith("theokit-") || !KEBAB.test(entry)) {
      throw new ManifestError(`"${entry}" is not a theokit-* skill name`, { path, field });
    }
    if (entry === skill) {
      throw new ManifestError("a skill cannot be its own neighbour", { path, field });
    }
  }
  return entries;
}
