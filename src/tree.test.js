// src/studyTree/tree.test.js
import { describe, it, expect } from "vitest";
import {createRoot, createNode, isExpectedMove, deserializeTree} from "./tree.js";

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

describe("isExpectedMove", () => {
    it("returns true if move exists as child of current node", () => {
        const root = createRoot();
        const session = createTreeSession(root);

        root.children.push(createNode({ from: "e2", to: "e4" }));

        expect(isExpectedMove(session, { from: "e2", to: "e4" })).toBe(true);
    });

    it("returns false if move does not exist", () => {
        const root = createRoot();
        const session = createTreeSession(root);

        root.children.push(createNode({ from: "d2", to: "d4" }));

        expect(isExpectedMove(session, { from: "e2", to: "e4" })).toBe(false);
    });

    it("returns false if current node has no children", () => {
        const root = createRoot();
        const session = createTreeSession(root);

        expect(isExpectedMove(session, { from: "e2", to: "e4" })).toBe(false);
    });

    it("checks moves relative to the current session node", () => {
        const root = createRoot();
        const e4 = createNode({ from: "e2", to: "e4" });
        const c5 = createNode({ from: "c7", to: "c5" });

        root.children.push(e4);
        e4.children.push(c5);

        const session = createTreeSession(root);

        // Am Root: e4 ist erlaubt
        expect(isExpectedMove(session, { from: "e2", to: "e4" })).toBe(true);

        // Nach e4: c5 ist erlaubt
        goForwardIfExists(session, { from: "e2", to: "e4" });
        expect(isExpectedMove(session, { from: "c7", to: "c5" })).toBe(true);
    });


})

// save

import {
    createOpening,
    createEmptyAppState,
    serializeAppState,
    deserializeAppState,
    saveToStorage,
    loadFromStorage,
} from "./tree.js";

function makeMemoryStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        _dump: () => Object.fromEntries(m.entries()),
    };
}

describe("app state serialization", () => {
    it("roundtrips app state with full tree", () => {
        const o = createOpening({ name: "Caro-Kann", trainAs: "black" });
        o.root = buildTreeFromLine([
            { from: "e2", to: "e4" },
            { from: "c7", to: "c6" },
            { from: "d2", to: "d4" },
            { from: "d7", to: "d5" },
        ]);

        const state = createEmptyAppState();
        state.openings.push(o);
        state.activeOpeningId = o.id;

        const json = serializeAppState(state);
        const parsed = deserializeAppState(json);

        expect(parsed.openings).toHaveLength(1);
        expect(parsed.activeOpeningId).toBe(o.id);
        expect(parsed.openings[0].name).toBe("Caro-Kann");
        expect(parsed.openings[0].trainAs).toBe("black");

        // Tree content exists (full subtree)
        const root = parsed.openings[0].root;
        expect(root.children.length).toBeGreaterThan(0);
        expect(root.children[0].move).toEqual({ from: "e2", to: "e4" });
        expect(root.children[0].children[0].move).toEqual({ from: "c7", to: "c6" });
    });

    it("saveToStorage/loadFromStorage works", () => {
        const storage = makeMemoryStorage();

        const o = createOpening({ name: "Italian", trainAs: "white" });
        const state = createEmptyAppState();
        state.openings.push(o);
        state.activeOpeningId = o.id;

        saveToStorage(state, storage, "testkey");
        const loaded = loadFromStorage(storage, "testkey");

        expect(loaded.activeOpeningId).toBe(o.id);
        expect(loaded.openings[0].name).toBe("Italian");
        expect(loaded.openings[0].trainAs).toBe("white");
    });

    it("if activeOpeningId is missing, it becomes null", () => {
        const o = createOpening({ name: "Sicilian", trainAs: "black" });
        const state = createEmptyAppState();
        state.openings.push(o);
        state.activeOpeningId = "does-not-exist";

        const json = serializeAppState(state);
        const loaded = deserializeAppState(json);

        expect(loaded.activeOpeningId).toBe(null);
    });
});


describe("new persistence helpers", () => {
    it("deserializeTree normalizes missing children recursively", () => {
        const raw = {
            move: null,
            children: [
                { move: { from: "e2", to: "e4" } }, // children missing
            ],
        };

        const root = deserializeTree(raw);

        expect(Array.isArray(root.children)).toBe(true);
        expect(Array.isArray(root.children[0].children)).toBe(true);
        expect(root.children[0].children).toEqual([]);
    });

    it("deserializeAppState throws on unsupported schemaVersion", () => {
        const bad = JSON.stringify({
            schemaVersion: 999,
            openings: [],
            activeOpeningId: null,
        });

        expect(() => deserializeAppState(bad)).toThrow(/schemaVersion/i);
    });

    it("deserializeAppState throws on invalid JSON", () => {
        expect(() => deserializeAppState("{not valid json")).toThrow();
    });

    it("loadFromStorage returns empty state if nothing stored", () => {
        const storage = makeMemoryStorage();
        const state = loadFromStorage(storage, "missing-key");

        expect(state).toEqual(createEmptyAppState());
    });

    it("deserializeAppState clears activeOpeningId if not found", () => {
        const o = createOpening({ name: "Test", trainAs: "white" });
        const state = createEmptyAppState();
        state.openings.push(o);
        state.activeOpeningId = "does-not-exist";

        const json = serializeAppState(state);
        const loaded = deserializeAppState(json);

        expect(loaded.activeOpeningId).toBe(null);
    });

    it("saveToStorage/loadFromStorage roundtrip keeps opening fields", () => {
        const storage = makeMemoryStorage();

        const o = createOpening({ name: "Caro-Kann", trainAs: "black" });
        const state = createEmptyAppState();
        state.openings.push(o);
        state.activeOpeningId = o.id;

        saveToStorage(state, storage, "k");
        const loaded = loadFromStorage(storage, "k");

        expect(loaded.openings[0].id).toBe(o.id);
        expect(loaded.openings[0].name).toBe("Caro-Kann");
        expect(loaded.openings[0].trainAs).toBe("black");
        expect(loaded.activeOpeningId).toBe(o.id);
    });
});
