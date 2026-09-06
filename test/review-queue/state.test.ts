import { describe, it, expect, beforeEach } from "vitest";
import { ReviewQueue, QueueItem } from "../../src/review-queue/state";

function createMockPlugin(data: Record<string, unknown> = {}) {
  const store = { ...data };
  return {
    loadData: async () => ({ ...store }),
    saveData: async (d: Record<string, unknown>) => {
      Object.assign(store, d);
    },
  };
}

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: overrides.id ?? "item-1",
    name: overrides.name ?? "file.md",
    path: overrides.path ?? "vault/file.md",
    hash: overrides.hash ?? "abc123",
    subject: overrides.subject ?? "Subject",
    status: overrides.status ?? "neu",
    target: overrides.target,
  };
}

describe("ReviewQueue", () => {
  let plugin: ReturnType<typeof createMockPlugin>;
  let queue: ReviewQueue;

  beforeEach(() => {
    plugin = createMockPlugin();
    queue = new ReviewQueue(plugin);
  });

  it("addItem adds item to queue", async () => {
    const item = makeItem();
    queue.addItem(item);
    expect(queue.getItems()).toHaveLength(1);
    expect(queue.getItems()[0]).toEqual(item);
  });

  it("removeItem removes item by id", async () => {
    queue.addItem(makeItem({ id: "a" }));
    queue.addItem(makeItem({ id: "b" }));
    queue.removeItem("a");
    expect(queue.getItems()).toHaveLength(1);
    expect(queue.getItems()[0].id).toBe("b");
  });

  it("updateStatus changes item status", async () => {
    queue.addItem(makeItem({ id: "x", status: "neu" }));
    queue.updateStatus("x", "kept");
    expect(queue.getItems()[0].status).toBe("kept");
  });

  it("getItems returns all items", async () => {
    queue.addItem(makeItem({ id: "1" }));
    queue.addItem(makeItem({ id: "2" }));
    queue.addItem(makeItem({ id: "3" }));
    expect(queue.getItems()).toHaveLength(3);
  });

  it("getItemsByStatus filters items correctly", async () => {
    queue.addItem(makeItem({ id: "a", status: "neu" }));
    queue.addItem(makeItem({ id: "b", status: "kept" }));
    queue.addItem(makeItem({ id: "c", status: "neu" }));
    queue.addItem(makeItem({ id: "d", status: "discarded" }));

    const neu = queue.getItemsByStatus("neu");
    expect(neu).toHaveLength(2);
    expect(neu.map((i) => i.id)).toEqual(["a", "c"]);

    const kept = queue.getItemsByStatus("kept");
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe("b");

    const discarded = queue.getItemsByStatus("discarded");
    expect(discarded).toHaveLength(1);
    expect(discarded[0].id).toBe("d");

    const unsure = queue.getItemsByStatus("unsure");
    expect(unsure).toHaveLength(0);
  });

  it("persistence: save then load returns same state", async () => {
    queue.addItem(makeItem({ id: "p1", status: "kept", target: "alt" }));
    queue.addItem(makeItem({ id: "p2", status: "discarded" }));
    await queue.save();

    const queue2 = new ReviewQueue(plugin);
    await queue2.load();
    expect(queue2.getItems()).toHaveLength(2);
    expect(queue2.getItems()[0].id).toBe("p1");
    expect(queue2.getItems()[0].status).toBe("kept");
    expect(queue2.getItems()[0].target).toBe("alt");
    expect(queue2.getItems()[1].id).toBe("p2");
    expect(queue2.getItems()[1].status).toBe("discarded");
  });
});
