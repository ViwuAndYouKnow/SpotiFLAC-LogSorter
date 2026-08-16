const fs = typeof require === 'function' ? require('fs') : null;
const path = typeof require === 'function' ? require('path') : null;

function sanitizeName(input) {
  return String(input || 'untitled')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

function isSpotifyUrl(value) {
  return /^https?:\/\/open\.spotify\.com\//i.test(value || '');
}

function parseLogText(content) {
  const lines = content.split(/\r?\n/);
  const links = [];
  const errorOnly = [];
  let title = 'unknown-entry';
  let lastKnownTitle = 'unknown-entry';
  let currentError = '';
  let currentUrl = '';

  function flushCurrentEntry() {
    const trimmedError = currentError.trim();
    const trimmedUrl = currentUrl.trim();
    const entryTitle = title || lastKnownTitle || 'unknown-entry';

    if (trimmedUrl && isSpotifyUrl(trimmedUrl)) {
      links.push(trimmedUrl);
    } else if (trimmedError && !trimmedUrl) {
      errorOnly.push({
        title: entryTitle,
        error: trimmedError,
      });
    }

    title = lastKnownTitle;
    currentError = '';
    currentUrl = '';
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) continue;

    if (/^\d+\.\s+/.test(line)) {
      flushCurrentEntry();
      title = line.replace(/^\d+\.\s+/, '').trim() || 'unknown-entry';
      lastKnownTitle = title;
      continue;
    }

    if (line.startsWith('[SUCCESS]')) {
      flushCurrentEntry();
      continue;
    }

    if (line.startsWith('Error:')) {
      if (currentError) {
        currentError += ' ' + line.replace(/^Error:\s*/, '').trim();
      } else {
        currentError = line.replace(/^Error:\s*/, '').trim();
      }
      continue;
    }

    if (line.startsWith('URL:')) {
      currentUrl = line.replace(/^URL:\s*/, '').trim();
      flushCurrentEntry();
      continue;
    }

    if (line.startsWith('ID:')) {
      continue;
    }

    if (currentError) {
      currentError += ' ' + line;
    }
  }

  if (currentError.trim() || currentUrl.trim()) {
    flushCurrentEntry();
  }

  const uniqueLinks = [...new Set(links)].sort();
  const uniqueErrors = [...new Map(errorOnly.map((item) => [item.title + '::' + item.error, item])).values()];

  return {
    links: uniqueLinks,
    errorOnly: uniqueErrors,
  };
}

function writeOutputFolder(baseDir, results) {
  const outDir = path.join(baseDir, 'parsed_output');
  fs.mkdirSync(outDir, { recursive: true });

  const linksFile = path.join(outDir, 'SpotiFLAC_failed_entries.txt');
  fs.writeFileSync(linksFile, results.links.join('\n') + (results.links.length ? '\n' : ''), 'utf8');

  const missingLinksFile = path.join(outDir, 'Missing_Spotify_linkentries.txt');
  const missingIntro = 'These entries are missing Spotify links, so only the names are listed here to help you add them manually.\n\n';
  const missingBody = results.errorOnly.length
    ? results.errorOnly.map((item) => `- ${item.title}${item.error ? `\n  Details: ${item.error}` : ''}`).join('\n\n') + '\n'
    : 'No missing Spotify links were found.\n';
  fs.writeFileSync(missingLinksFile, missingIntro + missingBody, 'utf8');

  const errorDir = path.join(outDir, 'error_only');
  fs.mkdirSync(errorDir, { recursive: true });

  for (const item of results.errorOnly) {
    const name = sanitizeName(item.title || 'unknown-entry');
    const filePath = path.join(errorDir, `${name}.txt`);
    fs.writeFileSync(filePath, `${item.error}\n`, 'utf8');
  }

  const summaryFile = path.join(outDir, 'summary.txt');
  fs.writeFileSync(
    summaryFile,
    `Spotify failed links: ${results.links.length}\nError-only entries: ${results.errorOnly.length}\n`,
    'utf8'
  );

  return {
    outDir,
    linksFile,
    missingLinksFile,
    errorDir,
    summaryFile,
  };
}

function collectFolder(folderPath) {
  const files = fs.readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map((entry) => path.join(folderPath, entry.name));

  const combined = { links: [], errorOnly: [] };

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseLogText(content);
    combined.links.push(...parsed.links);
    combined.errorOnly.push(...parsed.errorOnly);
  }

  const uniqueLinks = [...new Set(combined.links)].sort();
  const uniqueErrors = [...new Map(combined.errorOnly.map((item) => [item.title + '::' + item.error, item])).values()];

  return {
    links: uniqueLinks,
    errorOnly: uniqueErrors,
  };
}

