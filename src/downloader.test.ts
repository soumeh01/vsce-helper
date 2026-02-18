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

import * as os from 'node:os';
import tempfile from 'tempfile';
// Mock tempfile globally for all tests
vitest.mock('tempfile', () => ({
    default: vitest.fn(() => `/tmp/mock-tempfile`)
}));
import { describe, it, expect, vitest, beforeEach } from 'vitest';
import { AbstractAsset, Asset, DisposeFn, Disposable, Downloadable, Downloader } from './downloader.ts';
import { vol } from 'memfs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { faker } from '@faker-js/faker';
import { OutgoingHttpHeaders } from 'node:http';
import { downloadFile } from './file-download.ts';

vitest.mock('node:fs/promises');
vitest.mock('./file-download.ts', () => ({
    downloadFile: vitest.fn((_url, dest, _header) => dest),
}));

const assetMock = vitest.mockObject<Asset>({
    version: '1.0.0',
    cacheId: undefined,
    copyTo: vitest.fn().mockImplementation((dest) => dest),
    withCacheDir: vitest.fn().mockReturnThis(),
    dispose: vitest.fn().mockResolvedValue(undefined),
});

const toolA: Downloadable = {
    name: 'Tool A',
    destination: '/path/to/toolA',
    getAsset: vitest.fn().mockResolvedValue(assetMock),
} as const;

const toolB: Downloadable = {
    name: 'Tool B',
    destination: '/path/to/toolB',
    getAsset: vitest.fn().mockResolvedValue(undefined),
} as const;

beforeEach(async () => {
    vol.reset();
    vitest.clearAllMocks();
});

describe('AbstractAsset', () => {

    class TestAsset extends AbstractAsset {
        public readonly _version = vitest.fn();
        public readonly _cacheId = vitest.fn();

        public get version() {
            return this._version();
        }

        public get cacheId() {
            return this._cacheId();
        }

        public async copyTo(destination: string): Promise<string> {
            return destination;
        }

        public addDisposableFn(fn: DisposeFn) {
            super.addDisposable(fn);
        }

        public addDisposableObj(obj: Disposable) {
            super.addDisposable(obj);
        }

        public async mkDest(dest?: string) {
            return super.mkDest(dest);
        }

        public async assureFile(path: string) {
            return super.assureFile(path);
        }

        public async downloadFile(url: URL, downloadFilePath: string, headers: OutgoingHttpHeaders = {}) {
            return super.downloadFile(url, downloadFilePath, headers);
        }

    };

    describe('dispose', () => {

        it('shall dispose all registered disposables', () => {
            const asset = new TestAsset();
            const disposeFn = vitest.fn();
            const disposable = { dispose: vitest.fn() };

            asset.addDisposableFn(disposeFn);
            asset.addDisposableObj(disposable);
            asset.addDisposableObj(disposable);
            asset.addDisposableFn(disposeFn);
            asset.addDisposableFn(disposeFn);

            asset.dispose();

            expect(disposeFn).toHaveBeenCalledTimes(3);
            expect(disposable.dispose).toHaveBeenCalledTimes(2);
        });

    });

    describe('mkDest', () => {

        it('throws if a file exists at dest', async () => {
            const targetDir = faker.system.directoryPath();
            const asset = new TestAsset();
            // Simulate file exists at dest
            (fs.stat as any).mockResolvedValueOnce({ isFile: () => true });
            await expect(asset.mkDest(targetDir)).rejects.toThrow(`Cannot create directory '${targetDir}': a file with the same name already exists.`);
        });

        it('throws if a file exists at temp dir', async () => {
            const asset = new TestAsset();
            // Simulate no cacheDir, so tempfile() is used
            const tempDir = '/tmp/mock-tempfile';
            // Simulate file exists at tempDir
            (fs.stat as any).mockResolvedValueOnce({ isFile: () => true });
            await expect(asset.mkDest()).rejects.toThrow(`Cannot create temp directory '${tempDir}': a file with the same name already exists.`);
        });

        it('shall create destination path and leave it on dispose', async () => {
            const targetDir = faker.system.directoryPath();
            const asset = new TestAsset();
            const dest = await asset.mkDest(targetDir);

            expect(dest).toBe(targetDir);
            expect(fs.mkdir).toHaveBeenCalledWith(dest, { recursive: true });

            asset.dispose();
            expect(fs.rm).not.toHaveBeenCalled();
        });

        it('shall create cache directory and leave it on dispose', async () => {
            const targetDir = faker.system.directoryPath();
            const asset = new TestAsset();

            asset.withCacheDir(targetDir);

            const cacheId = faker.string.uuid();
            asset._cacheId.mockReturnValue(cacheId);

            const dest = await asset.mkDest();
            expect(dest).toBe(path.join(targetDir, cacheId));
            expect(fs.mkdir).toHaveBeenCalledWith(dest, { recursive: true });

            asset.dispose();
            expect(fs.rm).not.toHaveBeenCalled();
        });

        it('shall create temp directory and purge it on dispose', async () => {
            const asset = new TestAsset();

            const dest = await asset.mkDest();
            expect(fs.mkdir).toHaveBeenCalledWith(dest, { recursive: true });

            asset.dispose();
            expect(fs.rm).toHaveBeenCalledWith(dest, { force: true, recursive: true });
        });

    });

    describe('assureFile', () => {

        it('returns false if file or directory does not exists', async () => {
            const targetDir = faker.system.directoryPath();
            const filename = faker.system.fileName();
            const asset = new TestAsset();

            const result = await asset.assureFile(path.join(targetDir, filename));
            expect(result).toBe(false);
        });

        it('returns true if file exists', async () => {
            const targetDir = faker.system.directoryPath();
            const filename = faker.system.fileName();
            const asset = new TestAsset();

            vol.fromJSON({ [filename]: faker.lorem.paragraph() }, targetDir);

            const result = await asset.assureFile(path.join(targetDir, filename));
            expect(result).toBe(true);
        });

        it('returns false if a directory is in the way', async () => {
            const targetDir = faker.system.directoryPath();
            const filename = faker.system.fileName();
            const asset = new TestAsset();

            vol.fromJSON({ [filename]: faker.lorem.paragraph() }, targetDir);

            const result = await asset.assureFile(targetDir);
            expect(result).toBe(false);
            expect(fs.rm).toHaveBeenCalledWith(targetDir, { force: true, recursive: true });
        });

    });

    describe('downloadFile', () => {

        it('issues download to given location', async () => {
            const asset = new TestAsset();
            const url = new URL(faker.internet.url());
            const filename = faker.system.filePath();
            const headers: OutgoingHttpHeaders = { [faker.lorem.word()]: faker.lorem.sentence() };

            const result = await asset.downloadFile(url, filename, headers);
            expect(result).toBe(filename);
            expect(downloadFile).toHaveBeenCalledWith(url.toString(), filename, headers);
        });

        it('skips download for existing', async () => {
            const asset = new TestAsset();
            const url = new URL(faker.internet.url());
            const filename = faker.system.filePath();
            const headers: OutgoingHttpHeaders = { [faker.lorem.word()]: faker.lorem.sentence() };

            vol.fromJSON({ [path.basename(filename)]: faker.lorem.paragraph() }, path.dirname(filename));

            const result = await asset.downloadFile(url, filename, headers);
            expect(result).toBe(filename);
            expect(downloadFile).not.toHaveBeenCalled();
        });

    });

});

