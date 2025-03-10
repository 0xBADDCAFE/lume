import { join, posix } from "../deps/path.ts";
import { merge, normalizePath } from "./utils.ts";
import { Exception } from "./errors.ts";

import FS from "./fs.ts";
import ComponentLoader from "./component_loader.ts";
import DataLoader from "./data_loader.ts";
import Source from "./source.ts";
import Scopes from "./scopes.ts";
import Processors from "./processors.ts";
import Renderer from "./renderer.ts";
import Events from "./events.ts";
import Formats from "./formats.ts";
import Logger from "./logger.ts";
import Searcher from "./searcher.ts";
import Scripts from "./scripts.ts";
import Writer from "./writer.ts";
import textLoader from "./loaders/text.ts";

import type {
  Component,
  Components,
  Data,
  Engine,
  Event,
  EventListener,
  EventOptions,
  Extensions,
  Helper,
  HelperOptions,
  Loader,
  Middleware,
  MultiProcessor,
  Page,
  Plugin,
  Processor,
  ScopeFilter,
  ScriptOrFunction,
  StaticFile,
} from "../core.ts";

/** Default options of the site */
const defaults: SiteOptions = {
  cwd: Deno.cwd(),
  src: "./",
  dest: "./_site",
  emptyDest: true,
  includes: "_includes",
  location: new URL("http://localhost"),
  quiet: false,
  dev: false,
  prettyUrls: true,
  server: {
    port: 3000,
    open: false,
    page404: "/404.html",
  },
  watcher: {
    ignore: [],
    debounce: 100,
  },
  components: {
    variable: "comp",
    cssFile: "/components.css",
    jsFile: "/components.js",
  },
};

/**
 * This is the heart of Lume,
 * it contains everything needed to build the site
 */
export default class Site {
  options: SiteOptions;

  /** Internal data. Used to save arbitrary data by plugins and processors */
  _data: Record<string, unknown> = {};

  /** To read the files from the filesystem */
  fs: FS;

  /** Info about how to handle different file formats */
  formats: Formats;

  /** To load all _data files */
  dataLoader: DataLoader;

  /** To load reusable components */
  componentLoader: ComponentLoader;

  /** To scan the src folder */
  source: Source;

  /** To update pages of the same scope after any change */
  scopes: Scopes;

  /** To store and run the processors */
  processors: Processors;

  /** To store and run the pre-processors */
  preprocessors: Processors;

  /** To render the pages using any template engine */
  renderer: Renderer;

  /** To listen and dispatch events */
  // deno-lint-ignore no-explicit-any
  events: Events<any>;

  /** To output messages to the console */
  logger: Logger;

  /** To run scripts */
  scripts: Scripts;

  /** To search pages */
  searcher: Searcher;

  /** To write the generated pages in the dest folder */
  writer: Writer;

  /** Data assigned with site.data() */
  scopedData = new Map<string, Data>([["/", {}]]);

  /** Global components shared by all templates */
  globalComponents: Components = new Map();

  /** Hooks installed by the plugins */
  // deno-lint-ignore no-explicit-any
  hooks: Record<string, (...args: any[]) => void> = {};

  /** The generated pages are stored here */
  readonly pages: Page[] = [];

  /** Pages that should be rendered on demand */
  readonly onDemandPages: Page[] = [];

  /** The static files to be copied are stored here */
  readonly files: StaticFile[] = [];

  constructor(options: Partial<SiteOptions> = {}) {
    this.options = merge(defaults, options);

    const src = this.src();
    const dest = this.dest();
    const { quiet, includes, cwd, prettyUrls, components, server } =
      this.options;

    // To load source files
    const fs = new FS({ root: src });
    const formats = new Formats();

    const dataLoader = new DataLoader({ formats });
    const componentLoader = new ComponentLoader({ formats });
    const source = new Source({
      fs,
      dataLoader,
      componentLoader,
      formats,
      components,
      scopedData: this.scopedData,
      prettyUrls,
    });

    // To render pages
    const scopes = new Scopes();
    const processors = new Processors();
    const preprocessors = new Processors();
    const renderer = new Renderer({
      prettyUrls,
      preprocessors,
      formats,
      fs,
      includes,
    });

    // Other stuff
    const events = new Events<SiteEvent>();
    const logger = new Logger({ quiet });
    const scripts = new Scripts({ logger, cwd });
    const writer = new Writer({ src, dest, logger });

    const url404 = server.page404 ? normalizePath(server.page404) : undefined;
    const searcher = new Searcher({
      pages: this.pages,
      sourceData: source.data,
      filters: [
        (data: Data) => data.page?.outputPath?.endsWith(".html") ?? false, // only html pages
        (data: Data) => !url404 || data.url !== url404, // not the 404 page
      ],
    });

    // Save everything in the site instance
    this.fs = fs;
    this.formats = formats;
    this.componentLoader = componentLoader;
    this.dataLoader = dataLoader;
    this.source = source;
    this.scopes = scopes;
    this.processors = processors;
    this.preprocessors = preprocessors;
    this.renderer = renderer;
    this.events = events;
    this.logger = logger;
    this.scripts = scripts;
    this.searcher = searcher;
    this.writer = writer;

    // Ignore the "dest" directory if it's inside src
    if (this.dest().startsWith(this.src())) {
      this.ignore(this.options.dest);
    }

    // Ignore the dest folder by the watcher
    this.options.watcher.ignore.push(normalizePath(this.options.dest));
    this.fs.options.ignore = this.options.watcher.ignore;
  }

