export interface SavedWorkspaceFile {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

const FILES_STORAGE_KEY = 'easyjs_saved_files_v1';
const ACTIVE_FILE_STORAGE_KEY = 'easyjs_active_file_v1';

export function sanitizeFileName(raw: string): string {
  const cleaned = raw.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  if (!cleaned) return 'untitled.ejs';
  if (cleaned.includes('.')) return cleaned;
  return `${cleaned}.ejs`;
}

export function loadSavedFiles(): SavedWorkspaceFile[] {
  try {
    const raw = window.localStorage.getItem(FILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedWorkspaceFile =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.content === 'string'
    );
  } catch {
    return [];
  }
}

export function persistSavedFiles(files: SavedWorkspaceFile[]): boolean {
  try {
    window.localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(files));
    return true;
  } catch {
    return false;
  }
}

export function loadActiveFileId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_FILE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistActiveFileId(id: string | null): void {
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_FILE_STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_FILE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction errors
  }
}

export function createSavedFileRecord(name: string, content: string): SavedWorkspaceFile {
  const now = Date.now();
  return {
    id: `file_${now}_${Math.random().toString(36).slice(2, 7)}`,
    name: sanitizeFileName(name),
    content,
    createdAt: now,
    updatedAt: now,
  };
}
