/**
 * Copyright 2025-2026 Arm Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { exec as execAsync } from 'node:child_process';
import { downloadFile } from './file-download.ts';
import yargs, { Argv } from 'yargs';
import { hideBin } from 'yargs/helpers';
import { PackageJson } from 'type-fest';
import { promisify } from 'node:util';
import tempfile from 'tempfile';
import { OutgoingHttpHeaders } from 'node:http';
import extractZip from 'extract-zip';
import * as tar from 'tar';
import process from 'node:process';

const exec = promisify(execAsync);

export const PACKAGE_MANAGER = ['npm', 'yarn'] as const;
export type PackageManager = typeof PACKAGE_MANAGER[number];

/**
 * VS Code extension targets for VSCE packaging.
 */
export const VSCE_TARGETS = [
    'win32-x64',
    'win32-arm64',
    'linux-x64',
    'linux-arm64',
    'darwin-x64',
    'darwin-arm64',
] as const;
export type VsceTarget = typeof VSCE_TARGETS[number];

/**
 * Represents a single asset.
 */
export interface Asset {
    /** Version of this asset */
    version: Promise<string | undefined> | string | undefined;

    /** Cache ID for the asset */
    cacheId: Promise<string | undefined> | string | undefined;

    /**
     * Copy the asset into the given directory.
     *
     * If no directory is given, the asset is copied either
     * - to a temporary directory which is purged on disposal (see dispose).
     * - to the cache directory if available (see withCacheDir), or
     *
     * @param dest Target directory to copy the asset to.
     * @returns The path to the copied asset.
     */
    copyTo(dest?: string): Promise<string>;

    /**
     * Set the cache directory for the asset.
     *
     * @param cacheDir Cache directory to use for the asset.
     * @returns The asset itself, allowing for method chaining.
     */
    withCacheDir(cacheDir: string | undefined): Asset;

    /**
     * Dispose of the asset, cleaning up any resources it holds.
     */
    dispose(): Promise<void> | void;
}

export type DisposeFn = () => Promise<void> | void;
export type Disposable = { dispose: DisposeFn };

function isDisposable(obj: unknown): obj is Disposable {
    return obj !== undefined && obj !== null && typeof obj === 'object' && isDisposeFn((obj as Disposable).dispose);
}

function isDisposeFn(fn: unknown): fn is DisposeFn {
    return fn !== undefined && fn !== null && typeof fn === 'function';
}

export abstract class AbstractAsset implements Asset {

    abstract copyTo(dest?: string): Promise<string>;

    protected cacheDir: string | undefined;

    private readonly disposables = [] as DisposeFn[];
    protected addDisposable(fn: DisposeFn) : void;
    protected addDisposable(obj: Disposable) : void;

    protected addDisposable(arg: DisposeFn | Disposable) {
        switch (true) {
            case isDisposeFn(arg):
                this.disposables.push(arg as DisposeFn);
                break;
            case isDisposable(arg):
                this.disposables.push(arg.dispose.bind(arg));
                break;
            default:
                throw new TypeError(`Expected a function or an object with a dispose method, got ${typeof arg}`);
        }
    }

    public async dispose() {
        await Promise.all(this.disposables.map(fn => fn()));
    }

    public get version(): string | Promise<string | undefined> | undefined {
        return undefined;
    }

    public get cacheId() : Promise<string | undefined> | string | undefined{
        return undefined;
    }

    public withCacheDir(cacheDir: string): Asset {
        this.cacheDir = cacheDir;
        return this;
    }

    protected async mkDest(dest?: string) {
        if (dest === undefined) {
            return this.mkTempDir();
        }
        // Check if dest exists and is a file
        try {
            const stat = await fs.stat(dest);
            if (stat.isFile()) {
                throw new Error(`Cannot create directory '${dest}': a file with the same name already exists.`);
            }
        } catch (err: any) {
            if (err.code !== 'ENOENT') throw err;
            // ENOENT means it does not exist, so we can proceed
        }
        await fs.mkdir(dest, { recursive: true });
        return dest;
    }

