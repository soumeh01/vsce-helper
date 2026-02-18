/**
 * Copyright 2026 Arm Limited
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArchiveFileAsset, LocalFileAsset } from './file-assets.ts';
import { Asset } from './downloader.ts';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { existsSync } from 'fs';
import archiver from 'archiver';
import * as tarModule from 'tar';
import { createWriteStream } from 'fs';

/**
 * Test-only asset that returns the archive file path instead of directory.
 * This is needed for integration testing of archive extraction.
 */
class ArchiveTestAsset implements Asset {
    constructor(private readonly archivePath: string) {}

    get version() {
        return undefined;
    }

    get cacheId() {
        return undefined;
    }

    withCacheDir(_cacheDir: string): Asset {
        return this;
    }

    async copyTo(_dest?: string): Promise<string> {
        // Return the archive file path directly for testing
        return this.archivePath;
    }

    async dispose(): Promise<void> {
        // No-op for test asset
    }
}

/**
 * Integration tests for archive format extraction.
 * These tests create real archive files and verify extraction works correctly.
 */
describe('Archive Format Integration Tests', () => {
    let tempDir: string;
    let testDataDir: string;

    beforeEach(async () => {
        // Create temporary directory for test files
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vsce-helper-test-'));
        testDataDir = path.join(tempDir, 'test-data');
        await fs.mkdir(testDataDir, { recursive: true });

        // Create test files with directory structure
        await fs.mkdir(path.join(testDataDir, 'root'), { recursive: true });
        await fs.mkdir(path.join(testDataDir, 'root', 'subdir'), { recursive: true });
        await fs.writeFile(path.join(testDataDir, 'root', 'file1.txt'), 'Content of file 1');
        await fs.writeFile(path.join(testDataDir, 'root', 'file2.txt'), 'Content of file 2');
        await fs.writeFile(path.join(testDataDir, 'root', 'subdir', 'file3.txt'), 'Content of file 3');
    });

    afterEach(async () => {
        // Cleanup temporary directory
        if (existsSync(tempDir)) {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    const archiveCases = [
        {
            name: 'zip',
            ext: '.zip',
            create: async (archivePath: string, _strip: number) => {
                return new Promise<void>((resolve, reject) => {
                    const output = createWriteStream(archivePath);
                    const archive = archiver('zip', { zlib: { level: 9 } });
                    output.on('close', () => resolve());
                    archive.on('error', reject);
                    archive.pipe(output);
                    // Always use the same structure for test
                    archive.directory(path.join(testDataDir, 'root'), false);
                    archive.finalize();
                });
            },
            strip: [0, 2],
            expected: (extractPath: string, _strip: number) => [
                path.join(extractPath, 'file1.txt'),
                path.join(extractPath, 'file2.txt'),
                path.join(extractPath, 'subdir', 'file3.txt'),
            ],
        },
        {
            name: 'tar.gz',
            ext: '.tar.gz',
            create: async (archivePath: string, _strip: number) => {
                await tarModule.create({ gzip: true, file: archivePath, cwd: testDataDir }, ['root']);
            },
            strip: [0, 1],
            expected: (extractPath: string, strip: number) => strip === 1
                ? [
                    path.join(extractPath, 'file1.txt'),
                    path.join(extractPath, 'file2.txt'),
                    path.join(extractPath, 'subdir', 'file3.txt'),
                ]
                : [
                    path.join(extractPath, 'root', 'file1.txt'),
                    path.join(extractPath, 'root', 'file2.txt'),
                    path.join(extractPath, 'root', 'subdir', 'file3.txt'),
                ],
        },
        {
            name: 'tgz',
            ext: '.tgz',
            create: async (archivePath: string, _strip: number) => {
                await tarModule.create({ gzip: true, file: archivePath, cwd: testDataDir }, ['root']);
            },
            strip: [0, 1],
            expected: (extractPath: string, strip: number) => strip === 1
                ? [
                    path.join(extractPath, 'file1.txt'),
                    path.join(extractPath, 'file2.txt'),
                    path.join(extractPath, 'subdir', 'file3.txt'),
                ]
                : [
                    path.join(extractPath, 'root', 'file1.txt'),
                    path.join(extractPath, 'root', 'file2.txt'),
                    path.join(extractPath, 'root', 'subdir', 'file3.txt'),
                ],
        },
        {
            name: 'tar.bz2',
            ext: '.tar.bz2',
            create: async (archivePath: string, _strip: number) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await tarModule.create({ bzip2: true, file: archivePath, cwd: testDataDir } as any, ['root']);
            },
            strip: [0, 1],
            expected: (extractPath: string, strip: number) => strip === 1
                ? [
                    path.join(extractPath, 'file1.txt'),
                    path.join(extractPath, 'subdir', 'file3.txt'),
                ]
                : [
                    path.join(extractPath, 'root', 'file1.txt'),
                    path.join(extractPath, 'root', 'file2.txt'),
                    path.join(extractPath, 'root', 'subdir', 'file3.txt'),
                ],
        },
        {
            name: 'tar.xz',
            ext: '.tar.xz',
            create: async (archivePath: string, _strip: number) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await tarModule.create({ xz: true, file: archivePath, cwd: testDataDir } as any, ['root']);
            },
            strip: [0, 1],
            expected: (extractPath: string, strip: number) => strip === 1
                ? [
                    path.join(extractPath, 'file1.txt'),
                    path.join(extractPath, 'file2.txt'),
                    path.join(extractPath, 'subdir', 'file3.txt'),
                ]
                : [
                    path.join(extractPath, 'root', 'file1.txt'),
                    path.join(extractPath, 'root', 'file2.txt'),
                    path.join(extractPath, 'root', 'subdir', 'file3.txt'),
                ],
        },
        {
            name: 'tar',
            ext: '.tar',
            create: async (archivePath: string, _strip: number) => {
                await tarModule.create({ file: archivePath, cwd: testDataDir }, ['root']);
            },
            strip: [0],
            expected: (extractPath: string, _strip: number) => [
                path.join(extractPath, 'root', 'file1.txt'),
                path.join(extractPath, 'root', 'file2.txt'),
                path.join(extractPath, 'root', 'subdir', 'file3.txt'),
            ],
        },
    ];

    archiveCases.forEach(({ name, ext, create, strip, expected }) => {
        strip.forEach(stripLevel => {
            it(`should extract ${name} archive${stripLevel ? ` with strip=${stripLevel}` : ''} correctly`, async () => {
                const archivePath = path.join(tempDir, `test${stripLevel ? '-strip' : ''}${ext}`);
                const extractPath = path.join(tempDir, `extracted-${name}${stripLevel ? '-strip' : ''}`);
                await create(archivePath, stripLevel);
                const asset = new ArchiveTestAsset(archivePath);
                const archiveAsset = new ArchiveFileAsset(asset, stripLevel);
                const result = await archiveAsset.copyTo(extractPath);
                expect(result).toBe(extractPath);
                for (const filePath of expected(extractPath, stripLevel)) {
                    expect(existsSync(filePath)).toBe(true);
                }
                await archiveAsset.dispose();
            });
        });
    });

    describe('Error handling', () => {
        it('should throw error for unsupported format', async () => {
            const unsupportedPath = path.join(tempDir, 'test.rar');
            await fs.writeFile(unsupportedPath, 'fake rar content');

            const localAsset = new LocalFileAsset(unsupportedPath);
            const archiveAsset = new ArchiveFileAsset(localAsset);

            await expect(archiveAsset.copyTo()).rejects.toThrow('Failed to extract archive');

            await archiveAsset.dispose();
        });

        it('should throw error for corrupted archive', async () => {
            const corruptedPath = path.join(tempDir, 'corrupted.tar.gz');
            await fs.writeFile(corruptedPath, 'this is not a valid tar.gz file');

            const localAsset = new LocalFileAsset(corruptedPath);
            const archiveAsset = new ArchiveFileAsset(localAsset);

            await expect(archiveAsset.copyTo()).rejects.toThrow();

            await archiveAsset.dispose();
        });
    });
});