describe('Downloader', () => {

    describe('download', () => {

        it('downloads the specified item', async () => {
            const targetDir = faker.system.directoryPath();
            const cacheDir = faker.system.directoryPath();

            const downloader = new Downloader({ toolA, toolB })
                .withTargetDir(targetDir)
                .withCacheDir(cacheDir);

            await expect(downloader.download('toolA', 'linux-arm64')).resolves.toBeUndefined();

            const expectedDest = path.join(targetDir, toolA.destination);

            expect(assetMock.withCacheDir).toHaveBeenCalledWith(cacheDir);
            expect(assetMock.copyTo).toHaveBeenCalledWith(expectedDest);
            expect(assetMock.dispose).toHaveBeenCalledOnce();
            expect(fs.rm).toHaveBeenCalledWith(expectedDest, { force: true, recursive: true });
            expect(fs.mkdir).toHaveBeenCalledWith(expectedDest, { recursive: true });
            expect(fs.readFile).toHaveBeenCalledWith(path.join(expectedDest, 'version.txt'), { encoding: 'utf8' });
            expect(fs.readFile).toHaveBeenCalledWith(path.join(expectedDest, 'target.txt'),  { encoding: 'utf8' });
            expect(fs.writeFile).toHaveBeenCalledWith(path.join(expectedDest, 'version.txt'), '1.0.0',  { encoding: 'utf8' });
            expect(fs.writeFile).toHaveBeenCalledWith(path.join(expectedDest, 'target.txt'), 'linux-arm64',  { encoding: 'utf8' });
        });

        it('skips downloads for already existing item', async () => {
            const targetDir = faker.system.directoryPath();
            const cacheDir = faker.system.directoryPath();

            const expectedDest = path.join(targetDir, toolA.destination);
            const json = {
                './version.txt': '1.0.0',
                './target.txt': 'linux-arm64',
            };
            vol.fromJSON(json, expectedDest);

            const downloader = new Downloader({ toolA, toolB })
                .withTargetDir(targetDir)
                .withCacheDir(cacheDir);

            await expect(downloader.download('toolA', 'linux-arm64')).resolves.toBeUndefined();

            expect(assetMock.withCacheDir).not.toHaveBeenCalled();
            expect(assetMock.copyTo).not.toHaveBeenCalled();
            expect(assetMock.dispose).toHaveBeenCalledOnce();
            expect(fs.rm).not.toHaveBeenCalled();
            expect(fs.mkdir).not.toHaveBeenCalled();
            expect(fs.readFile).toHaveBeenCalledWith(path.join(expectedDest, 'version.txt'), { encoding: 'utf8' });
            expect(fs.readFile).toHaveBeenCalledWith(path.join(expectedDest, 'target.txt'),  { encoding: 'utf8' });
            expect(fs.writeFile).not.toHaveBeenCalled();
            expect(fs.writeFile).not.toHaveBeenCalled();
        });

        it('repeat downloads for already existing item if forced', async () => {
            const targetDir = faker.system.directoryPath();
            const cacheDir = faker.system.directoryPath();

            const expectedDest = path.join(targetDir, toolA.destination);
            const json = {
                './version.txt': '1.0.0',
                './target.txt': 'linux-arm64',
            };
            vol.fromJSON(json, expectedDest);

            const downloader = new Downloader({ toolA, toolB })
                .withTargetDir(targetDir)
                .withCacheDir(cacheDir);

            await expect(downloader.download('toolA', 'linux-arm64', { force: true })).resolves.toBeUndefined();

            expect(assetMock.copyTo).toHaveBeenCalled();
        });

        it('repeat downloads for already existing item if version changed', async () => {
            const targetDir = faker.system.directoryPath();
            const cacheDir = faker.system.directoryPath();

            const expectedDest = path.join(targetDir, toolA.destination);
            const json = {
                './version.txt': '1.0.0-rc0',
                './target.txt': 'linux-arm64',
            };
            vol.fromJSON(json, expectedDest);

            const downloader = new Downloader({ toolA, toolB })
                .withTargetDir(targetDir)
                .withCacheDir(cacheDir);

            await expect(downloader.download('toolA', 'linux-arm64')).resolves.toBeUndefined();

            expect(assetMock.copyTo).toHaveBeenCalled();
        });

        it('repeat downloads for already existing item if target changed', async () => {
            const targetDir = faker.system.directoryPath();
            const cacheDir = faker.system.directoryPath();

            const expectedDest = path.join(targetDir, toolA.destination);
            const json = {
                './version.txt': '1.0.0',
                './target.txt': 'linux-amd64',
            };
            vol.fromJSON(json, expectedDest);

            const downloader = new Downloader({ toolA, toolB })
                .withTargetDir(targetDir)
                .withCacheDir(cacheDir);

            await expect(downloader.download('toolA', 'linux-arm64')).resolves.toBeUndefined();

            expect(assetMock.copyTo).toHaveBeenCalled();
        });

        it('disposes asset on error', async () => {
            const targetDir = faker.system.directoryPath();
            const cacheDir = faker.system.directoryPath();

            const downloader = new Downloader({ toolA, toolB })
                .withTargetDir(targetDir)
                .withCacheDir(cacheDir);

            assetMock.copyTo.mockRejectedValue(new Error('Download failed'));

            await expect(downloader.download('toolA', 'linux-arm64')).rejects.toThrow('Download failed');

            expect(assetMock.dispose).toHaveBeenCalled();
        });
    });

    describe('run', () => {
        const defaultTarget = `${os.platform()}-${os.arch()}`;

        it('issues downloads for all tools', async () => {
            const targetDir = faker.system.directoryPath();
            const cacheDir = faker.system.directoryPath();


            const downloader = new Downloader({ toolA, toolB })
                .withTargetDir(targetDir)
                .withCacheDir(cacheDir);

            downloader.download = vitest.fn().mockResolvedValue(undefined);

            await expect(downloader.run([])).resolves.toBeUndefined();

            expect(downloader.download).toHaveBeenCalledWith('toolA', defaultTarget, expect.objectContaining({ force: false }));
            expect(downloader.download).toHaveBeenCalledWith('toolB', defaultTarget, expect.objectContaining({ force: false }));
        });

        it('issues download for selected tool', async () => {
            const targetDir = faker.system.directoryPath();
            const cacheDir = faker.system.directoryPath();

            const downloader = new Downloader({ toolA, toolB })
                .withTargetDir(targetDir)
                .withCacheDir(cacheDir);

            downloader.download = vitest.fn().mockResolvedValue(undefined);

            await expect(downloader.run(['toolA'])).resolves.toBeUndefined();

            expect(downloader.download).toHaveBeenCalledWith('toolA', defaultTarget, expect.objectContaining({ force: false }));
            expect(downloader.download).not.toHaveBeenCalledWith('toolB', expect.anything(), expect.anything());
        });

        it('force download', async () => {
            const targetDir = faker.system.directoryPath();
            const cacheDir = faker.system.directoryPath();

            const downloader = new Downloader({ toolA, toolB })
                .withTargetDir(targetDir)
                .withCacheDir(cacheDir);

            downloader.download = vitest.fn().mockResolvedValue(undefined);

            await expect(downloader.run(['--force'])).resolves.toBeUndefined();

            expect(downloader.download).toHaveBeenCalledWith('toolA', defaultTarget, expect.objectContaining({ force: true }));
            expect(downloader.download).toHaveBeenCalledWith('toolB', defaultTarget, expect.objectContaining({ force: true }));
        });

    });

});
