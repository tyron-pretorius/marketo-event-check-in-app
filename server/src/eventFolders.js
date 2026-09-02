import * as marketo from "./marketo.js";

// Finds the "current" event folder to browse programs from, starting at
// MARKETO_EVENTS_ROOT_FOLDER_ID and walking down. This is deliberately
// generic rather than assuming any specific naming convention:
//   - if a folder's children include one or more "YYYY"-style names,
//     descend into whichever has the highest year
//   - else if its children include one or more "QN"-style names,
//     descend into whichever has the highest quarter
//   - else if it has exactly one child folder and no programs sitting
//     directly in it, descend into that one child
//   - otherwise, stop here and list whatever programs are in this folder
//
// This adapts to a "YYYY > Events > In-person Events > QX" style tree,
// a flat "single folder full of event programs" tree, or anything in
// between — as long as MARKETO_EVENTS_ROOT_FOLDER_ID points at the right
// place to start from.

const YEAR_FOLDER = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/;
const QUARTER_FOLDER = /\bQ(\d+)\b/i;
const MAX_DEPTH = 6;

let cache = null; // { at, data }
const CACHE_MS = 5 * 60 * 1000;

function rootFolderId() {
  const id = process.env.MARKETO_EVENTS_ROOT_FOLDER_ID;
  if (!id) {
    throw new Error(
      "MARKETO_EVENTS_ROOT_FOLDER_ID is not set — the event picker needs a folder to start browsing from. Load a program by its Program Id instead, or set that env var to enable auto-discovery."
    );
  }
  return Number(id);
}

async function namedChildren(parentId) {
  const children = await marketo.getFolderContent(parentId);
  const named = await Promise.all(children.map((c) => marketo.getFolderById(c.id)));
  return named.filter(Boolean);
}

function pickHighest(folders, pattern) {
  let best = null;
  let bestValue = -Infinity;
  for (const folder of folders) {
    const match = folder.name.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (value > bestValue) {
      bestValue = value;
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

  const yearMatch = pickHighest(children, YEAR_FOLDER);
  if (yearMatch) return resolveEventFolder(yearMatch.id, depth + 1);

  const quarterMatch = pickHighest(children, QUARTER_FOLDER);
  if (quarterMatch) return resolveEventFolder(quarterMatch.id, depth + 1);

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

  const folder = await resolveEventFolder(rootFolderId());
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
