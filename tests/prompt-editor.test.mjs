import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement } = await import("react");
const { render, fireEvent, act, cleanup } = await import("@testing-library/react");
const { default: PromptEditor } = await import("../src/components/PromptEditor.tsx");
const { parseLabelSuggestion } = await import("../src/labelSuggestions.ts");
afterEach(cleanup);

function setup(overrides = {}) {
  let resolve, reject, signal;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const saved = [];
  const view = render(createElement(PromptEditor, {
    initial: [{ roundId: "r1", promptText: "人間", acceptedLabels: ["Book"], minConfidence: 85 }],
    busy: false,
    onSave: async (prompts) => { saved.push(prompts); },
    onSuggest: (_text, abortSignal) => { signal = abortSignal; return pending; },
    ...overrides,
  }));
  return { ...view, resolve, reject, saved, get signal() { return signal; } };
}
async function start(view) {
  await act(async () => fireEvent.click(view.getByRole("button", { name: /お題から英語ラベル/ })));
}
const labels = (view) => view.getAllByRole("textbox")[1];

test("suggestions fill labels, prevent saving while pending, and save acceptedLabels", async () => {
  const view = setup();
  await start(view);
  const save = view.getByRole("button", { name: /お題を決定/ });
  assert.equal(save.disabled, true);
  await act(async () => view.resolve({ labels: ["Person"], matched: true }));
  assert.equal(labels(view).value, "Person");
  assert.equal(save.disabled, false);
  await act(async () => fireEvent.click(save));
  assert.deepEqual(view.saved[0][0].acceptedLabels, ["Person"]);
});

test("manual label edits cancel pending suggestions and ignore late replies", async () => {
  const view = setup();
  await start(view);
  fireEvent.change(labels(view), { target: { value: "Chair" } });
  assert.equal(view.signal.aborted, true);
  await act(async () => view.resolve({ labels: ["Person"], matched: true }));
  assert.equal(labels(view).value, "Chair");
});

test("editing the theme ignores old replies", async () => {
  const view = setup();
  await start(view);
  fireEvent.change(view.getAllByRole("textbox")[0], { target: { value: "椅子" } });
  await act(async () => view.resolve({ labels: ["Person"], matched: true }));
  assert.equal(labels(view).value, "Book");
  assert.equal(view.queryByRole("status"), null);
});

test("no match and upstream errors preserve manual labels", async () => {
  const view = setup();
  await start(view);
  await act(async () => view.resolve({ labels: [], matched: false, reason: "抽象的なお題です" }));
  assert.match(view.getByRole("status").textContent, /該当なし/);
  assert.equal(labels(view).value, "Book");
  view.unmount();
  const failed = setup();
  await start(failed);
  await act(async () => failed.reject(new Error("AI に接続できませんでした。")));
  assert.match(failed.getByRole("alert").textContent, /接続できません/);
  assert.equal(labels(failed).value, "Book");
});

test("sample replacement and unmount cancel old requests", async () => {
  const view = setup();
  await start(view);
  fireEvent.click(view.getByRole("button", { name: /サンプルを使う/ }));
  assert.equal(view.signal.aborted, true);
  await act(async () => view.resolve({ labels: ["Person"], matched: true }));
  assert.equal(labels(view).value, "Clock, Wristwatch");
  view.unmount();
  const gone = setup();
  await start(gone);
  gone.unmount();
  assert.equal(gone.signal.aborted, true);
  await act(async () => gone.resolve({ labels: ["Person"], matched: true }));
});

test("malformed suggestion responses fail safely", () => {
  for (const data of [null, {}, { labels: "Person", matched: true }, { labels: [3], matched: true },
    { labels: [], matched: true }, { labels: ["Person"], matched: false },
    { labels: ["Person"], matched: true, reason: {} }]) {
    assert.throws(() => parseLabelSuggestion(data), /手入力/);
  }
  assert.deepEqual(parseLabelSuggestion({ labels: [], matched: false }), { labels: [], matched: false, reason: undefined });
});
