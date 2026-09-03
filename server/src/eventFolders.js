import * as marketo from "./marketo.js";

// Finds the "current" event folder to browse programs from, starting at
// MARKETO_EVENTS_ROOT_FOLDER_NAME and walking down. This is deliberately
// generic rather than assuming any specific naming convention:
//   - if a folder's children include one or more "YYYY"- or "QN"-style
//     names, descend into whichever ranks highest by (year, quarter)
//   - else if it has exactly one child folder and no programs sitting
//     directly in it, descend into that one child
//   - otherwise, stop here and list whatever programs are in this folder
//
// This adapts to a "YYYY > Events > In-person Events > QX" style tree,
// a flat "single folder full of event programs" tree, or anything in
// between — as long as MARKETO_EVENTS_ROOT_FOLDER_NAME points at the
// right place to start from. It's a name, not an id, because Marketo
// folder ids aren't exposed anywhere in the UI (unlike program and smart
// campaign ids, which show up in the URL) — a name is the only thing
// someone can realistically copy out of Design Studio.

const YEAR_FOLDER = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/;
const QUARTER_FOLDER = /\bQ(\d+)\b/i;
const MAX_DEPTH = 6;

let cache = null; // { at, data }
const CACHE_MS = 5 * 60 * 1000;

async function resolveRootFolderId() {
  const name = process.env.MARKETO_EVENTS_ROOT_FOLDER_NAME;
  if (!name) {
    throw new Error(
      "MARKETO_EVENTS_ROOT_FOLDER_NAME is not set — the event picker needs a folder to start browsing from. Load a program by its Program Id instead, or set that env var (the folder's name, exactly as it appears in Design Studio) to enable auto-discovery."
    );
  }

  const folder = await marketo.getFolderByName(name);
  if (!folder) {
    throw new Error(`No Marketo folder named "${name}" was found — check MARKETO_EVENTS_ROOT_FOLDER_NAME for typos.`);
  }
  return folder.id;
}

async function namedChildren(parentId) {
  const children = await marketo.getFolderContent(parentId);
  const named = await Promise.all(children.map((c) => marketo.getFolderById(c.id)));
  return named.filter(Boolean);
}

// Ranks siblings by (year, quarter) together rather than as two separate
// passes — a folder like "2026 - Knak - Q3 - In-person Events" matches
// both patterns, and so do its Q1/Q2 siblings, so picking on year alone
// first would tie across all three and never get to the quarter that
// actually distinguishes them.
function pickLatest(folders) {
  let best = null;
  let bestYear = -Infinity;
  let bestQuarter = -Infinity;
  for (const folder of folders) {
    const yearMatch = folder.name.match(YEAR_FOLDER);
    const quarterMatch = folder.name.match(QUARTER_FOLDER);
    if (!yearMatch && !quarterMatch) continue;

    const year = yearMatch ? Number(yearMatch[1]) : -Infinity;
    const quarter = quarterMatch ? Number(quarterMatch[1]) : -Infinity;
    if (year > bestYear || (year === bestYear && quarter > bestQuarter)) {
      bestYear = year;
      bestQuarter = quarter;
      best = folder;
    }
  }
  return best;
}

async function resolveEventFolder(folderId, depth = 0) {
  const folder = await marketo.getFolderById(folderId);
  if (depth >= MAX_DEPTH) return folder;

  const children = await namedChildren(folderId);
  if (!children.length) return folder;

  const match = pickLatest(children);
  if (match) return resolveEventFolder(match.id, depth + 1);

  if (children.length === 1) {
    const programsHere = await marketo.browseProgramsInFolder(folderId);
    if (!programsHere.length) return resolveEventFolder(children[0].id, depth + 1);
  }

  return folder;
}

export async function getLatestEventPrograms({ skipCache = false } = {}) {
  if (!skipCache && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }

  const folder = await resolveEventFolder(await resolveRootFolderId());
  const programs = await marketo.browseProgramsInFolder(folder.id);

  const data = {
    folder: { id: folder.id, name: folder.name },
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
    })),
  };

  cache = { at: Date.now(), data };
  return data;
}