if (typeof window !== 'undefined') {
  const state = {
    links: [],
    errorOnly: [],
    fileKeys: new Set(),
  };

  function resetState() {
    state.links = [];
    state.errorOnly = [];
    state.fileKeys.clear();
    renderSummary();
    buildOutputPreview();
    document.getElementById('downloadLinksBtn').disabled = true;
    if (fileInput) fileInput.value = '';
  }

  function setStatus(message) {
    const summaryEl = document.getElementById('summary');
    if (summaryEl) summaryEl.textContent = message;
  }

  function renderSummary() {
    const summaryEl = document.getElementById('summary');
    summaryEl.textContent = `Spotify failed links: ${state.links.length} | Error-only entries: ${state.errorOnly.length}`;
  }

  function buildOutputPreview() {
    const lines = [];
    if (state.links.length) {
      lines.push('Spotify failed links:');
      lines.push(...state.links);
      lines.push('');
    }

    if (state.errorOnly.length) {
      lines.push('Error-only entries:');
      for (const item of state.errorOnly) {
        lines.push(`- ${item.title}`);
      }
    }

    const outputBox = document.getElementById('outputBox');
    outputBox.value = lines.join('\n');
  }

  function buildErrorLogText() {
    const intro = 'These entries are missing Spotify links, so only the names are listed here to help you add them manually.\n\n';

    if (!state.errorOnly.length) {
      return intro + 'No missing Spotify links were found.\n';
    }

    const lines = state.errorOnly.map((item) => `- ${item.title}${item.error ? `\n  Details: ${item.error}` : ''}`);
    return intro + lines.join('\n\n') + '\n';
  }

  function downloadBlob(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function processSelectedFiles(fileList) {
    const newFiles = [];
    for (const file of [...fileList || []]) {
      if (!file.name.toLowerCase().endsWith('.txt')) continue;

      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (state.fileKeys.has(key)) continue;

      state.fileKeys.add(key);
      newFiles.push(file);
    }

    if (!newFiles.length) {
      setStatus('No new .txt log files were added.');
      return;
    }

    const textFileMaps = [];
    for (const file of newFiles) {
      const text = await file.text();
      textFileMaps.push({ name: file.name, text });
    }

    const combined = { links: [...state.links], errorOnly: [...state.errorOnly] };
    for (const entry of textFileMaps) {
      const parsed = parseLogText(entry.text);
      combined.links.push(...parsed.links);
      combined.errorOnly.push(...parsed.errorOnly);
    }

    state.links = [...new Set(combined.links)].sort();
    state.errorOnly = [...new Map(combined.errorOnly.map((item) => [item.title + '::' + item.error, item])).values()];

    renderSummary();
    buildOutputPreview();
    document.getElementById('downloadLinksBtn').disabled = state.links.length === 0 && state.errorOnly.length === 0;
  }

  async function handleFolderSelect(event) {
    const files = [...event.target.files || []];
    if (!files.length) return;
    await processSelectedFiles(files);
  }

  async function handleFileSelect(event) {
    const files = [...(event?.target?.files || event?.files || [])];
    if (!files.length) return;
    await processSelectedFiles(files);
  }

  const fileInput = document.getElementById('fileInput');
  const uploadPanel = document.getElementById('uploadPanel');
  const dropHint = document.getElementById('dropHint');
  const canUseDragDrop = window.location.protocol !== 'file:';

  if (!canUseDragDrop) {
    if (dropHint) {
      dropHint.textContent = 'Dropping files here is not supported in this browser. Please use the "Choose files" button instead.';
    }
  }

  const preventDefaultDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (canUseDragDrop) {
    ['dragenter', 'dragover'].forEach((eventName) => {
      uploadPanel.addEventListener(eventName, (event) => {
        preventDefaultDrop(event);
        uploadPanel.classList.add('drag-over');
      });
    });

    ['dragleave', 'dragend', 'drop'].forEach((eventName) => {
      uploadPanel.addEventListener(eventName, (event) => {
        preventDefaultDrop(event);
        uploadPanel.classList.remove('drag-over');
      });
    });

    uploadPanel.addEventListener('drop', async (event) => {
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      await processSelectedFiles(files);
    });
  }

  fileInput.addEventListener('change', handleFileSelect);

  document.getElementById('clearBtn').addEventListener('click', () => {
    resetState();
    setStatus('No folder selected yet.');
  });

  document.getElementById('downloadLinksBtn').addEventListener('click', () => {
    if (!state.links.length && !state.errorOnly.length) return;

    if (state.links.length) {
      downloadBlob('spotify_failed_links.txt', state.links.join('\n') + '\n');
    }

    if (state.errorOnly.length) {
      downloadBlob('missing_spotify_links.txt', buildErrorLogText());
    }
  });
} else if (typeof require === 'function') {
  const targetFolder = process.argv[2] || path.join(process.cwd(), 'Logs');

  try {
    const result = collectFolder(targetFolder);
    const output = writeOutputFolder(process.cwd(), result);
    console.log(`Parsed ${result.links.length} failed Spotify links and ${result.errorOnly.length} error-only entries.`);
    console.log(`Output written to: ${output.outDir}`);
    console.log(`Links file: ${output.linksFile}`);
    console.log(`Error-only directory: ${output.errorDir}`);
  } catch (error) {
    console.error('Unable to read the Logs folder.');
    console.error(error.message);
    process.exit(1);
  }
}
