import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowUpRight, ChevronRight, CornerLeftUp, Download, File, FileCode2, FileImage, FilePlus2, FileText, Film,
  Folder, FolderPlus, House, LoaderCircle, Upload, X,
} from 'lucide-react';
import { shortAgo } from '../lib/sessions';

// The viewer pulls in the syntax highlighter; load it when a file is opened.
const FileViewer = lazy(() => import('./FileViewer'));
import { API } from '../lib/base';

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number | null;
  modified: string;
  symlink?: boolean;
  target?: string;
  broken?: boolean;
}

interface DirectoryListing {
  path: string;
  parent: string | null;
  files: FileEntry[];
}

interface FileBrowserProps {
  /** Current working directory of the Claude Code session — when it changes, auto-navigate. */
  sessionCwd?: string;
  /** Context name (work / john / untrusted / tom / admin). Omitted = admin. */
  context?: string;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

type CreateMode = null | 'file' | 'folder';

const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'php', 'swift', 'kt', 'sh', 'bash', 'zsh', 'html', 'css', 'scss', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'lua', 'vue', 'svelte']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'bmp']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi']);
const TEXT_EXTS = new Set(['md', 'txt', 'log', 'rst', 'csv', 'env', 'ini', 'conf']);

function FileIcon({ name }: { name: string }) {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const props = { size: 20, strokeWidth: 1.75 } as const;
  if (IMAGE_EXTS.has(ext)) return <FileImage {...props} />;
  if (VIDEO_EXTS.has(ext)) return <Film {...props} />;
  if (CODE_EXTS.has(ext)) return <FileCode2 {...props} />;
  if (TEXT_EXTS.has(ext)) return <FileText {...props} />;
  return <File {...props} />;
}

// "/home/me/Work/app" → [~, Work, app], each with the path it navigates to.
function breadcrumbs(path: string): Array<{ label: string; path: string; home?: boolean }> {
  const home = path.match(/^\/(?:home|Users)\/[^/]+/)?.[0];
  const rest = (home ? path.slice(home.length) : path).split('/').filter(Boolean);
  const out: Array<{ label: string; path: string; home?: boolean }> = home
    ? [{ label: '~', path: home, home: true }]
    : [{ label: '/', path: '/' }];
  let acc = home ?? '';
  for (const part of rest) {
    acc = `${acc}/${part}`;
    out.push({ label: part, path: acc });
  }
  return out;
}

