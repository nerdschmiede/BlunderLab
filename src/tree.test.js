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

import {
    createTreeSession,
    currentNode,
    goBack,
    goForwardIfExists,
    addVariationAndGo,
    deleteCurrentAndGoParent,
} from "./tree.js";

describe("tree session API", () => {
    it("createTreeSession starts at root", () => {
        const root = createRoot();
        const session = createTreeSession(root);

        expect(session.root).toBe(root);
        expect(session.path).toEqual([root]);
        expect(currentNode(session)).toBe(root);
    });

    it("addVariationAndGo creates a child and advances path", () => {
        const session = createTreeSession();

        const res = addVariationAndGo(session, { from: "e2", to: "e4" });

        expect(res.ok).toBe(true);
        expect(res.created).toBe(true);
        expect(session.root.children).toHaveLength(1);
        expect(currentNode(session).move).toEqual({ from: "e2", to: "e4" });
        expect(session.path).toHaveLength(2);
    });

    it("addVariationAndGo does not duplicate an existing child", () => {
        const session = createTreeSession();

        addVariationAndGo(session, { from: "e2", to: "e4" });
        goBack(session); // back to root

        const res2 = addVariationAndGo(session, { from: "e2", to: "e4" });

        expect(res2.ok).toBe(true);
        expect(res2.created).toBe(false);
        expect(session.root.children).toHaveLength(1);
        expect(session.path).toHaveLength(2);
    });

    it("goForwardIfExists follows an existing child, otherwise fails", () => {
        const root = createRoot();
        const e4 = createNode({ from: "e2", to: "e4" });
        root.children.push(e4);

        const session = createTreeSession(root);

        const ok = goForwardIfExists(session, { from: "e2", to: "e4" });
        expect(ok.ok).toBe(true);
        expect(currentNode(session)).toBe(e4);

        goBack(session);
        const bad = goForwardIfExists(session, { from: "d2", to: "d4" });
        expect(bad.ok).toBe(false);
        expect(bad.reason).toBe("no-such-child");
    });

    it("goBack pops one node, but refuses at root", () => {
        const session = createTreeSession();
        addVariationAndGo(session, { from: "e2", to: "e4" });

        const res1 = goBack(session);
        expect(res1.ok).toBe(true);
        expect(session.path).toHaveLength(1);

        const res2 = goBack(session);
        expect(res2.ok).toBe(false);
        expect(res2.reason).toBe("at-root");
    });

    it("deleteCurrentAndGoParent deletes a leaf and moves to parent", () => {
        const session = createTreeSession();
        addVariationAndGo(session, { from: "e2", to: "e4" });

        expect(session.root.children).toHaveLength(1);
        expect(session.path).toHaveLength(2);

        const res = deleteCurrentAndGoParent(session);
        expect(res.ok).toBe(true);

        expect(session.root.children).toHaveLength(0);
        expect(session.path).toHaveLength(1);
    });

    it("deleteCurrentAndGoParent refuses if current has children", () => {
        const session = createTreeSession();
        addVariationAndGo(session, { from: "e2", to: "e4" });
        addVariationAndGo(session, { from: "e7", to: "e5" });

        // now current is e5; go back to e4 and try delete e4 (has child e5)
        goBack(session); // back to e4

        const res = deleteCurrentAndGoParent(session);
        expect(res.ok).toBe(false);
        expect(res.reason).toBe("has-children");
    });
});