    protected async mkTempDir() {
        if (this.cacheDir !== undefined) {
            const cacheId = await this.cacheId;
            if (cacheId !== undefined) {
                const tempDir = path.join(this.cacheDir, cacheId);
                try {
                    const stat = await fs.stat(tempDir);
                    if (stat.isFile()) {
                        throw new Error(`Cannot create temp directory '${tempDir}': a file with the same name already exists.`);
                    }
                } catch (err: any) {
                    if (err.code !== 'ENOENT') throw err;
                }
                await fs.mkdir(tempDir, { recursive: true });
                return tempDir;
            }
        }
        const tempDir = tempfile();
        try {
            const stat = await fs.stat(tempDir);
            if (stat.isFile()) {
                throw new Error(`Cannot create temp directory '${tempDir}': a file with the same name already exists.`);
            }
        } catch (err: any) {
            if (err.code !== 'ENOENT') throw err;
        }
        await fs.mkdir(tempDir, { recursive: true });
        this.addDisposable(() => fs.rm(tempDir, { force: true, recursive: true }));
        return tempDir;
    }

    protected async assureFile(path: string) {
        const stat = await fs.stat(path).catch(() => undefined);
        if (stat?.isFile() || stat?.isSymbolicLink()) {
            console.debug(`File ${path} already exists.`);
            return true;
        } else if (stat?.isDirectory()) {
            console.warn(`Directory at ${path} in the way, removing it.`);
            await fs.rm(path, { recursive: true, force: true });
        }
        return false;
    }

    protected async downloadFile(url: URL, downloadFilePath: string, headers: OutgoingHttpHeaders = {}) {
        if (await this.assureFile(downloadFilePath)) {
            return downloadFilePath;
        }
        console.debug(`Downloading ${url} ...`);
        return downloadFile(url.toString(), downloadFilePath, headers);
    }

    protected async extractArchive(archiveFile: string, dest?: string, options: { strip?: number; force?: boolean } = {}) {
        dest = await this.mkDest(dest);
        console.debug(`Extracting to ${dest} ...`);

        const ext = path.extname(archiveFile).toLowerCase();

        try {
            // Handle ZIP files
            if (ext === '.zip') {
                await extractZip(archiveFile, { dir: path.resolve(dest) });

                // Handle strip option for ZIP files if needed
                if (options.strip && options.strip > 0) {
                    await this.stripDirectories(dest, options.strip);
                }
            } else if (ext === '.gz' || ext === '.bz2' || ext === '.xz' || ext === '.tar' || ext === '.tgz') {
                // Handle tar.gz, tar.bz2, tar.xz files
                const tarOptions: Record<string, unknown> = {
                    cwd: dest,
                    strict: true,
                    file: archiveFile,
                };

                if (options.strip !== undefined) {
                    tarOptions.strip = options.strip;
                }

                await tar.extract(tarOptions);
            } else {
                throw new Error(`Unsupported archive format: ${ext}`);
            }
        } catch (error) {
            throw new Error('Failed to extract archive', { cause: error });
        }

        return dest;
    }

    private async stripDirectories(dir: string, levels: number): Promise<void> {
        if (levels <= 0) return;

        const entries = await fs.readdir(dir, { withFileTypes: true });

        // If there's only one directory, move its contents up
        if (entries.length === 1 && entries[0].isDirectory()) {
            const subDir = path.join(dir, entries[0].name);
            const tempDir = path.join(path.dirname(dir), `temp-${Date.now()}`);

            // Move subdirectory to temp location
            await fs.rename(subDir, tempDir);

            // Remove original directory
            await fs.rm(dir, { recursive: true, force: true });

            // Rename temp directory to original
            await fs.rename(tempDir, dir);

            // Recursively strip remaining levels
            await this.stripDirectories(dir, levels - 1);
        }
    }


    protected async copyRecursive(src: string, destDir: string, options: { strip: number } = { strip: 0 }) {
        const stat = await fs.stat(src).catch(() => undefined);
        if (stat?.isFile() || stat?.isSymbolicLink()) {
            await fs.copyFile(src, path.join(destDir, path.basename(src)));
        } else if (stat?.isDirectory()) {
            const content = await fs.readdir(src);
            const destPath = options.strip ? destDir : path.join(destDir, path.basename(src));
            await fs.mkdir(destPath, { recursive: true });
            await Promise.all(
                content.map(item => this.copyRecursive(path.join(src, item), destPath, { strip: options.strip > 0 ? options.strip - 1 : 0 }))
            );
        }
    }
}

/**
 * Represents a downloadable item.
 */
export interface Downloadable {
    /**
     * Name of the downloadable item.
     */
    readonly name: string;

    /**
     * Destination directory where the item will be downloaded to,
     * relative to the base tool folder.
     */
    readonly destination: string;