export default function FileBrowser({ sessionCwd, context }: FileBrowserProps = {}) {
  const STORAGE_KEY = `fileBrowser_lastDir_${context || 'admin'}`;
  const withCtx = (url: string): string =>
    context ? `${url}${url.includes('?') ? '&' : '?'}context=${encodeURIComponent(context)}` : url;
  const ctxBody = (extra: Record<string, unknown>): Record<string, unknown> =>
    context ? { ...extra, context } : extra;
  const [currentPath, setCurrentPath] = useState('');
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  // Track the last sessionCwd we auto-navigated to so we only re-navigate when it changes,
  // and users can still browse away freely.
  const lastSyncedCwdRef = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewingFile, setViewingFile] = useState<{ path: string; size: number | null } | null>(null);
  type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled';
  interface UploadEntry {
    name: string;
    total: number;
    loaded: number;
    status: UploadStatus;
    error?: string;
  }
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const uploading = uploads.some((u) => u.status === 'queued' || u.status === 'uploading');
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);
  const uploadCanceledRef = useRef(false);
  const [downloading, setDownloading] = useState(false);
  const [dirSizes, setDirSizes] = useState<Record<string, number>>({});
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Fetch directory sizes asynchronously after listing loads
  useEffect(() => {
    if (!currentPath || !listing) return;
    const hasDirs = listing.files.some(f => f.type === 'directory');
    if (!hasDirs) return;

    let cancelled = false;
    setDirSizes({});
    fetch(withCtx(`${API}/api/files/dir-sizes?path=${encodeURIComponent(currentPath)}`))
      .then(r => r.json())
      .then(data => { if (!cancelled) setDirSizes(data.sizes || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentPath, listing]);

  const fetchDirectory = async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(withCtx(`${API}/api/files?path=${encodeURIComponent(path)}`));
      if (res.ok) {
        const data = await res.json();
        setListing(data);
        setCurrentPath(path);
        try { localStorage.setItem(STORAGE_KEY, path); } catch {}
      } else {
        const { error } = await res.json();
        setError(error || 'Failed to load directory');
      }
    } catch (e) {
      setError('Failed to load directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Prefer the session's cwd on first mount if we have it.
    if (sessionCwd) {
      lastSyncedCwdRef.current = sessionCwd;
      fetchDirectory(sessionCwd).then(() => {});
      return;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      fetchDirectory(saved).then(() => {});
    } else {
      fetch(withCtx(`${API}/api/config`))
        .then(r => r.json())
        .then(cfg => fetchDirectory(cfg.rootPath || '/'))
        .catch(() => fetchDirectory('/'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  // Follow the agent: when session cwd changes server-side, jump to it.
  useEffect(() => {
    if (!sessionCwd) return;
    if (lastSyncedCwdRef.current === sessionCwd) return;
    lastSyncedCwdRef.current = sessionCwd;
    fetchDirectory(sessionCwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCwd]);

  // If the saved path fails, fall back to root
  useEffect(() => {
    if (error && currentPath === '' && listing === null) {
      fetch(withCtx(`${API}/api/config`))
        .then(r => r.json())
        .then(cfg => fetchDirectory(cfg.rootPath || '/'))
        .catch(() => fetchDirectory('/'));
    }
  }, [error]);

  const handleNavigate = (entry: FileEntry) => {
    if (entry.broken) return;
    if (entry.type === 'directory') {
      fetchDirectory(`${currentPath}/${entry.name}`);
    } else {
      setViewingFile({ path: `${currentPath}/${entry.name}`, size: entry.size });
    }
  };

  const handleNavigateUp = () => {
    if (listing?.parent) {
      fetchDirectory(listing.parent);
    }
  };

  const uploadOne = useCallback((file: File, index: number, targetPath: string): Promise<void> => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      uploadXhrRef.current = xhr;

      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return;
        setUploads((prev) =>
          prev.map((p, idx) =>
            idx === index ? { ...p, status: 'uploading', loaded: ev.loaded } : p,
          ),
        );
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploads((prev) =>
            prev.map((p, idx) =>
              idx === index ? { ...p, status: 'done', loaded: p.total } : p,
            ),
          );
        } else {
          let msg = `HTTP ${xhr.status}`;
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed?.uploaded?.[0]?.error) msg = parsed.uploaded[0].error;
            else if (parsed?.error) msg = parsed.error;
          } catch {}
          setUploads((prev) =>
            prev.map((p, idx) => (idx === index ? { ...p, status: 'error', error: msg } : p)),
          );
        }
        resolve();
      };

      xhr.onerror = () => {
        setUploads((prev) =>
          prev.map((p, idx) =>
            idx === index ? { ...p, status: 'error', error: 'Network error' } : p,
          ),
        );
        resolve();
      };

      xhr.onabort = () => {
        setUploads((prev) =>
          prev.map((p, idx) => (idx === index ? { ...p, status: 'canceled' } : p)),
        );
        resolve();
      };

      const fd = new FormData();
      fd.append('path', targetPath);
      fd.append('files', file);

      xhr.open('POST', withCtx(`${API}/api/files/upload`));
      xhr.send(fd);
    });
  }, [withCtx]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const initial: UploadEntry[] = Array.from(files).map((f) => ({
      name: f.name,
      total: f.size,
      loaded: 0,
      status: 'queued' as UploadStatus,
    }));
    setUploads(initial);
    uploadCanceledRef.current = false;
    setError('');

    const targetPath = currentPath;
    for (let i = 0; i < files.length; i++) {
      if (uploadCanceledRef.current) {
        setUploads((prev) =>
          prev.map((p, idx) =>
            idx >= i && (p.status === 'queued' || p.status === 'uploading')
              ? { ...p, status: 'canceled' }
              : p,
          ),
        );
        break;
      }
      await uploadOne(files[i], i, targetPath);
    }

    uploadXhrRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
    await fetchDirectory(targetPath);
  };

  const handleCancelUploads = useCallback(() => {
    uploadCanceledRef.current = true;
    if (uploadXhrRef.current) {
      try { uploadXhrRef.current.abort(); } catch {}
    }
  }, []);

  const handleDismissUploadPanel = useCallback(() => {
    if (uploading) return; // refuse while in flight
    setUploads([]);
  }, [uploading]);

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      const res = await fetch(withCtx(`${API}/api/files/download-zip?path=${encodeURIComponent(currentPath)}`));
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const dirName = currentPath.split('/').pop() || 'download';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dirName}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Download failed');
    } finally {
      setDownloading(false);
    }
  };

  // --- Create file/folder ---
  const openCreate = useCallback((mode: 'file' | 'folder') => {
    setCreateMode(mode);
    setCreateName('');
    setError('');
  }, []);

  const cancelCreate = useCallback(() => {
    setCreateMode(null);
    setCreateName('');
  }, []);

  const submitCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name) return;

    setCreating(true);
    setError('');
    try {
      const fullPath = `${currentPath}/${name}`;
      const endpoint = createMode === 'folder' ? `${API}/api/files/mkdir` : `${API}/api/files/create`;
      const res = await fetch(withCtx(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctxBody({ path: fullPath })),
      });
      if (res.ok) {
        setCreateMode(null);
        setCreateName('');
        await fetchDirectory(currentPath);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create');
      }
    } catch {
      setError('Failed to create');
    } finally {
      setCreating(false);
    }
  }, [createName, createMode, currentPath]);

  const handleCreateKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCreate();
    } else if (e.key === 'Escape') {
      cancelCreate();
    }
  }, [submitCreate, cancelCreate]);

  // --- Drag and drop to move files ---
  const handleDragStart = useCallback((e: React.DragEvent, entry: FileEntry) => {
    const src = `${currentPath}/${entry.name}`;
    setDragSource(src);
    e.dataTransfer.setData('text/plain', src);
    e.dataTransfer.effectAllowed = 'move';
  }, [currentPath]);

  const handleDragOver = useCallback((e: React.DragEvent, entry: FileEntry) => {
    if (entry.type !== 'directory') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(entry.name);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetEntry: FileEntry) => {
    e.preventDefault();
    setDropTarget(null);
    const src = e.dataTransfer.getData('text/plain');
    if (!src || targetEntry.type !== 'directory') return;

    const srcName = src.split('/').pop() || '';
    const dest = `${currentPath}/${targetEntry.name}/${srcName}`;

    if (src === dest) return;

    setError('');
    try {
      const res = await fetch(withCtx(`${API}/api/files/move`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctxBody({ src, dest })),
      });
      if (res.ok) {
        await fetchDirectory(currentPath);
      } else {
        const data = await res.json();
        setError(data.error || 'Move failed');
      }
    } catch {
      setError('Move failed');
    } finally {
      setDragSource(null);
    }
  }, [currentPath]);

  const handleDragEnd = useCallback(() => {
    setDragSource(null);
    setDropTarget(null);
  }, []);

  // Also allow dropping on the parent directory button
  const handleDropOnParent = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    const src = e.dataTransfer.getData('text/plain');
    if (!src || !listing?.parent) return;

    const srcName = src.split('/').pop() || '';
    const dest = `${listing.parent}/${srcName}`;

    if (src === dest) return;

    try {
      const res = await fetch(withCtx(`${API}/api/files/move`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctxBody({ src, dest })),
      });
      if (res.ok) {
        await fetchDirectory(currentPath);
      } else {
        const data = await res.json();
        setError(data.error || 'Move failed');
      }
    } catch {
      setError('Move failed');
    } finally {
      setDragSource(null);
    }
  }, [currentPath, listing]);

  // Keep the end of the breadcrumb (where you are) in view.
  const crumbsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [currentPath]);

  if (viewingFile) {
    return (
      <Suspense fallback={<div className="h-full bg-bg" />}>
        <FileViewer
          filePath={viewingFile.path}
          fileSize={viewingFile.size}
          context={context}
          onBack={() => setViewingFile(null)}
        />
      </Suspense>
    );
  }

  const crumbs = currentPath ? breadcrumbs(currentPath) : [];
  const doneUploads = uploads.filter((u) => u.status === 'done').length;
  const failedUploads = uploads.filter((u) => u.status === 'error').length;
  const canceledUploads = uploads.filter((u) => u.status === 'canceled').length;
  const activeUploads = uploads.length - doneUploads - failedUploads - canceledUploads;

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Location: up + breadcrumb */}
      <div className="flex items-center gap-1 flex-shrink-0 bg-surface border-b border-line" style={{ paddingLeft: 'calc(4px + var(--safe-l))', paddingRight: 'calc(8px + var(--safe-r))' }}>
        <button
          onClick={handleNavigateUp}
          disabled={!listing?.parent}
          onDragOver={(e) => { if (!listing?.parent) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget('..'); }}
          onDragLeave={handleDragLeave}
          onDrop={handleDropOnParent}
          className={`icon-btn ${dropTarget === '..' ? 'is-on' : ''}`}
          aria-label="Up one folder"
          title="Up one folder"
        >
          <CornerLeftUp size={19} />
        </button>
        <div ref={crumbsRef} className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto no-scrollbar py-1.5" aria-label="Current folder">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={c.path} className="flex items-center gap-0.5 flex-shrink-0">
                {i > 0 && <ChevronRight size={13} className="text-ink-3" />}
                <button
                  onClick={() => { if (!last) fetchDirectory(c.path); }}
                  aria-current={last ? 'location' : undefined}
                  className={`h-8 px-1.5 rounded-md font-mono text-[13px] inline-flex items-center ${last ? 'text-ink font-semibold' : 'text-ink-2 active:bg-press'}`}
                >
                  {c.home ? <House size={15} aria-label="Home" /> : c.label}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* Create inline input */}
      {createMode && (
        <div className="flex items-center gap-2 px-3 py-2 bg-surface border-b border-line flex-shrink-0 anim-fade">
          <span className={createMode === 'folder' ? 'text-accent' : 'text-ink-2'}>
            {createMode === 'folder' ? <Folder size={20} /> : <File size={20} />}
          </span>
          <input
            ref={createInputRef}
            // Mounted by the tap that opened it, so the keyboard comes up too.
            autoFocus
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            onKeyDown={handleCreateKeyDown}
            placeholder={createMode === 'folder' ? 'Folder name' : 'filename.ext'}
            className="field flex-1 min-w-0 !min-h-[40px] !py-2 font-mono"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
          />
          <button onClick={submitCreate} disabled={creating || !createName.trim()} className="btn btn-sm btn-primary !min-h-[40px]">
            {creating ? '…' : 'Create'}
          </button>
          <button onClick={cancelCreate} className="icon-btn icon-btn-sm" aria-label="Cancel">
            <X size={18} />
          </button>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 scroll-y min-h-0">
        {loading && !listing ? (
          <div className="px-4 py-3 flex flex-col gap-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="flex items-center gap-3"><div className="skeleton w-5 h-5" /><div className="skeleton h-3.5 flex-1 max-w-48" /></div>)}
          </div>
        ) : error ? (
          <div className="text-danger text-center text-[14px] py-10 px-6">{error}</div>
        ) : listing?.files.length === 0 ? (
          <div className="text-ink-3 text-center text-[14px] py-12">This folder is empty</div>
        ) : (
          <ul className={`m-0 p-0 list-none divide-y divide-line transition-opacity ${loading ? 'opacity-60' : ''}`} style={{ paddingLeft: 'var(--safe-l)', paddingRight: 'var(--safe-r)' }}>
            {listing?.files.map((entry) => {
              const isDir = entry.type === 'directory';
              const isDropping = dropTarget === entry.name && isDir;
              const isDragging = dragSource === `${currentPath}/${entry.name}`;
              const size = entry.type === 'file' && entry.size !== null
                ? formatSize(entry.size)
                : isDir && dirSizes[entry.name] !== undefined ? formatSize(dirSizes[entry.name]) : '';
              return (
                <li key={entry.name}>
                  <div
                    className={`row-press w-full pl-4 pr-3 min-h-[52px] flex items-center gap-3 text-left ${
                      isDropping ? 'bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent-line)]' : ''
                    } ${isDragging ? 'opacity-40' : ''}`}
                    onDragOver={(e) => handleDragOver(e, entry)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, entry)}
                  >
                    {/* Draggable icon (drag onto a folder to move) */}
                    <div
                      draggable
                      onDragStart={(e) => handleDragStart(e, entry)}
                      onDragEnd={handleDragEnd}
                      className={`relative cursor-grab active:cursor-grabbing flex-shrink-0 ${isDir ? 'text-accent' : 'text-ink-3'}`}
                      title={entry.symlink ? `→ ${entry.target ?? '?'}${entry.broken ? ' (broken)' : ''}` : undefined}
                    >
                      {isDir ? <Folder size={20} strokeWidth={1.75} fill="currentColor" fillOpacity={0.18} /> : <FileIcon name={entry.name} />}
                      {entry.symlink && (
                        <ArrowUpRight
                          size={12}
                          strokeWidth={3}
                          className={`absolute -bottom-1 -right-1.5 rounded-sm bg-bg ${entry.broken ? 'text-danger' : 'text-warn'}`}
                        />
                      )}
                    </div>
                    {/* Clickable name + details */}
                    <button onClick={() => handleNavigate(entry)} className="flex-1 flex items-center gap-3 min-w-0 text-left self-stretch py-2">
                      <span className="flex-1 min-w-0">
                        <span className={`block truncate text-[15px] ${entry.broken ? 'text-ink-3 line-through' : 'text-ink'}`}>
                          {entry.name}
                        </span>
                        {entry.symlink && (
                          <span className="block truncate font-mono text-[11.5px] text-ink-3">→ {entry.target}</span>
                        )}
                      </span>
                      <span className="text-right flex-shrink-0 text-[12px] text-ink-3 tabular leading-tight">
                        <span className="block">{size || (isDir && !entry.symlink ? '···' : '')}</span>
                        <span className="block">{shortAgo(entry.modified)}</span>
                      </span>
                      {isDir && <ChevronRight size={16} className="text-ink-3 flex-shrink-0 -ml-1" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Actions, in thumb reach */}
      <input ref={fileInputRef} type="file" multiple onChange={handleUpload} className="hidden" />
      <div
        className="flex-shrink-0 grid grid-cols-4 gap-1 bg-surface border-t border-line px-1.5 pt-1"
        style={{ paddingBottom: 'calc(4px + var(--safe-b))' }}
      >
        {([
          { label: 'New folder', icon: <FolderPlus size={19} />, onClick: () => openCreate('folder'), busy: false },
          { label: 'New file', icon: <FilePlus2 size={19} />, onClick: () => openCreate('file'), busy: false },
          { label: 'Upload', icon: <Upload size={19} />, onClick: () => fileInputRef.current?.click(), busy: uploading },
          { label: 'Zip', icon: <Download size={19} />, onClick: handleDownloadZip, busy: downloading },
        ]).map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            disabled={a.busy}
            title={a.label === 'Zip' ? 'Download this folder as a zip' : a.label}
            className="flex flex-col items-center justify-center gap-0.5 min-h-[46px] rounded-lg text-ink-2 active:bg-press disabled:opacity-50"
          >
            {a.busy ? <LoaderCircle size={19} className="anim-spin" /> : a.icon}
            <span className="text-[10.5px] font-medium leading-none">{a.label}</span>
          </button>
        ))}
      </div>

      {/* Upload progress — shown while uploads are in flight or until
          dismissed after completion */}
      {uploads.length > 0 && (
        <div
          className="absolute left-3 right-3 sm:left-auto sm:w-96 z-40 bg-surface border border-line-strong rounded-2xl flex flex-col max-h-[60%] anim-rise"
          style={{ bottom: 'calc(64px + var(--safe-b))', boxShadow: 'var(--shadow-pop)' }}
        >
          <div className="flex items-center justify-between pl-4 pr-2 py-1.5 border-b border-line">
            <div className="text-[14px] font-semibold">
              {activeUploads > 0
                ? `Uploading ${doneUploads + 1} of ${uploads.length}`
                : failedUploads > 0 || canceledUploads > 0
                  ? `Done: ${doneUploads} ok, ${failedUploads} failed${canceledUploads ? `, ${canceledUploads} canceled` : ''}`
                  : `Uploaded ${doneUploads} file${doneUploads === 1 ? '' : 's'}`}
            </div>
            {uploading ? (
              <button onClick={handleCancelUploads} className="btn btn-sm btn-ghost !text-danger">Cancel</button>
            ) : (
              <button onClick={handleDismissUploadPanel} className="icon-btn icon-btn-sm" aria-label="Dismiss">
                <X size={17} />
              </button>
            )}
          </div>
          <div className="scroll-y px-4 py-3 space-y-3">
            {uploads.map((u, i) => {
              const pct = u.total > 0 ? Math.min(100, Math.round((u.loaded / u.total) * 100)) : 0;
              const barColor =
                u.status === 'error'    ? 'var(--danger)' :
                u.status === 'canceled' ? 'var(--ink-3)' :
                u.status === 'done'     ? 'var(--ok)' :
                u.status === 'uploading'? 'var(--accent)' :
                                          'var(--line-strong)';
              const rightText =
                u.status === 'error'    ? (u.error || 'Failed') :
                u.status === 'canceled' ? 'Canceled' :
                u.status === 'done'     ? formatSize(u.total) :
                                          `${formatSize(u.loaded)} / ${formatSize(u.total)}  ·  ${pct}%`;
              return (
                <div key={`${u.name}-${i}`} className="text-[12.5px]">
                  <div className="flex justify-between gap-3 mb-1.5">
                    <span className="truncate flex-1 min-w-0" title={u.name}>{u.name}</span>
                    <span className={`flex-shrink-0 font-mono tabular ${u.status === 'error' ? 'text-danger' : 'text-ink-2'}`}>
                      {rightText}
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-150"
                      style={{ width: `${u.status === 'done' ? 100 : pct}%`, backgroundColor: barColor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
