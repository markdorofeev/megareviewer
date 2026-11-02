import type { RepoRef } from "../../domain/review/index.ts";
import type { FileAt, FileCache } from "../ports/index.ts";

const cacheKey = (repo: RepoRef, { sha, path }: FileAt): string =>
  `${repo.host}/${repo.owner}/${repo.repo}@${sha}:${path}`;

export class InMemoryFileCache implements FileCache {
  private readonly files = new Map<string, string | null>();

  async get(repo: RepoRef, file: FileAt): Promise<{ readonly content: string | null } | null> {
    const key = cacheKey(repo, file);
    return this.files.has(key) ? { content: this.files.get(key) ?? null } : null;
  }

  async put(repo: RepoRef, file: FileAt, content: string | null): Promise<void> {
    this.files.set(cacheKey(repo, file), content);
  }
}
