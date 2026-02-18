/**
 * Copyright 2025 Arm Limited
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

import { AbstractAsset, Asset } from './downloader.ts';
import path from 'node:path';
import { OutgoingHttpHeaders } from 'node:http';
import fs from 'node:fs/promises';

/**
 * Asset to be extracted from an archive file.
 */
export class ArchiveFileAsset extends AbstractAsset {

    /**
     * Creates an instance of ArchiveFileAsset.
     * @param subject Another asset that provides the archive file.
     * @param strip The number of leading components to strip from the file paths when extracting.
     */
    constructor(
        protected readonly subject: Asset,
        protected readonly strip: number = 0,
    ) {
        super();
        this.addDisposable(this.subject);
    }

    public withCacheDir(cacheDir: string): Asset {
        this.subject.withCacheDir(cacheDir);
        return super.withCacheDir(cacheDir);
    }

    public get version() {
        return this.subject.version;
    }

    public async copyTo(dest?: string) {
        const archiveFile = await this.subject.copyTo();
        return this.extractArchive(archiveFile, dest, { strip: this.strip });
    }

}

/**
 * Asset that represents a file available at a URL.
 */
export class WebFileAsset extends AbstractAsset {

    /**
     * Creates an instance of WebFileAsset.
     * If the file is an archive, consider chaining with `ArchiveFileAsset`.
     * @param url The URL to download the file from.
     * @param filename The filename to save the downloaded file as. If not provided, the filename will be derived from the URL.
     * @param _version The version of the file, if applicable.
     * @param headers Additional HTTP headers to include in the request when downloading the file, e.g. for authentication.
     */
    constructor(
        protected readonly url: URL,
        protected readonly filename?: string,
        protected readonly _version?: string,
        protected readonly headers: OutgoingHttpHeaders = {},
    ) {
        super();
    }

    get version() {
        return this._version;
    }

    get cacheId() {
        const dirname = path.dirname(this.url.pathname);
        const basename = path.basename(this.url.pathname, path.extname(this.url.pathname));
        // Add a suffix to ensure this is always a directory and never conflicts with a file
        return path.normalize(path.join(this.url.host, dirname, basename + '_cache'));
    }

    public async copyTo(dest?: string) {
        dest = await this.mkDest(dest);
        const destFile = path.join(dest, this.filename ?? path.basename(this.url.pathname));
        return this.downloadFile(this.url, destFile, this.headers);
    }

}

/**
 * Asset that represents a local file on the filesystem.
 */
export class LocalFileAsset extends AbstractAsset {

    /**
     * Creates an instance of LocalFileAsset.
     * If the file is an archive, consider chaining with `ArchiveFileAsset`.
     * @param filepath The path to the local file.
     * @param targetName The name to use for the file when copying, if different from the original.
     */
    constructor(
        protected readonly filepath: string,
        protected readonly targetName?: string,
    ) {
        super();
    }

    public async copyTo(dest?: string) {
        dest = await this.mkDest(dest);
        await fs.copyFile(this.filepath, path.join(dest, this.targetName ?? path.basename(this.filepath)));
        return dest;
    }

}