  get globalData(): Data {
    return this.scopedData.get("/")!;
  }

  /**
   * Returns the full path to the root directory.
   * Use the arguments to return a subpath
   */
  root(...path: string[]): string {
    return normalizePath(join(this.options.cwd, ...path));
  }

  /**
   * Returns the full path to the src directory.
   * Use the arguments to return a subpath
   */
  src(...path: string[]): string {
    return this.root(this.options.src, ...path);
  }

  /**
   * Returns the full path to the dest directory.
   * Use the arguments to return a subpath
   */
  dest(...path: string[]): string {
    return this.root(this.options.dest, ...path);
  }

  /** Add a listener to an event */
  addEventListener<K extends SiteEventType>(
    type: K,
    listener: EventListener<Event & SiteEvent<K>> | string,
    options?: EventOptions,
  ): this {
    const fn = typeof listener === "string"
      ? () => this.run(listener)
      : listener;

    this.events.addEventListener(type, fn, options);
    return this;
  }

  /** Dispatch an event */
  dispatchEvent(event: SiteEvent): Promise<boolean> {
    return this.events.dispatchEvent(event);
  }

  /** Use a plugin */
  use(plugin: Plugin): this {
    plugin(this);
    return this;
  }

  /**
   * Register a script or a function, so it can be executed with
   * lume run <name>
   */
  script(name: string, ...scripts: ScriptOrFunction[]): this {
    this.scripts.set(name, ...scripts);
    return this;
  }

  /** Runs a script or function registered previously */
  async run(name: string): Promise<boolean> {
    return await this.scripts.run(name);
  }

  /**
   * Register a data loader for some extensions
   */
  loadData(extensions: string[], dataLoader: Loader = textLoader): this {
    extensions.forEach((ext) => {
      this.formats.set({ ext, dataLoader });
    });

    return this;
  }

  /**
   * Register a page loader for some extensions
   */
  loadPages(
    extensions: string[],
    pageLoader: Loader = textLoader,
    engine?: Engine,
  ): this {
    extensions.forEach((ext) => {
      this.formats.set({ ext, pageLoader });
    });

    if (engine) {
      this.engine(extensions, engine);
    }

    return this;
  }

  /**
   * Register an assets loader for some extensions
   */
  loadAssets(extensions: string[], pageLoader: Loader = textLoader): this {
    extensions.forEach((ext) => {
      this.formats.set({
        ext,
        pageLoader,
        asset: true,
      });
    });

    return this;
  }

  /**
   * Register a component loader for some extensions
   */
  loadComponents(
    extensions: string[],
    componentLoader: Loader = textLoader,
    engine: Engine,
  ): this {
    extensions.forEach((ext) => {
      this.formats.set({ ext, componentLoader });
    });
    this.engine(extensions, engine);
    return this;
  }

  /** Register an import path for some extensions  */
  includes(extensions: string[], path: string, override = true): this {
    extensions.forEach((ext) => {
      this.formats.set({ ext, includesPath: path }, override);
    });

    // Ignore any includes folder
    return this.ignore(path);
  }

  /** Register the engines for some extensions  */
  engine(extensions: string[], ...engines: Engine[]): this {
    extensions.forEach((ext) => {
      this.formats.set({ ext, engines });
    });

    for (const [name, helper] of this.renderer.helpers) {
      engines.forEach((engine) => engine.addHelper(name, ...helper));
    }

    return this;
  }

  /** Register a preprocessor for some extensions */
  preprocess(extensions: Extensions, preprocessor: Processor): this {
    this.preprocessors.set(extensions, preprocessor, false);
    return this;
  }

