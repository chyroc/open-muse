import { Window } from "happy-dom";
import { populateGlobal, type Environment } from "vitest/environments";

export default {
  name: "macos-dom",
  transformMode: "web",
  setup(global) {
    const window = new Window({ url: "https://app.test" });
    const { keys, originals } = populateGlobal(global, window, {
      bindFunctions: true,
    });
    global.IS_REACT_ACT_ENVIRONMENT = true;
    return {
      async teardown() {
        await window.happyDOM.close();
        keys.forEach((key) => delete global[key]);
        originals.forEach((value, key) => (global[key] = value));
        delete global.IS_REACT_ACT_ENVIRONMENT;
      },
    };
  },
} satisfies Environment;
