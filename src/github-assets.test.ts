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


import { describe, expect, it, vitest } from 'vitest';
import { MockedObjectDeep } from '@vitest/spy';
import { GitHubAsset, GitHubReleaseAsset, GitHubRepoAsset, GitHubWorkflowAsset } from './github-assets.ts';
import { downloadFile } from './file-download.ts';
import { faker } from '@faker-js/faker';
import { Octokit } from 'octokit';
import path from 'path';
import { fs, vol } from 'memfs';
import { toPosix } from './test-utils.ts';

type ExtractOptions = { strip?: number; force?: boolean };

vitest.mock('node:fs/promises');
vitest.mock('./file-download.ts', () => ({
    downloadFile: vitest.fn((_url, dest, _header) => dest),
}));

describe('GitHubAsset', () => {

    class GitHubAssetTest extends GitHubAsset {

        public versionMock = vitest.fn();
        public copyToMock = vitest.fn();
        public octokitMock: MockedObjectDeep<Octokit> | undefined = undefined;

        public get version() {
            return this.versionMock();
        }

        public async copyTo(dest?: string) {
            return this.copyToMock(dest);
        }

        public async getOctokit() {
            if (!this.octokitMock) {
                this.octokitMock = vitest.mockObject(await super.getOctokit());
            }
            return this.octokitMock;
        }

        public async downloadFile(url: URL, downloadFilePath: string) {
            return super.downloadFile(url, downloadFilePath);
        }

        public async resolveRef(ref: string) {
            return super.resolveRef(ref);
        }

        public async downloadRepo(dest: string, ref: string) {
            return super.downloadRepo(dest, ref);
        }
    }

    describe('downloadFile', () => {

        it('issues download with auth header', async () => {
            const owner = faker.lorem.word();
            const repo = faker.lorem.word();
            const token = faker.string.uuid();
            const asset = new GitHubAssetTest(owner, repo, { token });

            const url = new URL(faker.internet.url());
            const dest = faker.system.filePath();
            const result = await asset.downloadFile(url, dest);

            expect(result).toBe(dest);
            expect(downloadFile).toHaveBeenCalledWith(url.toString(), dest, {
                authorization: `Bearer ${token}`,
            });
        });

        it('issues download without auth header', async () => {
            const owner = faker.lorem.word();
            const repo = faker.lorem.word();
            const asset = new GitHubAssetTest(owner, repo);

            const url = new URL(faker.internet.url());
            const dest = faker.system.filePath();
            const result = await asset.downloadFile(url, dest);

            expect(result).toBe(dest);
            expect(downloadFile).toHaveBeenCalledWith(url.toString(), dest, {});
        });

    });

    describe('resolveRef', () => {

        it('returns commit sha of valid ref', async () => {
            const owner = faker.lorem.word();
            const repo = faker.lorem.word();
            const asset = new GitHubAssetTest(owner, repo);

            const refSha = faker.git.commitSha();
            const ref = `heads/${faker.git.branch()}`;

            const octokitMock = await asset.getOctokit();
            octokitMock.rest.git.getRef.mockResolvedValue({
                headers: {},
                status: 200,
                url: '',
                data: {
                    ref: ref,
                    node_id: '',
                    url: '',
                    object: {
                        url: '',
                        type: 'commit',
                        sha: refSha
                    }
                }
            });

            const result = await asset.resolveRef(ref);
            expect(result).toBe(refSha);

            const result2 = await asset.resolveRef(ref);
            expect(result2).toBe(refSha);

            expect(octokitMock.rest.git.getRef).toHaveBeenCalledExactlyOnceWith({ owner, repo, ref });
        });

    });

    describe('downloadRepo', async () => {

        it('issues download of repository tarball', async () => {
            const owner = faker.lorem.word();
            const repo = faker.lorem.word();
            const asset = new GitHubAssetTest(owner, repo);

            const ref = `heads/${faker.git.branch()}`;
            const dest = faker.system.directoryPath();
            const url = faker.internet.url({ appendSlash: true });

            const octokitMock = await asset.getOctokit();
            octokitMock.rest.repos.downloadTarballArchive.mockResolvedValue({
                headers: {},
                status: 302,
                url: url,
                data: {},
            });

            const expectedResult = path.join(dest, 'repo.tar.gz');
            const result = await asset.downloadRepo(dest, ref);

            expect(result).toBe(expectedResult);
            expect(downloadFile).toHaveBeenCalledWith(url, expectedResult, {});
        });

    });

});

