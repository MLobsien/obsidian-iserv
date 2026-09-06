import { Plugin } from "obsidian";

export default class IServPlugin extends Plugin {
  async onload() {
    console.log("IServ Integration loaded");
  }

  onunload() {
    console.log("IServ Integration unloaded");
  }
}