    /**
     * Retrieves the asset for the given target.
     * @param target The VSCE target for which to retrieve the asset.
     * @returns A promise that resolves to the asset, or undefined if not found.
     */
    readonly getAsset?: (target: VsceTarget) => Promise<Asset | undefined>;
}

class DownloadableImpl implements Downloadable {
    constructor(
        public readonly name: string,
        private readonly _destination: string | string[],
        public readonly getAsset: (target: VsceTarget) => Promise<Asset | undefined>
    ) {}

    public get destination(): string {
        if (Array.isArray(this._destination)) {
            return path.join(...this._destination);
        }
        return this._destination;
    }
}

interface DownloadableConstructor {
    new (name: string, destination: string | string[], getAsset: (target: VsceTarget) => Promise<Asset | undefined>): Downloadable;
}

export const Downloadable: DownloadableConstructor = DownloadableImpl;

/**
 * Downloader interface for managing the download of tools.
 */
export interface Downloader<T extends Record<string, Downloadable>> {
    /**
     * Set the project directory for the downloader,
     * defaults to the current working directory.
     * @param projectDir The project root directory.
     * @return The downloader instance for method chaining.
     */
    withProjectDir(projectDir: string): Downloader<T>;

    /**
     * Set the target directory for the downloader,
     * defaults to the tools directory.
     * @param targetDir The target directory where the tools will be downloaded to.
     * @return The downloader instance for method chaining.
     */
    withTargetDir(targetDir: string): Downloader<T>;

    /**
     * Set the cache directory for the downloader, defaults to undefined.
     * If set, downloaded files will be cached there for later reuse.
     * @param cacheDir The cache directory for downloaded tools.
     * @return The downloader instance for method chaining.
     */
    withCacheDir(cacheDir: string | undefined): Downloader<T>;

    /**
     * Get the package.json file of the project, i.e., <projectDir>/package.json.
     * @template J The type of the package.json file, defaults to PackageJson.
     * @returns A promise that resolves to the package.json content or undefined if not found.
     */
    getPackageJson<J extends PackageJson = PackageJson>(): Promise<J | undefined>;

    /**
     * Get the package manager used in the project, based on the package.json file.
     */
    packageManager(): Promise<PackageManager | undefined>;

    /**
     * Get the default cache directory based on the package manager.
     */
    defaultCacheDir(): Promise<string | undefined>;

    /**
     * Download a specific tool for the given target.
     * @param what The key of the tool to download.
     * @param target The VSCE target to download the tool for.
     * @param options Options for the download process.
     */
    download(what: keyof T, target: VsceTarget, options?: DownloadOptions): Promise<void>;

    /**
     * Run the command line interface for the downloader.
     * @param argv The command line arguments, defaults to process.argv.
     */

    run(argv?: string[]): Promise<void>;
}