describe('GitHubReleaseAsset', () => {

    class GitHubReleaseAssetTest extends GitHubReleaseAsset {
        public octokitMock: MockedObjectDeep<Octokit> | undefined = undefined;

        public async getOctokit() {
            if (!this.octokitMock) {
                this.octokitMock = vitest.mockObject(await super.getOctokit());
            }
            return this.octokitMock;
        }

    }

    describe('copyTo', async () => {

        it('issues download of release asset', async () => {
            const owner = faker.lorem.word();
            const repo = faker.lorem.word();
            const tag = `v${faker.system.semver()}`;
            const assetName = faker.system.commonFileName('.tar.gz');
            const targetDir = faker.system.directoryPath();
            const url = faker.internet.url({ appendSlash: true });
            const id = faker.number.int();

            const asset = new GitHubReleaseAssetTest(owner, repo, tag, assetName);

            const octokitMock = await asset.getOctokit();
            octokitMock.rest.repos.listReleases.mockResolvedValue({
                headers: {},
                status: 200,
                url: '',
                data: [{
                    id: id,
                    url: '',
                    html_url: '',
                    assets_url: '',
                    upload_url: '',
                    tarball_url: null,
                    zipball_url: null,
                    node_id: '',
                    tag_name: tag,
                    target_commitish: '',
                    name: null,
                    draft: false,
                    prerelease: false,
                    created_at: '',
                    published_at: null,
                    assets: [],
                    author: {
                        name: faker.person.fullName(),
                        email: faker.internet.email(),
                        login: faker.person.zodiacSign(),
                        id: faker.number.int(),
                        node_id: faker.string.uuid(),
                        avatar_url: faker.internet.url(),
                        gravatar_id: null,
                        url: '',
                        html_url: '',
                        followers_url: '',
                        following_url: '',
                        gists_url: '',
                        starred_url: '',
                        subscriptions_url: '',
                        organizations_url: '',
                        repos_url: '',
                        events_url: '',
                        received_events_url: '',
                        type: '',
                        site_admin: false,
                        starred_at: faker.date.past().toISOString(),
                        user_view_type: 'public'
                    }
                }]
            });
            octokitMock.rest.repos.listReleaseAssets.mockResolvedValue({
                headers: {},
                status: 200,
                url: '',
                data: [{
                    id: id,
                    name: assetName,
                    browser_download_url: url,
                    content_type: 'application/gzip',
                    size: faker.number.int({ min: 1000, max: 100000 }),
                    digest: null,
                    url: url,
                    node_id: '',
                    label: null,
                    state: 'uploaded',
                    download_count: 0,
                    created_at: '',
                    updated_at: '',
                    uploader: null
                }],
            });

            const result = await asset.copyTo(targetDir);
            const expectedResult = path.join(targetDir, assetName);

            expect(result).toBe(expectedResult);
            expect(downloadFile).toHaveBeenCalledWith(url, expectedResult, {});
        });

    });

});

describe('GitHubRepoAsset', () => {

    class GitHubRepoAssetTest extends GitHubRepoAsset {
        public octokitMock: MockedObjectDeep<Octokit> | undefined = undefined;

        public async getOctokit() {
            if (!this.octokitMock) {
                this.octokitMock = vitest.mockObject(await super.getOctokit());
            }
            return this.octokitMock;
        }

        public downloadRepo = vitest.fn(async (dest: string, _ref: string)  => path.join(dest, 'repo.tar.gz'));
        public extractArchive = vitest.fn(async (_archiveFile: string, dest?: string, _options: ExtractOptions = {}) => dest ?? faker.system.directoryPath());
    }

    describe('copyTo', async () => {

        it('issues download of repository snapshot and copy subfolder', async () => {
            const targetDir = faker.system.directoryPath();
            const owner = faker.lorem.word();
            const repo = faker.lorem.word();
            const ref = `heads/${faker.git.branch()}`;
            const repoFolder = faker.system.directoryPath();
            const repoFile = faker.system.commonFileName('txt');
            const repoFileContent = faker.lorem.paragraph();

            const asset = new GitHubRepoAssetTest(owner, repo, { ref: ref, path: repoFolder });

            asset.extractArchive.mockImplementation(async (_archiveFile: string, dest?: string, _options: ExtractOptions = {}) => {
                dest = dest ?? faker.system.directoryPath();
                fs.mkdirSync(path.join(dest, repoFolder), { recursive: true });
                fs.writeFileSync(path.join(dest, repoFolder, repoFile), repoFileContent);
                return dest;
            });

            const result = await asset.copyTo(targetDir);
            await asset.dispose();

            expect(result).toBe(targetDir);

            expect(vol.toJSON()).toEqual(expect.objectContaining({
                [toPosix(path.join(targetDir, repoFile))]: repoFileContent,
            }));
        });

        it('issues download of repository snapshot and copy single file', async () => {
            const targetDir = faker.system.directoryPath();
            const owner = faker.lorem.word();
            const repo = faker.lorem.word();
            const ref = `heads/${faker.git.branch()}`;
            const repoFolder = faker.system.directoryPath();
            const repoFile = faker.system.commonFileName('txt');
            const repoFileContent = faker.lorem.paragraph();

            const asset = new GitHubRepoAssetTest(owner, repo, { ref: ref, path: path.join(repoFolder, repoFile) });

            asset.extractArchive.mockImplementation(async (_archiveFile: string, dest?: string, _options: ExtractOptions = {}) => {
                dest = dest ?? faker.system.directoryPath();
                fs.mkdirSync(path.join(dest, repoFolder), { recursive: true });
                fs.writeFileSync(path.join(dest, repoFolder, repoFile), repoFileContent);
                return dest;
            });

            const result = await asset.copyTo(targetDir);
            await asset.dispose();

            expect(result).toBe(targetDir);

            expect(vol.toJSON()).toEqual(expect.objectContaining({
                [toPosix(path.join(targetDir, repoFile))]: repoFileContent,
            }));
        });

    });

});

