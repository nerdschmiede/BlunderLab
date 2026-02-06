// Node-Helpers ------------------------------------------------

export const SCHEMA_VERSION = 1;

export function createRoot() {
    return {
        move: null,      // root has no move
        children: [],
    };
}

export function createNode(move) {
    return {
        move,            // { from, to, promotion? }
        children: [],
    };
}

export function sameMove(a, b) {
    return (
        a.from === b.from &&
        a.to === b.to &&
        a.promotion === b.promotion
    );
}


export function buildTreeFromLine(line) {
    const root = createRoot();
    let current = root;

    for (const move of line) {
        const node = createNode(move);
        current.children.push(node);
        current = node;
    }

    return root;
}

// --- Session ----------------------------------------------------

export function createTreeSession(root = createRoot()) {
    return { root, path: [root] };
}

export function currentNode(session) {
    return session.path[session.path.length - 1];
}

// --- Navigation (tree-independent) ------------------------------

export function goBack(session) {
    if (session.path.length <= 1) return { ok: false, reason: "at-root" };
    session.path.pop();
    return { ok: true };
}

export function goForwardIfExists(session, moveObj) {
    const cur = currentNode(session);
    const next =
        cur.children.find((c) => c.move && sameMove(c.move, moveObj)) || null;

    if (!next) return { ok: false, reason: "no-such-child" };

    session.path.push(next);
    return { ok: true, node: next };
}

export function isExpectedMove(session, moveObj) {
    const cur = currentNode(session);
    return cur.children.some((c) => c.move && sameMove(c.move, moveObj));
}

export function resetSessionToRoot(session) {
    session.path = [session.root];
}


// --- Edit (tree changes) ----------------------------------------

export function addVariationAndGo(session, moveObj) {
    const cur = currentNode(session);

    // If it already exists, just follow it (no duplicate child)
    const existing =
        cur.children.find((c) => c.move && sameMove(c.move, moveObj)) || null;

    if (existing) {
        session.path.push(existing);
        return { ok: true, created: false, node: existing };
    }

    const child = createNode(moveObj);
    cur.children.push(child);
    session.path.push(child);

    return { ok: true, created: true, node: child };
}

export function deleteCurrentAndGoParent(session) {
    if (session.path.length <= 1) return { ok: false, reason: "at-root" };

    const parent = session.path[session.path.length - 2];
    const cur = session.path[session.path.length - 1];

    // MVP: only delete leaf nodes
    if (cur.children.length > 0) return { ok: false, reason: "has-children" };

    const idx = parent.children.indexOf(cur);
    if (idx === -1) return { ok: false, reason: "not-a-child" };

    parent.children.splice(idx, 1);
    session.path.pop(); // go to parent
    return { ok: true };
}

// ------------------------------------------------------------
// Saving / Loading (App State)
// ------------------------------------------------------------

export function makeId() {
    // Browser: crypto.randomUUID(). Tests/Node: fallback.
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Opening model:
 * { id, name, trainAs: "white"|"black", root }
 */
export function createOpening({ name, trainAs }) {
    if (!name?.trim()) throw new Error("createOpening: name required");
    if (trainAs !== "white" && trainAs !== "black") throw new Error("createOpening: invalid trainAs - no color or unsupported color");

    return {
        id: makeId(),
        name: name.trim(),
        trainAs,
        root: createRoot(),
    };
}

/**
 * AppState model:
 * { schemaVersion, openings: [], activeOpeningId: string|null }
 */
export function createEmptyAppState() {
    return {
        schemaVersion: SCHEMA_VERSION,
        openings: [],
        activeOpeningId: null,
    };
}

/**
 * Tree serialization:
 * Currently the tree is plain JSON already. Keep these as a seam for future validation/migrations.
 */
export function serializeTree(root) {
    return root;
}

export function deserializeTree(obj) {
    // minimal validation
    if (!obj || typeof obj !== "object") throw new Error("deserializeTree: root must be object");
    if (!Array.isArray(obj.children)) throw new Error("deserializeTree: root.children must be array");

    // ensure every node has children array
    normalizeTree(obj);
    return obj;
}

function normalizeTree(node) {
    if (!node.children) node.children = [];
    for (const ch of node.children) {
        if (!ch.children) ch.children = [];
        normalizeTree(ch);
    }
}

/**
 * Serialize full app state to a JSON string.
 */
export function serializeAppState(state) {
    const payload = {
        schemaVersion: SCHEMA_VERSION,
        openings: state.openings.map((o) => ({
            id: o.id,
            name: o.name,
            trainAs: o.trainAs,
            lastPath: o.lastPath ?? [],
            root: serializeTree(o.root),
        })),
        activeOpeningId: state.activeOpeningId ?? null,
    };

    return JSON.stringify(payload);
}

/**
 * Parse + validate app state from JSON string.
 */
export function deserializeAppState(json) {
    const obj = JSON.parse(json);

    if (!obj || typeof obj !== "object") throw new Error("deserializeAppState: invalid json");
    if (obj.schemaVersion !== SCHEMA_VERSION) {
        throw new Error(`deserializeAppState: unsupported schemaVersion ${obj.schemaVersion}`);
    }
    if (!Array.isArray(obj.openings)) throw new Error("deserializeAppState: openings must be array");

    const openings = obj.openings.map((o) => {
        if (!o.id || !o.name || !o.trainAs) throw new Error("deserializeAppState: opening missing fields");
        return {
            id: String(o.id),
            name: String(o.name),
            trainAs: o.trainAs === "white" ? "white" : "black",
            lastPath: Array.isArray(o.lastPath) ? o.lastPath : [],
            root: deserializeTree(o.root),
        };
    });

    const activeOpeningId = obj.activeOpeningId ?? null;

    // optional: ensure activeOpeningId exists
    if (activeOpeningId && !openings.some((o) => o.id === activeOpeningId)) {
        return { schemaVersion: SCHEMA_VERSION, openings, activeOpeningId: null };
    }

    return { schemaVersion: SCHEMA_VERSION, openings, activeOpeningId };
}

/**
 * Storage helpers (inject storage for tests)
 */
export const DEFAULT_STORAGE_KEY = "blunderlab.appstate.v1";

export function saveToStorage(state, storage, key = DEFAULT_STORAGE_KEY) {
    if (!storage?.setItem) throw new Error("saveToStorage: invalid storage");
    storage.setItem(key, serializeAppState(state));
}

export function loadFromStorage(storage, key = DEFAULT_STORAGE_KEY) {
    if (!storage?.getItem) throw new Error("loadFromStorage: invalid storage");
    const raw = storage.getItem(key);
    if (!raw) return createEmptyAppState();
    return deserializeAppState(raw);
}