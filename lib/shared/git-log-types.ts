export interface GitLogCommit {
  fullHash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  isMerge: boolean;
}

export interface GitCommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface GitLogPageResponse {
  commits: GitLogCommit[];
  hasMore: boolean;
}

export interface GitCommitDetailResponse {
  commit: GitLogCommit;
  body: string;
  files: GitCommitFile[];
}