describe('GitHubWorkflowAsset', () => {

    class GitHubWorkflowAssetTest extends GitHubWorkflowAsset {
        public octokitMock: MockedObjectDeep<Octokit> | undefined = undefined;

        public async getOctokit() {
            if (!this.octokitMock) {
                this.octokitMock = vitest.mockObject(await super.getOctokit());
            }
            return this.octokitMock;
        }

        public downloadArtifact = vitest.fn(super.downloadArtifact);
        public extractArchive = vitest.fn(super.extractArchive);
    }

    describe('downloadArtifact', async () => {

        it('downloads artifact', async () => {
            const targetDir = faker.system.directoryPath();
            const owner = faker.lorem.word();
            const repo = faker.lorem.word();
            const workflow = faker.system.commonFileName('.yml');
            const artifactName = faker.lorem.word();
            const artifactId = faker.number.int();
            const artifactArchive = faker.system.commonFileName('zip');
            const downloadFilePath = path.join(targetDir, artifactArchive);
            const content = faker.lorem.paragraph();
            const contentBuffer = Buffer.from(content, 'utf-8');

            const asset = new GitHubWorkflowAssetTest(owner, repo, workflow, artifactName);

            const octokitMock = await asset.getOctokit();
            octokitMock.rest.actions.downloadArtifact.mockResolvedValue({
                headers: {},
                status: 302,
                url: faker.internet.url({ appendSlash: true }),
                data: contentBuffer,
            });

            const result = await asset.downloadArtifact(artifactId, downloadFilePath);

            expect(result).toBe(downloadFilePath);
            expect(vol.toJSON()).toEqual(expect.objectContaining({
                [toPosix(downloadFilePath)]: content,
            }));
        });

        it('skips download if file already exists', async () => {
            const targetDir = faker.system.directoryPath();
            const owner = faker.lorem.word();
            const repo = faker.lorem.word();
            const workflow = faker.system.commonFileName('.yml');
            const artifactName = faker.lorem.word();
            const artifactId = faker.number.int();
            const artifactArchive = faker.system.commonFileName('zip');
            const downloadFilePath = path.join(targetDir, artifactArchive);
            const content = faker.lorem.paragraph();

            const asset = new GitHubWorkflowAssetTest(owner, repo, workflow, artifactName);

            const octokitMock = await asset.getOctokit();
            vol.fromJSON({
                [artifactArchive]: content,
            }, targetDir);

            const result = await asset.downloadArtifact(artifactId, downloadFilePath);

            expect(result).toBe(downloadFilePath);
            expect(octokitMock.rest.actions.downloadArtifact).not.toHaveBeenCalled();
            expect(vol.toJSON()).toEqual(expect.objectContaining({
                [toPosix(downloadFilePath)]: content,
            }));
        });

    });

    describe('copyTo', async () => {

        it('issues download of workflow asset', async () => {
            const targetDir = faker.system.directoryPath();
            const owner = faker.lorem.word();
            const repo = faker.lorem.word();
            const workflow = faker.system.commonFileName('.yml');
            const artifactName = faker.system.commonFileName('');
            const artifactId = faker.number.int();
            const asset = new GitHubWorkflowAssetTest(owner, repo, workflow, artifactName);

            asset.downloadArtifact.mockImplementation(async (_, downloadFilePath) => downloadFilePath);
            asset.extractArchive.mockImplementation(async (_, dest) => dest ?? faker.system.directoryPath());

            const octokitMock = await asset.getOctokit();
            octokitMock.rest.actions.listWorkflowRuns.mockResolvedValue({
                headers: {},
                status: 200,
                url: '',
                data: {
                    workflow_runs: [{
                        id: 0,
                        node_id: '',
                        head_branch: null,
                        head_sha: '',
                        path: '',
                        run_number: 0,
                        event: '',
                        status: null,
                        conclusion: null,
                        workflow_id: 0,
                        url: '',
                        html_url: '',
                        pull_requests: null,
                        created_at: '',
                        updated_at: '',
                        jobs_url: '',
                        logs_url: '',
                        check_suite_url: '',
                        artifacts_url: '',
                        cancel_url: '',
                        rerun_url: '',
                        workflow_url: '',
                        head_commit: null,
                        repository: {
                            id: 0,
                            node_id: '',
                            name: '',
                            full_name: '',
                            owner: {
                                name: null,
                                email: null,
                                login: '',
                                id: 0,
                                node_id: '',
                                avatar_url: '',
                                gravatar_id: null,
                                url: '',
                                html_url: '',
                                followers_url: '',
                                following_url: '',
                                gists_url: '',
                                starred_url: '',
                                subscriptions_url: '',
                                organizations_url: '',
                                repos_url: '',
                                events_url: '',
                                received_events_url: '',
                                type: '',
                                site_admin: false,
                            },
                            private: false,
                            html_url: '',
                            description: null,
                            fork: false,
                            url: '',
                            archive_url: '',
                            assignees_url: '',
                            blobs_url: '',
                            branches_url: '',
                            collaborators_url: '',
                            comments_url: '',
                            commits_url: '',
                            compare_url: '',
                            contents_url: '',
                            contributors_url: '',
                            deployments_url: '',
                            downloads_url: '',
                            events_url: '',
                            forks_url: '',
                            git_commits_url: '',
                            git_refs_url: '',
                            git_tags_url: '',
                            issue_comment_url: '',
                            issue_events_url: '',
                            issues_url: '',
                            keys_url: '',
                            labels_url: '',
                            languages_url: '',
                            merges_url: '',
                            milestones_url: '',
                            notifications_url: '',
                            pulls_url: '',
                            releases_url: '',
                            stargazers_url: '',
                            statuses_url: '',
                            subscribers_url: '',
                            subscription_url: '',
                            tags_url: '',
                            teams_url: '',
                            trees_url: '',
                            hooks_url: ''
                        },
                        head_repository: {
                            id: 0,
                            node_id: '',
                            name: '',
                            full_name: '',
                            owner: {
                                name: null,
                                email: null,
                                login: '',
                                id: 0,
                                node_id: '',
                                avatar_url: '',
                                gravatar_id: null,
                                url: '',
                                html_url: '',
                                followers_url: '',
                                following_url: '',
                                gists_url: '',
                                starred_url: '',
                                subscriptions_url: '',
                                organizations_url: '',
                                repos_url: '',
                                events_url: '',
                                received_events_url: '',
                                type: '',
                                site_admin: false,
                            },
                            private: false,
                            html_url: '',
                            description: null,
                            fork: false,
                            url: '',
                            archive_url: '',
                            assignees_url: '',
                            blobs_url: '',
                            branches_url: '',
                            collaborators_url: '',
                            comments_url: '',
                            commits_url: '',
                            compare_url: '',
                            contents_url: '',
                            contributors_url: '',
                            deployments_url: '',
                            downloads_url: '',
                            events_url: '',
                            forks_url: '',
                            git_commits_url: '',
                            git_refs_url: '',
                            git_tags_url: '',
                            issue_comment_url: '',
                            issue_events_url: '',
                            issues_url: '',
                            keys_url: '',
                            labels_url: '',
                            languages_url: '',
                            merges_url: '',
                            milestones_url: '',
                            notifications_url: '',
                            pulls_url: '',
                            releases_url: '',
                            stargazers_url: '',
                            statuses_url: '',
                            subscribers_url: '',
                            subscription_url: '',
                            tags_url: '',
                            teams_url: '',
                            trees_url: '',
                            hooks_url: ''
                        },
                        display_title: ''
                    }],
                    total_count: 1
                },
            });
            octokitMock.rest.actions.listWorkflowRunArtifacts.mockResolvedValue({
                headers: {},
                status: 200,
                url: '',
                data: {
                    artifacts: [{
                        id: artifactId,
                        name: artifactName,
                        archive_download_url: '',
                        node_id: '',
                        size_in_bytes: 0,
                        url: '',
                        expired: false,
                        created_at: null,
                        expires_at: null,
                        updated_at: null
                    }],
                    total_count: 1
                },
            });

            const result = await asset.copyTo(targetDir);

            expect(result).toBe(targetDir);
            expect(asset.downloadArtifact).toHaveBeenCalledWith(artifactId, expect.any(String));
            expect(asset.extractArchive).toHaveBeenCalledWith(asset.downloadArtifact.mock.calls[0][1], targetDir);
        });

    });

});