  /** Register a multipreprocessor for some extensions */
  preprocessAll(extensions: Extensions, processor: MultiProcessor): this {
    this.preprocessors.set(extensions, processor, true);
    return this;
  }

  /** Register a processor for some extensions */
  process(extensions: Extensions, processor: Processor): this {
    this.processors.set(extensions, processor, false);
    return this;
  }

  /** Register a multiprocessor for some extensions */
  processAll(extensions: Extensions, processor: MultiProcessor): this {
    this.processors.set(extensions, processor, true);
    return this;
  }

  /** Register a template filter */
  filter(name: string, filter: Helper, async = false): this {
    return this.helper(name, filter, { type: "filter", async });
  }

  /** Register a template helper */
  helper(name: string, fn: Helper, options: HelperOptions): this {
    this.renderer.addHelper(name, fn, options);
    return this;
  }

  /** Register extra data accessible by the layouts */
  data(name: string, value: unknown, scope = "/"): this {
    const data = this.scopedData.get(scope) || {};
    data[name] = value;
    this.scopedData.set(scope, data);
    return this;
  }

  /** Register an extra component accesible by the layouts */
  component(context: string, component: Component): this {
    const pieces = context.split(".");
    let components = this.globalComponents;

    while (pieces.length) {
      const name = pieces.shift()!;
      if (!components.get(name)) {
        components.set(name, new Map());
      }
      components = components.get(name) as Components;
    }

    components.set(component.name, component);
    return this;
  }

  /** Copy static files or directories without processing */
  copy(from: string, to?: string | ((path: string) => string)): this;
  copy(from: string[], to?: (path: string) => string): this;
  copy(
    from: string | string[],
    to?: string | ((path: string) => string),
  ): this {
    // File extensions
    if (Array.isArray(from)) {
      if (typeof to === "string") {
        throw new Exception(
          "copy() files by extension expects a function as second argument",
          { to },
        );
      }

      from.forEach((ext) => {
        this.formats.set({ ext, copy: to ? to : true });
      });
      return this;
    }

    this.source.addStaticPath(from, to);
    return this;
  }

  /** Copy the remaining files */
  copyRemainingFiles(
    filter: (path: string) => string | boolean = () => true,
  ): this {
    this.source.copyRemainingFiles = filter;
    return this;
  }

  /** Ignore one or several files or directories */
  ignore(...paths: (string | ScopeFilter)[]): this {
    paths.forEach((path) => {
      if (typeof path === "string") {
        this.source.addIgnoredPath(path);
      } else {
        this.source.addIgnoreFilter(path);
      }
    });
    return this;
  }

  /** Define independent scopes to optimize the update process */
  scopedUpdates(...scopes: ScopeFilter[]): this {
    scopes.forEach((scope) => this.scopes.scopes.add(scope));
    return this;
  }

  /** Define a remote fallback for a missing local file */
  remoteFile(filename: string, url: string): this {
    this.fs.remoteFiles.set(posix.join("/", filename), url);
    return this;
  }

  /** Save into the cache the content of a file */
  cacheFile(filename: string, data: Data): this {
    const entry = this.fs.addEntry({ path: filename, type: "file" });
    const format = this.formats.get(filename);
    entry.setContent(
      format?.pageLoader || format?.dataLoader || textLoader,
      data,
    );

    return this;
  }

  /** Clear the dest directory and any cache */
  async clear(): Promise<void> {
    await this.writer.clear();
  }

  /** Build the entire site */
  async build(): Promise<void> {
    if (await this.dispatchEvent({ type: "beforeBuild" }) === false) {
      return;
    }

    if (this.options.emptyDest) {
      await this.clear();
    }

    // Load source files
    this.fs.init();

    // Get the site content
    const isDev = Deno.env.get("LUME_ENV") === "development";
    const [_pages, _staticFiles] = await this.source.build(
      this.globalComponents,
      [
        (_, page) => !page?.data.draft || isDev,
      ],
    );

    // Save static files into site.files
    this.files.splice(0, this.files.length, ..._staticFiles);

    // Stop if the build is cancelled
    if (await this.#buildPages(_pages) === false) {
      return;
    }

    // Save the pages and copy static files in the dest folder
    const pages = await this.writer.savePages(this.pages);
    const staticFiles = await this.writer.copyFiles(this.files);
    this.logger.log();

    await this.dispatchEvent({ type: "afterBuild", pages, staticFiles });
  }

