import { Exception } from "./errors.ts";
import { posix } from "../deps/path.ts";

import type { Data } from "../core.ts";

export interface Options {
  /** The root directory of the files */
  src: string;
}

/**
 * Class to read directories, files and store the content in a cache
 * It's used to avoid reading the same file multiple times
 */
export default class Reader {
  src: string;
  cache = new Map<string, Promise<Data>>();
  remoteFiles = new Map<string, RemoteFile>();
  remoteDirectories = new Set<string>();

  constructor(options: Options) {
    this.src = options.src;
  }

  /** Register a remote file */
  remoteFile(filename: string, url: string) {
    let directory = posix.dirname(filename);

    while (directory !== ".") {
      this.remoteDirectories.add(this.getFullPath(directory));
      directory = posix.dirname(directory);
    }

    this.remoteFiles.set(this.getFullPath(filename), {
      url,
      filename,
    });
  }

  /** Delete a file from the cache */
  deleteCache(path: string) {
    const fullPath = this.getFullPath(path);
    this.cache.delete(fullPath);
  }

  /** Delete all the cache */
  clearCache() {
    this.cache.clear();
  }

  getFullPath(path: string): string {
    const fullPath = posix.join(this.src, path);

    return fullPath.endsWith("/") ? fullPath.slice(0, -1) : fullPath;
  }

  /** Returns the file info of a path */
  async getInfo(path: string): Promise<Deno.FileInfo | undefined> {
    const fullPath = this.getFullPath(path);
    const remoteFile = this.remoteFiles.get(fullPath);
    const remoteDirectory = this.remoteDirectories.has(fullPath);

    try {
      const info = await Deno.stat(this.getFullPath(path));

      // The file exists locally, disable the remote file
      if (remoteFile) {
        remoteFile.disabled = true;
      }
      return info;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        // The file doesn't exist locally, enable the remote file
        if (remoteFile || remoteDirectory) {
          if (remoteFile) {
            remoteFile.disabled = false;
          }

          return {
            isFile: !!remoteFile,
            isDirectory: !remoteFile,
            isSymlink: false,
            size: 0,
            mtime: null,
            atime: null,
            birthtime: null,
            dev: null,
            ino: null,
            mode: null,
            nlink: null,
            uid: null,
            gid: null,
            rdev: null,
            blksize: null,
            blocks: null,
          };
        }
        return;
      }

      throw err;
    }
  }

  /** Reads a directory */
  async *readDir(path: string): AsyncIterable<Deno.DirEntry> {
    const fullPath = this.getFullPath(path);
    const remotes = new Set<string>();

    // Read real files
    try {
      for await (const entry of Deno.readDir(this.getFullPath(path))) {
        remotes.add(entry.name);
        yield entry;
      }
    } catch {
      // Ignore
    }

    // Read remote directories
    for (const directory of this.remoteDirectories) {
      if (posix.dirname(directory) === fullPath) {
        yield {
          name: posix.basename(directory),
          isFile: false,
          isDirectory: true,
          isSymlink: false,
        };
      }
    }

    // Read remote files
    for (const [file, remote] of this.remoteFiles) {
      if (posix.dirname(file) === fullPath) {
        const name = posix.basename(file);

        // Disable the remote file if it's locally in the directory
        remote.disabled = remotes.has(name);

        if (!remote.disabled) {
          yield {
            name,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
          };
        }
      }
    }
  }

  /** Read a file using a loader and return the content */
  async read(path: string, loader: Loader): Promise<Data> {
    const fullpath = this.getFullPath(path);
    const remote = this.remoteFiles.get(fullpath);
    const loadPath = (!remote || remote.disabled) ? fullpath : remote.url;

    try {
      if (!this.cache.has(fullpath)) {
        this.cache.set(fullpath, loader(loadPath));
      }

      return await this.cache.get(fullpath)!;
    } catch (cause) {
      throw new Exception("Couldn't load this file", { cause, fullpath });
    }
  }
}

/** A function that loads and returns the file content */
export type Loader = (path: string) => Promise<Data>;

interface RemoteFile {
  filename: string;
  url: string;
  disabled?: boolean;
  content?: string;
}
