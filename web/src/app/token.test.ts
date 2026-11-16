import { describe, expect, it } from "vitest";
import { bootstrapSessionToken } from "./token.ts";

const memoryStorage = (initial: Record<string, string> = {}): Storage => {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
};

const throwingStorage = (): Storage => {
  const fail = () => {
    throw new Error("SecurityError");
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
};

const fakeWindow = (href: string, storage: () => Storage) => {
  const replaced: string[] = [];
  const win = {
    location: { href },
    history: {
      state: null,
      replaceState: (_: unknown, __: string, url: string) => void replaced.push(url),
    },
    get localStorage() {
      return storage();
    },
  };
  return { win, replaced };
};

describe("bootstrapSessionToken", () => {
  it("takes the token from the URL, stores it and removes it from the URL", () => {
    const storage = memoryStorage();
    const { win, replaced } = fakeWindow(
      "http://127.0.0.1:4823/review/x?token=abc&y=1#top",
      () => storage,
    );
    expect(bootstrapSessionToken(win).value).toBe("abc");
    expect(storage.getItem("megareviewer.token")).toBe("abc");
    expect(replaced).toEqual(["/review/x?y=1#top"]);
  });

  it("reads the stored token after a reload, without touching the URL", () => {
    const storage = memoryStorage({ "megareviewer.token": "stored" });
    const { win, replaced } = fakeWindow("http://127.0.0.1:4823/", () => storage);
    expect(bootstrapSessionToken(win).value).toBe("stored");
    expect(replaced).toEqual([]);
  });

  it("prefers a token in the URL over a stored one", () => {
    const storage = memoryStorage({ "megareviewer.token": "old" });
    const { win } = fakeWindow("http://127.0.0.1:4823/?token=new", () => storage);
    expect(bootstrapSessionToken(win).value).toBe("new");
    expect(storage.getItem("megareviewer.token")).toBe("new");
  });

  it("has no token when there's none in the URL or storage", () => {
    const { win, replaced } = fakeWindow("http://127.0.0.1:4823/?token=", () => memoryStorage());
    expect(bootstrapSessionToken(win).value).toBeNull();
    expect(replaced).toEqual(["/"]);
  });

  it("keeps the token in memory when storage throws", () => {
    const { win } = fakeWindow("http://127.0.0.1:4823/?token=abc", throwingStorage);
    const token = bootstrapSessionToken(win);
    expect(token.value).toBe("abc");
    expect(token.reject("abc")).toBeNull();
    expect(token.value).toBeNull();
  });

  it("keeps the token in memory when even reaching storage throws", () => {
    const { win } = fakeWindow("http://127.0.0.1:4823/?token=abc", () => {
      throw new Error("SecurityError");
    });
    expect(bootstrapSessionToken(win).value).toBe("abc");
  });

  it("forgets a rejected token, also in storage", () => {
    const storage = memoryStorage();
    const { win } = fakeWindow("http://127.0.0.1:4823/?token=abc", () => storage);
    const token = bootstrapSessionToken(win);
    expect(token.reject("abc")).toBeNull();
    expect(token.value).toBeNull();
    expect(storage.getItem("megareviewer.token")).toBeNull();
  });

  it("gives a new tab of the same browser the token the first tab was opened with", () => {
    const storage = memoryStorage();
    bootstrapSessionToken(fakeWindow("http://127.0.0.1:4823/?token=abc", () => storage).win);
    const { win, replaced } = fakeWindow(
      "http://127.0.0.1:4823/pr/github/acme/api/902",
      () => storage,
    );
    expect(bootstrapSessionToken(win).value).toBe("abc");
    expect(replaced).toEqual([]);
  });

  it("moves a stale tab to the token of the restarted server, and keeps that one stored", () => {
    const storage = memoryStorage({ "megareviewer.token": "old" });
    const stale = bootstrapSessionToken(fakeWindow("http://127.0.0.1:4823/", () => storage).win);
    bootstrapSessionToken(fakeWindow("http://127.0.0.1:4823/?token=new", () => storage).win);
    expect(stale.reject("old")).toBe("new");
    expect(stale.value).toBe("new");
    expect(storage.getItem("megareviewer.token")).toBe("new");
  });
});
