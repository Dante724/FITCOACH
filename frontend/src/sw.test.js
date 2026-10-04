// Runs public/sw.js in a sandbox with a fake service-worker global to check notification behaviour.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadWorker({ windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  const fetched = [];
  const opened = [];
  const self = {
    location: { href: "https://app.fitcoach.test/sw.js?api=https%3A%2F%2Fapi.fitcoach.test", origin: "https://app.fitcoach.test" },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    registration: { showNotification: (title, opts) => { shown.push({ title, opts }); return Promise.resolve(); } },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows),
      openWindow: (url) => { opened.push(url); return Promise.resolve(); },
    },
  };
  const context = {
    self, URL, Date, JSON, Array, Boolean, Response: { error: () => ({}) },
    caches: { keys: async () => [], open: async () => ({ put: async () => {} }), match: async () => null, delete: async () => true },
    fetch: (url, init) => { fetched.push({ url, init }); return Promise.resolve({ ok: true }); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8"), context);
  const fire = async (type, event) => {
    let work;
    listeners[type]({ ...event, waitUntil: (p) => { work = p; } });
    await work;
  };
  return { fire, shown, fetched, opened };
}

const pushEvent = (data) => ({ data: { json: () => data, text: () => JSON.stringify(data) } });

test("call push shows a sticky, vibrating notification with Answer/Decline", async () => {
  const w = loadWorker();
  await w.fire("push", pushEvent({ title: "Incoming call from Asha", body: "Video call", kind: "call", tag: "call-1",
    requireInteraction: true, url: "/call/live/1", decline_url: "/api/calls/1/decline-push?t=x",
    actions: [{ action: "answer", title: "Answer" }, { action: "decline", title: "Decline" }] }));
  const { title, opts } = w.shown[0];
  expect(title).toBe("Incoming call from Asha");
  expect(opts.requireInteraction).toBe(true);
  expect(opts.actions.map((a) => a.action)).toEqual(["answer", "decline"]);
  expect(opts.vibrate.length).toBeGreaterThan(3);
  expect(opts.tag).toBe("call-1");
  expect(opts.data).toEqual({ url: "/call/live/1", decline: "/api/calls/1/decline-push?t=x" });
});

test("ordinary push shows a simple notification", async () => {
  const w = loadWorker();
  await w.fire("push", pushEvent({ title: "Session in 10 minutes", body: "Join from the app", url: "/call/b1" }));
  expect(w.shown[0].opts.requireInteraction).toBe(false);
  expect(w.shown[0].opts.actions).toEqual([]);
});

test("Decline calls the API directly and opens nothing", async () => {
  const w = loadWorker();
  const close = jest.fn();
  await w.fire("notificationclick", { action: "decline", notification: { close, data: { url: "/call/live/1", decline: "/api/calls/1/decline-push?t=x" } } });
  expect(close).toHaveBeenCalled();
  expect(w.fetched).toEqual([{ url: "https://api.fitcoach.test/api/calls/1/decline-push?t=x", init: { method: "POST" } }]);
  expect(w.opened).toEqual([]);
});

test("tapping focuses an open FitCoach window and routes inside it", async () => {
  const win = { url: "https://app.fitcoach.test/dashboard", postMessage: jest.fn(), focus: jest.fn(() => Promise.resolve()) };
  const w = loadWorker({ windows: [win] });
  await w.fire("notificationclick", { action: "answer", notification: { close: () => {}, data: { url: "/call/live/1" } } });
  expect(win.postMessage).toHaveBeenCalledWith({ type: "navigate", url: "/call/live/1" });
  expect(win.focus).toHaveBeenCalled();
  expect(w.opened).toEqual([]);
});

test("tapping with the app closed opens it on the right screen", async () => {
  const w = loadWorker();
  await w.fire("notificationclick", { action: "", notification: { close: () => {}, data: { url: "/messages" } } });
  expect(w.opened).toEqual(["/messages"]);
});
