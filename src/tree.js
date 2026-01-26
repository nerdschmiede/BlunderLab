/**
 * positionKeyFromFen
 * Keeps only the position-relevant parts of a FEN:
 * [piece placement, active color, castling, en passant]
 *
 * Drops halfmove/fullmove counters so transpositions map to same key.
 */
export function positionKeyFromFen(fen) {
    if (typeof fen !== "string") throw new Error("fen must be a string");

    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new Error("invalid FEN");

    const [pieces, turn, castling, ep] = parts;

    // Normalize optional fields
    const normCastling = castling && castling !== "" ? castling : "-";
    const normEp = ep && ep !== "" ? ep : "-";

    return `${pieces} ${turn} ${normCastling} ${normEp}`;
}

/**
 * positionKeyFromGame
 * Convenience wrapper for chess.js instances.
 */
export function positionKeyFromGame(game) {
    if (!game || typeof game.fen !== "function") throw new Error("game must provide fen()");
    return positionKeyFromFen(game.fen());
}

export function createPositionIndex() {
    return new Map(); // key -> Node[]
}

export function indexNode(index, positionKey, node) {
    const arr = index.get(positionKey) ?? [];
    arr.push(node);
    index.set(positionKey, arr);
}


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

export function sameMove(a, b) {
    return (
        a.from === b.from &&
        a.to === b.to &&
        a.promotion === b.promotion
    );
}

export function findChildByMove(node, move) {
    return (
        node.children.find(c => c.move && sameMove(c.move, move)) || null
    );
}

export function addVariation(node, move) {
    const child = createNode(move);
    node.children.push(child);
    return child;
}
