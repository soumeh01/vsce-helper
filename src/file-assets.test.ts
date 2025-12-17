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

import { ArchiveFileAsset, LocalFileAsset, WebFileAsset } from './file-assets.ts';

import nock from 'nock';

import { describe, it, vitest, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { vol } from 'memfs';
import path from 'path';
import { Asset } from './downloader.ts';
import fs from 'node:fs/promises';
import fastExtract from 'fast-extract';

vitest.mock('node:fs', async () => {
    const actualFs = await import('memfs');
    return {
        ...actualFs.fs,
        createWriteStream: vitest.fn(actualFs.fs.createWriteStream),
    };
});
vitest.mock('node:fs/promises');
vitest.mock('fast-extract');

beforeEach(() => {
    vol.reset();
    vitest.clearAllMocks();
});

describe('ArchiveFileAsset', () => {

    describe('copyTo', () => {
        it('extracts archive into target dir', async () => {
            const targetDir = faker.system.directoryPath();
            const archiveFile = path.join(targetDir, faker.system.commonFileName('tar.gz'));

            const subjectMock: Asset = {
                version: faker.system.semver(),
                cacheId: undefined,
                withCacheDir: vitest.fn().mockReturnThis(),
                copyTo: vitest.fn().mockResolvedValue(archiveFile),
                dispose: vitest.fn().mockResolvedValue(undefined),
            };

            const asset = new ArchiveFileAsset(subjectMock, 1);

            const result = await asset.copyTo(targetDir);

            expect(result).toBe(targetDir);
            expect(subjectMock.copyTo).toHaveBeenCalledWith();
            expect(fastExtract).toHaveBeenCalledWith(archiveFile, targetDir, { force: true, strip: 1 });

            await asset.dispose();
            expect(fs.rm).not.toHaveBeenCalledWith(expect.any(String), { force: true, recursive: true });
        });

        it('extracts archive into temp dir', async () => {
            const targetDir = faker.system.directoryPath();
            const archiveFile = path.join(targetDir, faker.system.commonFileName('tar.gz'));

            const subjectMock: Asset = {
                version: faker.system.semver(),
                cacheId: undefined,
                withCacheDir: vitest.fn().mockReturnThis(),
                copyTo: vitest.fn().mockResolvedValue(archiveFile),
                dispose: vitest.fn().mockResolvedValue(undefined),
            };

            const asset = new ArchiveFileAsset(subjectMock, 1);

            const result = await asset.copyTo();

            expect(result).toBeDefined();
            expect(subjectMock.copyTo).toHaveBeenCalledWith();
            expect(fastExtract).toHaveBeenCalledWith(archiveFile, expect.any(String), { force: true, strip: 1 });

            await asset.dispose();
            expect(fs.rm).toHaveBeenCalledWith(result, { force: true, recursive: true });
        });
    });

    it('version returns subject version', () => {
        const version = faker.system.semver();
        const subjectMock: Asset = {
            version,
            cacheId: undefined,
            withCacheDir: vitest.fn().mockReturnThis(),
            copyTo: vitest.fn().mockResolvedValue(''),
            dispose: vitest.fn().mockResolvedValue(undefined),
        };

        const asset = new ArchiveFileAsset(subjectMock, 1);

        expect(asset.version).toBe(version);
    });

    it('withCacheDir sets cache dir on subject', () => {
        const targetDir = faker.system.directoryPath();
        const cacheDir = path.join(targetDir, 'cache');
        const subjectMock: Asset = {
            version: faker.system.semver(),
            cacheId: undefined,
            withCacheDir: vitest.fn().mockReturnThis(),
            copyTo: vitest.fn().mockResolvedValue(''),
            dispose: vitest.fn().mockResolvedValue(undefined),
        };

        const asset = new ArchiveFileAsset(subjectMock, 1).withCacheDir(cacheDir);

        expect(asset).toBeInstanceOf(ArchiveFileAsset);
        expect(subjectMock.withCacheDir).toHaveBeenCalledWith(cacheDir);
    });

});

describe('WebFileAsset', () => {

    describe('copyTo', () => {
        it('downloads into target dir with given target filename', async () => {
            const targetDir = faker.system.directoryPath();
            const url  = new URL(faker.system.fileName(), faker.internet.url());
            const filename = faker.system.fileName();
            const content = faker.lorem.paragraph();
            const asset = new WebFileAsset(url, filename);

            expect(asset.version).toBeUndefined();

            nock(url.origin)
                .get(url.pathname)
                .reply(200, content);

            const expectedResult = path.join(targetDir, filename);
            const result = await asset.copyTo(targetDir);

            expect(result).toBe(expectedResult);

            const disk = vol.toJSON();
            expect(disk[expectedResult]).toBe(content);

            await asset.dispose();
            expect(fs.rm).not.toHaveBeenCalledWith(expect.any(String), { force: true, recursive: true });
        });

        it('downloads into target dir with original filename', async () => {
            const targetDir = faker.system.directoryPath();
            const filename = faker.system.fileName();
            const url = new URL(filename, faker.internet.url());
            const content = faker.lorem.paragraph();
            const asset = new WebFileAsset(url);

            expect(asset.version).toBeUndefined();

            nock(url.origin)
                .get(url.pathname)
                .reply(200, content);

            const expectedResult = path.join(targetDir, filename);
            const result = await asset.copyTo(targetDir);

            expect(result).toBe(expectedResult);

            const disk = vol.toJSON();
            expect(disk[expectedResult]).toBe(content);

            await asset.dispose();
            expect(fs.rm).not.toHaveBeenCalledWith(expect.any(String), { force: true, recursive: true });
        });

        it('downloads into cache dir with original filename', async () => {
            const targetDir = faker.system.directoryPath();
            const filename = faker.system.fileName();
            const url = new URL(filename, faker.internet.url());
            const content = faker.lorem.paragraph();
            const asset = new WebFileAsset(url);

            expect(asset.version).toBeUndefined();

            nock(url.origin)
                .get(url.pathname)
                .reply(200, content);

            const expectedResult = path.join(targetDir, url.hostname, url.pathname, filename);
            const result = await asset.withCacheDir(targetDir).copyTo();

            expect(result).toBe(expectedResult);

            const disk = vol.toJSON();
            expect(disk[expectedResult]).toBe(content);

            await asset.dispose();
            expect(fs.rm).not.toHaveBeenCalledWith(expect.any(String), { force: true, recursive: true });
        });

        it('downloads into temp dir with original filename', async () => {
            const filename = faker.system.fileName();
            const url = new URL(filename, faker.internet.url());
            const content = faker.lorem.paragraph();
            const asset = new WebFileAsset(url);

            expect(asset.version).toBeUndefined();

            nock(url.origin)
                .get(url.pathname)
                .reply(200, content);

            const result = await asset.copyTo();

            expect(result).toMatch(new RegExp(`${filename}$`));

            const disk = vol.toJSON();
            expect(disk[result]).toBe(content);

            await asset.dispose();
            expect(fs.rm).toHaveBeenCalledWith(path.dirname(result), { force: true, recursive: true });
        });

    });

});

describe('LocalFileAsset', () => {

    describe('copyTo', () => {

        it('copies file to target dir with given target name', async () => {
            const targetDir = faker.system.directoryPath();
            const filepath = faker.system.filePath();
            const content = faker.lorem.paragraph();
            vol.fromJSON({ [filepath]: content });

            const targetName = faker.system.fileName();
            const asset = new LocalFileAsset(filepath, targetName);

            expect(asset.version).toBeUndefined();

            const expectedResult = path.join(targetDir, targetName);
            const result = await asset.copyTo(targetDir);

            expect(result).toBe(targetDir);
            expect(vol.toJSON()[expectedResult]).toBe(content);
        });

        it('copies file to target dir with original filename', async () => {
            const targetDir = faker.system.directoryPath();
            const filepath = faker.system.filePath();
            const content = faker.lorem.paragraph();
            vol.fromJSON({ [filepath]: content });

            const asset = new LocalFileAsset(filepath);

            expect(asset.version).toBeUndefined();

            const expectedResult = path.join(targetDir, path.basename(filepath));
            const result = await asset.copyTo(targetDir);

            expect(result).toBe(targetDir);
            expect(vol.toJSON()[expectedResult]).toBe(content);
        });

    });

});