  /** Reload some files that might be changed */
  async update(files: Set<string>): Promise<void> {
    if (await this.dispatchEvent({ type: "beforeUpdate", files }) === false) {
      return;
    }

    this.searcher.deleteCache();

    // Reload the changed files
    for (const file of files) {
      // Delete the file from the cache
      this.formats.deleteCache(file);
      const entry = this.fs.update(file);

      if (!entry) {
        continue;
      }

      // Remove pages or static files depending on this entry
      const pages = this.pages.filter((page) => page.src.entry === entry).map((
        page,
      ) => page.outputPath) as string[];
      const files = this.files.filter((file) => file.entry === entry).map((
        file,
      ) => file.outputPath) as string[];
      this.writer.removeFiles([...pages, ...files]);
    }

    // Get the site content
    const isDev = Deno.env.get("LUME_ENV") === "development";
    const [_pages, _staticFiles] = await this.source.build(
      this.globalComponents,
      [
        (_, page) => !page?.data.draft || isDev,
        this.scopes.getFilter(files),
      ],
    );

    // Build the pages and save static files into site.files
    this.files.splice(0, this.files.length, ..._staticFiles);

    if (await this.#buildPages(_pages) === false) {
      return;
    }

    // Save the pages and copy static files in the dest folder
    const pages = await this.writer.savePages(this.pages);
    const staticFiles = await this.writer.copyFiles(this.files);

    if (pages.length || staticFiles.length) {
      this.logger.log();
    }

    await this.dispatchEvent({
      type: "afterUpdate",
      files,
      pages,
      staticFiles,
    });
  }

  /**
   * Internal function to render pages
   * The common operations of build and update
   */
  async #buildPages(pages: Page[]): Promise<boolean> {
    if (await this.dispatchEvent({ type: "beforeRender", pages }) === false) {
      return false;
    }

    // Render the pages
    this.pages.splice(0);
    this.onDemandPages.splice(0);
    await this.renderer.renderPages(pages, this.pages, this.onDemandPages);

    // Add extra code generated by the components
    for (const extra of this.source.getComponentsExtraCode()) {
      const exists = this.pages.find((page) =>
        page.data.url === extra.data.url
      );

      // If it's duplicated, merge the content
      if (exists) {
        exists.content = `${exists.content}\n${extra.content}`;
      } else {
        this.pages.push(extra);
      }
    }

    // Remove empty pages and ondemand pages
    this.pages.splice(
      0,
      this.pages.length,
      ...this.pages.filter((page) => {
        if (page.data.url === false) {
          return false;
        }

        const shouldSkip = !page.content || page.data.ondemand;
        if (shouldSkip) {
          this.logger.warn(
            `Skipped page ${page.data.url} (${
              page.data.ondemand
                ? "page is build only on demand"
                : "file content is empty"
            })`,
          );
        }
        return !shouldSkip;
      }),
    );

    if (
      await this.events.dispatchEvent({
        type: "afterRender",
        pages: this.pages,
      }) === false
    ) {
      return false;
    }

    // Run the processors to the pages
    await this.processors.run(this.pages);

    return await this.dispatchEvent({ type: "beforeSave" });
  }

  /** Render a single page (used for on demand rendering) */
  async renderPage(
    file: string,
    extraData?: Record<string, unknown>,
  ): Promise<Page | undefined> {
    // Load the page
    this.fs.init();

    // Get the site content
    const [pages] = await this.source.build(
      this.globalComponents,
      [
        (entry) =>
          (entry.type === "directory" && file.startsWith(entry.path)) ||
          entry.path === file,
      ],
    );

    const page = pages[0];

    if (!page) {
      return;
    }

    // Add extra data
    if (extraData) {
      page.data = { ...page.data, ...extraData };
    }

    await this.dispatchEvent({ type: "beforeRenderOnDemand", page });

    // Render the page
    await this.renderer.renderPageOnDemand(page);

    // Run the processors to the page
    await this.processors.run([page]);
    return page;
  }

  /** Return the URL of a path */
  url(path: string, absolute = false): string {
    if (
      path.startsWith("./") || path.startsWith("../") ||
      path.startsWith("?") || path.startsWith("#") || path.startsWith("//")
    ) {
      return path;
    }

    // It's a source file
    if (path.startsWith("~/")) {
      path = decodeURI(path.slice(1));

      // Has a search query
      const match = path.match(/^(.*)\s*\(([^)]+)\)$/);
      const srcPath = match ? match[1] : path;
      const pages = match
        ? this.searcher.pages(match[2]).map<Page>((data) => data.page!)
        : this.pages;

      // It's a page
      const page = pages.find((page) =>
        page.src.path + page.src.ext === srcPath
      );

      if (page) {
        path = page.data.url as string;
      } else {
        // It's a static file
        const file = this.files.find((file) => file.entry.path === path);

        if (file) {
          path = file.outputPath;
        } else {
          throw new Error(`Source file not found: ${path}`);
        }
      }
    } else {
      // Absolute URLs are returned as is
      try {
        return new URL(path).href;
      } catch {
        // Ignore error
      }
    }

    if (!path.startsWith(this.options.location.pathname)) {
      path = posix.join(this.options.location.pathname, path);
    }

    return absolute ? this.options.location.origin + path : path;
  }

  /**
   * Get the content of a file.
   * Resolve the path if it's needed.
   */
  async getContent(
    file: string,
    loader: Loader,
  ): Promise<string | Uint8Array | undefined> {
    file = normalizePath(file);
    const basePath = this.src();

    if (file.startsWith(basePath)) {
      file = normalizePath(file.slice(basePath.length));
    }

    // It's a page
    const page = this.pages.find((page) => page.data.url === file);

    if (page) {
      return page.content;
    }

    // It's a static file
    const staticFile = this.files.find((f) => f.outputPath === file);

    if (staticFile) {
      return (await staticFile.entry.getContent(loader)).content as
        | string
        | Uint8Array;
    }

    // Read the source files directly
    try {
      const entry = this.fs.entries.get(file);
      if (entry) {
        return (await entry.getContent(loader)).content as string | Uint8Array;
      }
    } catch {
      // Ignore error
    }
  }
}

