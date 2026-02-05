// Node-Helpers ------------------------------------------------

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
