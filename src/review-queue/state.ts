export interface QueueItem {
  id: string;
  name: string;
  path: string;
  hash: string;
  subject: string;
  status: "neu" | "kept" | "discarded" | "unsure";
  target?: string;
}

export interface QueueState {
  items: QueueItem[];
}

export interface PluginDataStore {
  loadData(): Promise<Record<string, unknown>>;
  saveData(data: Record<string, unknown>): Promise<void>;
}

const QUEUE_KEY = "review-queue";

const DEFAULT_STATE: QueueState = { items: [] };

export class ReviewQueue {
  private state: QueueState = { items: [] };
  private plugin: PluginDataStore;

  constructor(plugin: PluginDataStore) {
    this.plugin = plugin;
  }

  async load(): Promise<void> {
    const data = await this.plugin.loadData();
    const raw = data[QUEUE_KEY];
    if (
      raw &&
      typeof raw === "object" &&
      Array.isArray((raw as QueueState).items)
    ) {
      this.state = raw as QueueState;
    } else {
      this.state = { items: [] };
    }
  }

  async save(): Promise<void> {
    const data = await this.plugin.loadData();
    data[QUEUE_KEY] = this.state;
    await this.plugin.saveData(data);
  }

  addItem(item: QueueItem): void {
    this.state.items.push(item);
  }

  removeItem(id: string): void {
    this.state.items = this.state.items.filter((i) => i.id !== id);
  }

  updateStatus(id: string, status: QueueItem["status"]): void {
    const item = this.state.items.find((i) => i.id === id);
    if (item) {
      item.status = status;
    }
  }

  getItems(): QueueItem[] {
    return [...this.state.items];
  }

  getItemsByStatus(status: QueueItem["status"]): QueueItem[] {
    return this.state.items.filter((i) => i.status === status);
  }
}
