import { init, minify } from "../deps/minify_html.ts";
import { merge } from "../core/utils.ts";
import { Exception } from "../core/errors.ts";

import type { Options as MinifyOptions } from "../deps/minify_html.ts";
import type { DeepPartial, Page, Site } from "../core.ts";

export interface Options {
  /** The list of extensions this plugin applies to. */
  extensions: Array<".html" | ".css" | ".js">;

  /** Default options for minify-html library */
  options: MinifyOptions;
}

// Default options
export const defaults: Options = {
  extensions: [".html"],
  options: {
    do_not_minify_doctype: true,
    ensure_spec_compliant_unquoted_attribute_values: true,
    keep_closing_tags: false,
    keep_html_and_head_opening_tags: false,
    keep_spaces_between_attributes: false,
    keep_comments: false,
    minify_js: true,
    minify_css: true,
    remove_bangs: false,
    remove_processing_instructions: false,
  },
};

// Init minify-html
await init();

/** A plugin to minify HTML, CSS & JavaScript files */
export default function (userOptions?: DeepPartial<Options>) {
  const options = merge(defaults, userOptions);

  const { extensions } = options;

  // Validate supported file extensions
  if (extensions.some((ext) => ![".html", ".css", ".js"].includes(ext))) {
    throw new Exception("Unsupported extensions configuration.", {
      name: "Plugin minify-html",
      extensions,
    });
  }

  return (site: Site) => {
    site.process(options.extensions, minifyHtml);

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    function minifyHtml(page: Page) {
      const content = page.content as string;

      page.content = decoder.decode(
        minify(encoder.encode(content), options.options),
      );
    }
  };
}
