import { assertEquals as equals } from "../deps/assert.ts";
import { pluginNames } from "../cli/utils.ts";

const totalPlugins = Array.from(Deno.readDirSync("plugins")).length;

Deno.test("Plugins list in init", () => {
  equals(pluginNames.length, totalPlugins - 8);

  equals(pluginNames, [
    "attributes",
    "base_path",
    "code_highlight",
    "date",
    "esbuild",
    "eta",
    "imagick",
    "inline",
    "jsx",
    "liquid",
    "metas",
    "modify_urls",
    "multilanguage",
    "nano_jsx",
    "netlify_cms",
    "on_demand",
    "parcel_css",
    "postcss",
    "prism",
    "pug",
    "relations",
    "relative_urls",
    "resolve_urls",
    "sass",
    "slugify_urls",
    "svgo",
    "terser",
  ]);
});
