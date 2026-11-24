import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, Download, FileQuestion, Pencil, X } from 'lucide-react';
import ConfirmSheet from './ui/ConfirmSheet';
// The common-languages build, plus the few extras the extension map names:
// a third of the size of the full bundle. Token colours come from index.css.
import hljs from 'highlight.js/lib/common';
import scala from 'highlight.js/lib/languages/scala';
import powershell from 'highlight.js/lib/languages/powershell';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import cmake from 'highlight.js/lib/languages/cmake';
import { API } from '../lib/base';

hljs.registerLanguage('scala', scala);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('cmake', cmake);

interface FileViewerProps {
  filePath: string;
  /** Pre-known file size in bytes. When >500 KB we skip the text preview to
   *  avoid freezing the browser on huge text-but-not-meant-to-be-viewed files. */
  fileSize?: number | null;
  context?: string;
  onBack: () => void;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi']);

// Text-serialized formats that are technically readable but routinely huge
// and not intended for inline viewing (3D mesh, CAD, G-code, scientific
// dumps). Open these would freeze the highlighter on multi-MB files.
const NON_PREVIEWABLE_TEXT_EXTS = new Set([
  // 3D mesh / scene
  '.obj', '.stl', '.ply', '.dae', '.gltf', '.x3d', '.vrml', '.wrl',
  // CAD
  '.step', '.stp', '.iges', '.igs', '.ifc',
  // CAM / CNC
  '.gcode', '.nc', '.ngc',
  // Scientific
  '.pdb', '.mol2', '.cif', '.mmcif',
  // LDraw / brick-CAD
  '.ldr', '.ldraw', '.mpd',
  // SVG can be huge for diagrams — leave it previewable as it renders as image
]);

// Anything text-shaped above this size, we refuse to load inline.
const PREVIEW_MAX_TEXT_BYTES = 500 * 1024;

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return parseFloat((n / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}

function getLanguage(extension: string): string | undefined {
  const map: Record<string, string> = {
    '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.java': 'java',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp',
    '.php': 'php', '.swift': 'swift', '.kt': 'kotlin', '.scala': 'scala',
    '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
    '.ps1': 'powershell', '.sql': 'sql', '.html': 'html', '.htm': 'html',
    '.css': 'css', '.scss': 'scss', '.sass': 'scss', '.less': 'less',
    '.json': 'json', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
    '.toml': 'toml', '.ini': 'ini', '.md': 'markdown', '.markdown': 'markdown',
    '.dockerfile': 'dockerfile', '.makefile': 'makefile', '.cmake': 'cmake',
    '.graphql': 'graphql', '.gql': 'graphql', '.vue': 'xml', '.svelte': 'xml',
  };
  return map[extension.toLowerCase()];
}

export default function FileViewer({ filePath, fileSize, context, onBack }: FileViewerProps) {
  const ctxSuffix = context ? `&context=${encodeURIComponent(context)}` : '';
  const [textContent, setTextContent] = useState<{ content: string; extension: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [zoomed, setZoomed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [forcePreview, setForcePreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const ext = ('.' + filePath.split('.').pop()).toLowerCase();
  const isImage = IMAGE_EXTS.has(ext);
  const isVideo = VIDEO_EXTS.has(ext);
  const isTextFile = !isImage && !isVideo;
  const streamUrl = `${API}/api/files/stream?path=${encodeURIComponent(filePath)}${ctxSuffix}`;
  const downloadUrl = `${API}/api/files/stream?path=${encodeURIComponent(filePath)}&download=1${ctxSuffix}`;
  const fileName = filePath.split('/').pop() || '';

  // Decide whether to skip the inline preview entirely.
  const skipReason: 'format' | 'size' | null = (() => {
    if (isImage || isVideo) return null;
    if (forcePreview) return null;
    if (NON_PREVIEWABLE_TEXT_EXTS.has(ext)) return 'format';
    if (typeof fileSize === 'number' && fileSize > PREVIEW_MAX_TEXT_BYTES) return 'size';
    return null;
  })();

  useEffect(() => {
    if (isImage || isVideo) return;
    if (skipReason) return;
    setLoading(true);
    setError('');
    fetch(`${API}/api/files/content?path=${encodeURIComponent(filePath)}${ctxSuffix}`)
      .then(r => r.ok ? r.json() : r.json().then((d: { error: string }) => Promise.reject(d.error)))
      .then(data => setTextContent({ content: data.content, extension: data.extension }))
      .catch(e => setError(typeof e === 'string' ? e : 'Failed to load file'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, skipReason]);

  const enterEditMode = useCallback(() => {
    if (!textContent) return;
    setEditText(textContent.content);
    setEditing(true);
    setDirty(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [textContent]);

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardEdits = useCallback(() => {
    setConfirmDiscard(false);
    setEditing(false);
    setDirty(false);
  }, []);
  const exitEditMode = useCallback(() => {
    if (dirty) setConfirmDiscard(true);
    else discardEdits();
  }, [dirty, discardEdits]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/files/content${context ? `?context=${encodeURIComponent(context)}` : ''}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: editText, ...(context ? { context } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      // Update the viewed content and exit edit mode
      setTextContent(prev => prev ? { ...prev, content: editText } : prev);
      setEditing(false);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [filePath, editText]);

  const handleEditChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditText(e.target.value);
    setDirty(true);
  }, []);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    // Tab inserts spaces instead of changing focus
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newText = editText.substring(0, start) + '  ' + editText.substring(end);
      setEditText(newText);
      setDirty(true);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  }, [editText, handleSave]);

  const renderContent = () => {
    if (isImage) {
      return (
        <div className="flex items-center justify-center p-4 min-h-[200px] h-full">
          <img
            src={streamUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain cursor-zoom-in rounded-lg"
            onClick={() => setZoomed(true)}
          />
        </div>
      );
    }

    if (isVideo) {
      return (
        <div className="flex items-center justify-center p-4 h-full">
          <video
            src={streamUrl}
            controls
            playsInline
            className="max-w-full max-h-full rounded-lg"
          />
        </div>
      );
    }

    if (skipReason) {
      const headline = skipReason === 'format'
        ? `Preview skipped: ${ext} files are serialized data, not meant for inline viewing.`
        : `Preview skipped: this file is ${typeof fileSize === 'number' ? formatBytes(fileSize) : 'too large'} (the limit for text is ${formatBytes(PREVIEW_MAX_TEXT_BYTES)}).`;
      const subtext = skipReason === 'format'
        ? `Loading a multi-megabyte ${ext} file would freeze the page while it is being highlighted.`
        : `Open it in a desktop editor that is built for files this size.`;
      return (
        <div className="flex flex-col items-center justify-center text-center px-6 py-14 gap-4">
          <span className="status-tile !w-14 !h-14 !rounded-2xl"><FileQuestion size={26} strokeWidth={1.7} /></span>
          <div className="space-y-1.5 max-w-md">
            <p className="m-0 text-[14.5px]">{headline}</p>
            <p className="m-0 text-ink-2 text-[13px]">{subtext}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <a href={downloadUrl} download={fileName} className="btn btn-primary no-underline">
              <Download size={17} />
              Download {typeof fileSize === 'number' ? `(${formatBytes(fileSize)})` : ''}
            </a>
            <button onClick={() => setForcePreview(true)} className="btn btn-ghost">
              Try anyway
            </button>
          </div>
        </div>
      );
    }
    if (loading) {
      return (
        <div className="px-4 py-4 flex flex-col gap-2.5">
          {[72, 48, 88, 60, 34, 80].map((w, i) => <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />)}
        </div>
      );
    }
    if (error) return <div className="text-danger text-center text-[14px] py-10 px-6">{error}</div>;
    if (!textContent) return <div className="text-ink-3 text-center text-[14px] py-10">No content</div>;

    if (editing) {
      return (
        <textarea
          ref={textareaRef}
          value={editText}
          onChange={handleEditChange}
          onKeyDown={handleEditKeyDown}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="block w-full h-full bg-bg text-ink font-mono p-3 resize-none outline-none leading-relaxed"
          style={{ tabSize: 2, fontSize: 16, paddingLeft: 'calc(12px + var(--safe-l))', paddingRight: 'calc(12px + var(--safe-r))' }}
        />
      );
    }

    const language = getLanguage(textContent.extension);
    let highlighted: string;
    try {
      highlighted = language
        ? hljs.highlight(textContent.content, { language }).value
        : hljs.highlightAuto(textContent.content).value;
    } catch {
      highlighted = textContent.content
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const lines = highlighted.split('\n');
    return (
      <div className="overflow-x-auto min-h-full bg-surface">
        <table className="code-view w-full border-collapse my-2">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td className="ln">{i + 1}</td>
                <td className="lc" dangerouslySetInnerHTML={{ __html: line || ' ' }} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-bg anim-fade">
      {/* Header */}
      <div className="flex items-center gap-1 flex-shrink-0 min-h-[48px] bg-surface border-b border-line" style={{ paddingLeft: 'calc(4px + var(--safe-l))', paddingRight: 'calc(6px + var(--safe-r))' }}>
        <button onClick={editing ? exitEditMode : onBack} className="icon-btn" aria-label={editing ? 'Stop editing' : 'Back to files'}>
          {editing ? <X size={20} /> : <ChevronLeft size={22} />}
        </button>
        <span className="font-mono text-[14px] font-medium truncate flex-1 min-w-0" title={filePath}>
          {fileName}
          {editing && dirty && <span className="text-accent ml-1.5 font-sans text-[12px]">edited</span>}
        </span>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Edit / Save — only for text files */}
          {isTextFile && textContent && !loading && (
            editing ? (
              <button onClick={handleSave} disabled={saving || !dirty} className="btn btn-sm btn-primary">
                {saving ? 'Saving…' : 'Save'}
              </button>
            ) : (
              <button onClick={enterEditMode} className="icon-btn" title="Edit file" aria-label="Edit file">
                <Pencil size={18} />
              </button>
            )
          )}

          {/* Download — for every file type, hidden while editing */}
          {!editing && (
            <a href={downloadUrl} download={fileName} className="icon-btn" title="Download file" aria-label="Download file">
              <Download size={19} />
            </a>
          )}
        </div>
      </div>

      {error && editing && <div className="flex-shrink-0 px-4 py-2 text-[13px] text-danger bg-danger-soft">{error}</div>}

      {/* Content */}
      <div className={`flex-1 min-h-0 ${editing ? '' : 'scroll-y'}`}>
        {renderContent()}
      </div>

      <ConfirmSheet
        open={confirmDiscard}
        title="Discard your changes?"
        confirmLabel="Discard changes"
        danger
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={discardEdits}
      >
        The edits to {fileName} have not been saved.
      </ConfirmSheet>

      {/* Zoom lightbox */}
      {zoomed && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center anim-fade"
          onClick={() => setZoomed(false)}
        >
          <img
            src={streamUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain cursor-zoom-out"
          />
        </div>
      )}
    </div>
  );
}
