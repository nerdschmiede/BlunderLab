// src/studyTree/tree.test.js
import { describe, it, expect } from "vitest";
import { createRoot, createNode } from "./tree.js";

describe("study tree basics", () => {
    it("creates an empty root", () => {
        const root = createRoot();

        expect(root.move).toBe(null);
        expect(root.children).toEqual([]);
    });

    it("creates a node with a move", () => {
        const move = { from: "e2", to: "e4" };
        const node = createNode(move);

        expect(node.move).toEqual(move);
        expect(node.children).toEqual([]);
    });
});

import { buildTreeFromLine } from "./tree.js";

it("builds a single-branch tree from a line", () => {
    const line = [
        { from: "e2", to: "e4" },
        { from: "e7", to: "e5" },
        { from: "g1", to: "f3" },
    ];

    const root = buildTreeFromLine(line);

    expect(root.children).toHaveLength(1);
    expect(root.children[0].move).toEqual(line[0]);
    expect(root.children[0].children[0].move).toEqual(line[1]);
    expect(root.children[0].children[0].children[0].move).toEqual(line[2]);
});

import { findChildByMove } from "./tree.js";

it("finds matching child by move", () => {
    const root = buildTreeFromLine([
        { from: "e2", to: "e4" },
        { from: "e7", to: "e5" },
    ]);

    const child = findChildByMove(root, { from: "e2", to: "e4" });
    expect(child).not.toBe(null);

    const wrong = findChildByMove(root, { from: "d2", to: "d4" });
    expect(wrong).toBe(null);
});

import { addVariation } from "./tree.js";

it("adds a new variation as child", () => {
    const root = createRoot();

    const move = { from: "d2", to: "d4" };
    const child = addVariation(root, move);

    expect(root.children).toHaveLength(1);
    expect(child.move).toEqual(move);
});


import { Chess } from "chess.js";
import { positionKeyFromFen, positionKeyFromGame } from "./tree.js";

describe("positionKeyFromFen", () => {
    it("drops halfmove/fullmove counters", () => {
        const a = "8/8/8/8/8/8/8/8 w - - 0 1";
        const b = "8/8/8/8/8/8/8/8 w - - 12 37";

        expect(positionKeyFromFen(a)).toBe("8/8/8/8/8/8/8/8 w - -");
        expect(positionKeyFromFen(b)).toBe("8/8/8/8/8/8/8/8 w - -");
        expect(positionKeyFromFen(a)).toBe(positionKeyFromFen(b));
    });

    it("keeps side to move (important!)", () => {
        const w = "8/8/8/8/8/8/8/8 w - - 0 1";
        const b = "8/8/8/8/8/8/8/8 b - - 0 1";

        expect(positionKeyFromFen(w)).not.toBe(positionKeyFromFen(b));
    });

    it("keeps castling rights", () => {
        const a = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
        const b = "r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1";

        expect(positionKeyFromFen(a)).not.toBe(positionKeyFromFen(b));
    });

    it("keeps en passant square", () => {
        const a = "8/8/8/3pP3/8/8/8/8 w - d6 0 1";
        const b = "8/8/8/3pP3/8/8/8/8 w - - 0 1";

        expect(positionKeyFromFen(a)).not.toBe(positionKeyFromFen(b));
    });
});

describe("positionKeyFromGame", () => {
    it("works with chess.js", () => {
        const game = new Chess();
        const key1 = positionKeyFromGame(game);

        game.move("e4");
        const key2 = positionKeyFromGame(game);

        expect(key1).not.toBe(key2);
    });
});


import { createPositionIndex, indexNode } from "./tree.js";

describe("position index", () => {
    it("createPositionIndex returns an empty Map", () => {
        const index = createPositionIndex();

        expect(index).toBeInstanceOf(Map);
        expect(index.size).toBe(0);
    });

    it("indexNode groups nodes by positionKey", () => {
        const index = createPositionIndex();

        const n1 = createNode({ from: "e2", to: "e4" });
        const n2 = createNode({ from: "d2", to: "d4" });
        const n3 = createNode({ from: "g1", to: "f3" });

        indexNode(index, "posA", n1);
        indexNode(index, "posA", n2);
        indexNode(index, "posB", n3);

        expect(index.get("posA")).toEqual([n1, n2]);
        expect(index.get("posB")).toEqual([n3]);
        expect(index.size).toBe(2);
    });
});