// Ensure the directory does not exist
async function ensureNoDirectory(directoryPath: string) {
    try {
        await fs.rm(directoryPath, { recursive: true, force: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
};

// Ensure the directory is exists and is empty
async function ensureDirectory(directoryPath: string) {
    await ensureNoDirectory(directoryPath);
    await fs.mkdir(directoryPath, { recursive: true });
};

// Returns the contents of the file if it exists. If it does not exist, returns undefined.
async function maybeReadFile(filePath: string) {
    try {
        return await fs.readFile(filePath, { encoding: 'utf8' });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
        return undefined;
    }
};

/** Download options */
type DownloadOptions = {
     /** Force download even if the tool is already present. */
    force?: boolean;
};

class DownloaderImpl<T extends Record<string, Downloadable>> implements Downloader<T> {

    protected projectDir: string = process.cwd();
    protected targetDir: string = `${this.projectDir}/tools`;
    protected cacheDir: string | undefined = undefined;
    protected packageJson: PackageJson | undefined = undefined;
    protected readonly tools: string[];

    constructor(
        protected readonly downloadables: T
    ) {
        this.tools = Object.keys(this.downloadables);
    }

    protected parser() {
        const parser = yargs()
            .option('target', {
                alias: 't',
                description: 'VS Code extension target, defaults to system',
                type: 'string',
                choices: VSCE_TARGETS,
                default: `${os.platform()}-${os.arch()}`,
            })
            .option('dest', {
                alias: 'd',
                description: 'Destination directory for the tools',
                type: 'string',
                default: this.targetDir,
                normalize: true,
            })
            .option('force', {
                alias: 'f',
                description: 'Force download of tools',
                type: 'boolean',
                default: false,
            })
            .version(false)
            .strict()
            .command('$0 [<tools> ...]', 'Downloads the tool(s) for the given architecture and OS', y => {
                y.positional('tools', {
                    description: 'Dependency to be fetched',
                    type: 'string',
                    array: true,
                    choices: this.tools,
                    default: this.tools,
                });
            });

        if (this.cacheDir !== undefined)  {
            parser.option('cache', {
                alias: 'c',
                description: 'Cache directory for downloaded tools',
                type: 'string',
                default: this.cacheDir,
                normalize: true,
                coerce: (value: string | boolean) => typeof value === 'string' ? value : undefined,
            });
        }
        return parser as unknown as Argv<{
            target: VsceTarget;
            dest: string;
            force: boolean;
            cache?: string;
            tools: (keyof T)[];
        }>;
    }

    public async getPackageJson<J extends PackageJson = PackageJson>() : Promise<J | undefined> {
        if (this.packageJson === undefined) {
            const packageJsonPath = path.join(this.projectDir, 'package.json');
            const packageJsonContent = await fs.readFile(packageJsonPath, { encoding: 'utf-8' });
            const replaced = packageJsonContent.replaceAll(
                /"file:([^"]+)"/gm,
                (_, ...args) => `"file:${path.resolve(this.projectDir, args[0])}"`
            );
            this.packageJson = JSON.parse(replaced) as J;
        }
        return this.packageJson as J;
    }

    public async packageManager(): Promise<PackageManager | undefined> {
        const packageJson = await this.getPackageJson();
        return PACKAGE_MANAGER.find(pm => pm in (packageJson?.engines ?? {}));
    }

    public async defaultCacheDir(): Promise<string | undefined> {
        switch (await this.packageManager()) {
            case 'npm':
                return exec('npm config get cache').then(r => path.join(r.stdout.trim(), '_cacache'));
            case 'yarn':
                return exec('yarn cache dir').then(r => r.stdout.trim());
            default:
                console.info('No supported package manager found, disable caching.');
                return undefined;
        }
    }

    public withProjectDir(projectDir: string) {
        this.projectDir = projectDir;
        return this;
    }

    public withTargetDir(targetDir: string) {
        this.targetDir = targetDir;
        return this;
    }

    public withCacheDir(cacheDir: string | undefined) {
        this.cacheDir = cacheDir;
        return this;
    }

    public async download(what: keyof T, target: VsceTarget, options: DownloadOptions = {}) {
        const item = this.downloadables[what];

        const destination = path.join(this.targetDir, item.destination);
        const versionFilePath = path.join(destination, 'version.txt');
        const targetFilePath = path.join(destination, 'target.txt');

        console.log(`Downloading ${item.name} to ${destination}...`);

        const currentVersion = await maybeReadFile(versionFilePath);
        const currentTarget = await maybeReadFile(targetFilePath);

        const asset = await item.getAsset?.(target);
        if (!asset) {
            console.warn(`No asset found for ${item.name} for target ${target}. Skipping.`);
            return;
        }

        try {
            const assetVersion = await asset.version;
            if ((options?.force !== true) && (assetVersion !== undefined) && (currentVersion === assetVersion && currentTarget === target)) {
                console.info(`Already downloaded ${item.name} version ${currentVersion} for target ${target}.`);
                return;
            }

            await ensureDirectory(destination);
            await asset.withCacheDir(this.cacheDir).copyTo(destination);

            await fs.writeFile(versionFilePath, assetVersion ?? '', { encoding: 'utf8' });
            await fs.writeFile(targetFilePath, target, { encoding: 'utf8' });
        } catch (error) {
            console.error(`Failed to download ${item.name}:`, error);
            throw error;
        } finally {
            await asset.dispose();
        }

        console.log(`Copied ${item.name} to ${destination}...`);
    }

    public async run(argv = hideBin(process.argv)): Promise<void> {
        const args = await this.parser().parse(argv);
        const results = [] as Promise<void>[];
        this.targetDir = args.dest;
        this.cacheDir = args.cache;
        const options: DownloadOptions = (args);
        for (const tool of new Set(args.tools)) {
            results.push(this.download(tool, args.target, options));
        }
        await Promise.all(results);
    }

}

interface DownloaderConstructor {
    new <T extends Record<string, Downloadable>>(downloadables: T): Downloader<T>;
}

export const Downloader: DownloaderConstructor = DownloaderImpl;
