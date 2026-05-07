export interface DiffStats {
  wordsAdded: number;
  wordsRemoved: number;
  charsAdded: number;
  charsRemoved: number;
  netWords: number;
}

export interface RevisionDiff {
  added: string[];
  removed: string[];
  stats: DiffStats;
}

export interface RevisionEntry {
  revisionIndex: number;
  revisionId: string;
  modifiedTime: string;
  modifiedTimeSGT: string;
  modifiedBy: { name: string; email: string | null };
  isFirstRevision: boolean;
  hasChanges: boolean;
  diff?: RevisionDiff;
  error?: string;
}

export interface UserSummary {
  name: string;
  email: string | null;
  revisionsCount: number;
  totalWordsAdded: number;
  totalWordsRemoved: number;
  totalCharsAdded: number;
  totalCharsRemoved: number;
  firstEditSGT: string | null;
  lastEditSGT: string | null;
}

export interface AnalysisResult {
  fileId: string;
  generatedAt: string;
  timezone: string;
  totalRevisions: number;
  exportErrors: number;
  userSummary: UserSummary[];
  revisions: RevisionEntry[];
}
