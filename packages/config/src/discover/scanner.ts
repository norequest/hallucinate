import type { FsReader } from "../loader.js";

/**
 * FsScanner is FsReader with symlink-safe directory listings.
 * The node-backed FsReader already satisfies this (listDirs skips symlinks).
 * A fake FsScanner in tests can omit symlinked entries from listDirs return values.
 */
export type FsScanner = FsReader;