/** The options for the resolve function */
export interface ResolveOptions {
  /** Whether search in the includes folder or not */
  includes?: boolean;

  /** Default loader */
  loader?: Loader;
}

/** The options to configure the site build */
export interface SiteOptions {
  /** The path of the current working directory */
  cwd: string;

  /** The path of the site source */
  src: string;

  /** The path of the built destination */
  dest: string;

  /** Whether the empty folder should be emptied before the build */
  emptyDest?: boolean;

  /** The default includes path */
  includes: string;

  /** Set `true` to enable the `dev` mode */
  dev: boolean;

  /** The site location (used to generate final urls) */
  location: URL;

  /** Set true to generate pretty urls (`/about-me/`) */
  prettyUrls: boolean;

  /** Set `true` to skip logs */
  quiet: boolean;

  /** The local server options */
  server: ServerOptions;

  /** The local watcher options */
  watcher: WatcherOptions;

  /** The components options */
  components: ComponentsOptions;
}

/** The options to configure the local server */
export interface ServerOptions {
  /** The port to listen on */
  port: number;

  /** To open the server in a browser */
  open: boolean;

  /** The file to serve on 404 error */
  page404: string;

  /** Optional for the server */
  middlewares?: Middleware[];
}

/** The options to configure the local watcher */
export interface WatcherOptions {
  /** Paths to ignore by the watcher */
  ignore: (string | ((path: string) => boolean))[];

  /** The interval in milliseconds to check for changes */
  debounce: number;
}

/** The options to configure the components */
export interface ComponentsOptions {
  /** The variable name used to access to the components */
  variable: string;

  /** The name of the file to save the components css code */
  cssFile: string;

  /** The name of the file to save the components javascript code */
  jsFile: string;
}

export type SiteEventMap = {
  beforeBuild: {
    /** the list of pages that have been saved */
    pages: Page[];
  };
  afterBuild: {
    /** the list of pages that have been saved */
    pages: Page[];
    /** contains the list of static files that have been copied */
    staticFiles: StaticFile[];
  };
  beforeUpdate: {
    /** the files that were changed */
    files: Set<string>;
  };
  afterUpdate: {
    /** the files that were changed */
    files: Set<string>;
    /** the list of pages that have been saved */
    pages: Page[];
    /** contains the list of static files that have been copied */
    staticFiles: StaticFile[];
  };
  beforeRender: {
    /** the list of pages that have been saved */
    pages: Page[];
  };
  afterRender: {
    /** the list of pages that have been saved */
    pages: Page[];
  };
  beforeRenderOnDemand: {
    /** the page that will be rendered */
    page: Page;
  };
  // deno-lint-ignore ban-types
  beforeSave: {};
  // deno-lint-ignore ban-types
  afterStartServer: {};
};

/** Custom events for site build */
export type SiteEvent<T extends SiteEventType = SiteEventType> =
  & Event
  & SiteEventMap[T]
  & { type: T };

/** The available event types */
export type SiteEventType = keyof SiteEventMap;
