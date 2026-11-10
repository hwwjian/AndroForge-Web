const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
const isStaticPreview = window.location.hostname.endsWith('.github.io');

const state = {
  status: null,
  project: null,
  treeMode: 'apk',
  currentFile: null,
  intelligence: null,
  intelligenceFilter: 'all',
  currentIntelligenceItem: null,
  defaultLogs: $('#logs')?.innerHTML || '',
};

if (window.lucide) window.lucide.createIcons();

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function toast(message, isError = false) {
  const element = $('#toast');
  $('span', element).textContent = message;
  element.classList.toggle('error', isError);
  element.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => element.classList.remove('show'), isError ? 4200 : 2400);
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function emptyMessage(container, message) {
  const element = document.createElement('div');
  element.className = 'empty-tree';
  element.textContent = message;
  container.replaceChildren(element);
}

function readIntelligenceIds() {
  try { return new Set(JSON.parse(localStorage.getItem('androforge.intelligence.read') || '[]')); }
  catch { return new Set(); }
}

function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '--';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
  return new Date(value).toLocaleDateString('zh-CN');
}

function intelligenceTypeLabel(type) {
  return { vulnerability: '漏洞', tool: '工具', platform: '平台', article: '文章' }[type] || '更新';
}

function updateIntelligenceBadge() {
  const badge = $('#intelBadge');
  if (!state.intelligence) return;
  const read = readIntelligenceIds();
  const unread = state.intelligence.items.filter((item) => !read.has(item.id)).length;
  badge.hidden = unread === 0;
  badge.textContent = unread > 99 ? '99+' : unread;
}

function renderIntelligence() {
  const container = $('#intelFeed');
  if (!state.intelligence) return;
  const read = readIntelligenceIds();
  const items = state.intelligence.items.filter((item) => state.intelligenceFilter === 'all' || item.type === state.intelligenceFilter);
  if (!items.length) return emptyMessage(container, '当前分类没有消息');
  container.replaceChildren(...items.map((item) => {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = `intel-item${read.has(item.id) ? '' : ' unread'}`;
    link.dataset.intelId = item.id;
    const head = document.createElement('div');
    head.className = 'intel-item-head';
    const type = document.createElement('span');
    type.className = `intel-type ${item.type}`;
    type.textContent = intelligenceTypeLabel(item.type);
    const source = document.createElement('span');
    source.textContent = item.source;
    const time = document.createElement('time');
    time.dateTime = item.publishedAt;
    time.textContent = relativeTime(item.publishedAt);
    head.append(type, source, time);
    const title = document.createElement('h3');
    title.textContent = item.title;
    const summary = document.createElement('p');
    summary.textContent = item.summary || '暂无摘要';
    const tags = document.createElement('div');
    tags.className = 'intel-tags';
    (item.tags || []).slice(0, 3).forEach((tag) => {
      const element = document.createElement('span');
      element.textContent = tag;
      tags.appendChild(element);
    });
    link.append(head, title, summary, tags);
    return link;
  }));
}

function openIntelligenceReader(item) {
  if (!item) return;
  state.currentIntelligenceItem = item;
  $('#intelReaderSource').textContent = item.source || '安全情报';
  $('#intelReaderType').textContent = intelligenceTypeLabel(item.type);
  $('#intelReaderTime').dateTime = item.publishedAt || '';
  $('#intelReaderTime').textContent = item.publishedAt
    ? new Date(item.publishedAt).toLocaleString('zh-CN')
    : '--';
  $('#intelReaderTitle').textContent = item.title;
  $('#intelReaderSummary').textContent = item.summary || '暂无摘要';
  $('#intelReaderBody').textContent = item.content || item.summary || '当前来源没有提供更多正文内容。';
  $('#intelReaderOrigin').textContent = item.source || '未知来源';
  $('#intelReaderUrl').textContent = item.url || '--';
  $('#intelReaderTags').replaceChildren(...(item.tags || []).map((tag) => {
    const element = document.createElement('span');
    element.textContent = tag;
    return element;
  }));
  $('#intelReader').hidden = false;
  $('.code-workspace').classList.add('intel-reading');
  $('.editor-area').classList.add('intel-view');
  $('.breadcrumbs strong').textContent = '安全情报';
  if (window.innerWidth <= 620) $('#sidebar').classList.remove('mobile-open');
}

function closeIntelligenceReader() {
  state.currentIntelligenceItem = null;
  $('#intelReader').hidden = true;
  $('.code-workspace').classList.remove('intel-reading');
  $('.editor-area').classList.remove('intel-view');
  $('.breadcrumbs strong').textContent = state.currentFile?.path || '等待导入';
}

async function loadIntelligence(force = false, silent = false) {
  const status = $('#intelStatus');
  const refresh = $('#refreshIntelligence');
  if (isStaticPreview) {
    status.textContent = '本地服务未连接';
    refresh.disabled = true;
    emptyMessage($('#intelFeed'), '安全情报需要本地服务');
    return;
  }
  if (!silent) status.textContent = '正在抓取...';
  refresh.disabled = true;
  refresh.classList.add('spinning');
  const previousIds = new Set(state.intelligence?.items?.map((item) => item.id) || []);
  try {
    const data = await api(`/api/intelligence/latest${force ? '?refresh=1' : ''}`);
    state.intelligence = data;
    renderIntelligence();
    updateIntelligenceBadge();
    const working = data.sourceStatus.filter((source) => source.ok).length;
    status.textContent = `${data.items.length} 条 · ${working}/${data.sourceStatus.length} 源可用${data.cached ? ' · 缓存' : ''}`;
    $('#intelFetchedAt').textContent = relativeTime(data.fetchedAt);
    const sources = $('#intelSources');
    sources.replaceChildren(...data.sourceStatus.map((source) => {
      const element = document.createElement('span');
      element.className = source.ok ? '' : 'failed';
      const dot = document.createElement('i');
      const label = document.createTextNode(`${source.label} ${source.ok ? source.count : '失败'}`);
      element.append(dot, label);
      element.title = source.error || `${source.count} 条`;
      return element;
    }));
    const newItems = previousIds.size ? data.items.filter((item) => !previousIds.has(item.id)).length : 0;
    if (newItems && silent) toast(`安全情报新增 ${newItems} 条`);
  } catch (error) {
    status.textContent = '抓取失败';
    if (!silent) {
      emptyMessage($('#intelFeed'), error.message);
      toast(error.message, true);
    }
  } finally {
    refresh.disabled = false;
    refresh.classList.remove('spinning');
  }
}

function setButtonContent(button, icon, label) {
  button.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
  if (window.lucide) window.lucide.createIcons();
}

function setLogs(lines, kind = 'tool') {
  const logs = $('#logs');
  if (typeof lines === 'string') lines = lines.split(/\r?\n/).filter(Boolean);
  if (kind === 'logcat') $('#logCount').textContent = lines.length;
  if (!lines.length) {
    logs.innerHTML = '<p><time>--:--:--</time><span class="pid">INFO</span><span class="level info">I</span><strong>AndroForge</strong><span>没有可显示的输出</span></p>';
    return;
  }
  logs.replaceChildren(...lines.slice(-200).map((entry) => {
    const raw = typeof entry === 'string' ? entry : entry.message;
    const row = document.createElement('p');
    const time = typeof entry === 'string' ? new Date().toLocaleTimeString('zh-CN', { hour12: false }) : new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false });
    for (const [tag, value, className] of [
      ['time', time, ''], ['span', kind.toUpperCase(), 'pid'], ['span', kind === 'error' ? 'E' : 'I', `level ${kind === 'error' ? 'warn' : 'info'}`],
      ['strong', kind === 'logcat' ? 'ADB' : 'Toolchain', ''], ['span', raw, ''],
    ]) {
      const node = document.createElement(tag);
      node.className = className;
      node.textContent = value;
      row.appendChild(node);
    }
    return row;
  }));
}

function showJob(job) {
  $('#jobBanner').hidden = false;
  $('#jobStage').textContent = job.stage || '正在处理...';
  $('#jobPercent').textContent = `${job.progress || 0}%`;
  $('#jobProgress').value = job.progress || 0;
  if (job.logs?.length) setLogs(job.logs);
}

function hideJob() {
  $('#jobBanner').hidden = true;
}

async function monitorJob(job, onComplete) {
  showJob(job);
  while (job.state === 'queued' || job.state === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 850));
    ({ job } = await api(`/api/jobs/${job.id}`));
    showJob(job);
  }
  if (job.state === 'failed') {
    hideJob();
    setLogs(job.logs || [{ message: job.error, time: new Date().toISOString() }], 'error');
    throw new Error(job.error || '任务执行失败');
  }
  showJob(job);
  await new Promise((resolve) => setTimeout(resolve, 450));
  hideJob();
  if (onComplete) await onComplete(job.result);
  return job;
}

function renderCode(content, filePath, language = '') {
  const code = $('#codeContent');
  const lines = content.split('\n');
  code.replaceChildren(...lines.map((text, index) => {
    const row = document.createElement('span');
    row.className = 'line';
    const number = document.createElement('b');
    number.textContent = index + 1;
    const value = document.createElement('span');
    value.textContent = text || ' ';
    row.append(number, value);
    return row;
  }));
  const extension = language || filePath.split('.').pop()?.toUpperCase() || 'TEXT';
  $('.code-header .language').innerHTML = `<span></span> ${extension}`;
  $('#fileLanguage').textContent = extension;
  $('.breadcrumbs strong').textContent = filePath;
}

function addFileTab(filePath, root) {
  let tab = $$('.file-tab').find((item) => item.dataset.path === filePath && item.dataset.root === root);
  if (!tab) {
    tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'file-tab';
    tab.dataset.path = filePath;
    tab.dataset.root = root;
    tab.innerHTML = `<i data-lucide="file-code-2"></i><span></span><i class="close" data-lucide="x"></i>`;
    $('span', tab).textContent = filePath.split('/').pop();
    $('#tabbar').insertBefore(tab, $('.new-tab'));
    if (window.lucide) window.lucide.createIcons();
  }
  $$('.file-tab').forEach((item) => item.classList.toggle('active', item === tab));
}

async function openFile(root, filePath, line = 0) {
  if (!state.project) return;
  try {
    const data = await api(`/api/projects/${state.project.id}/file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(filePath)}`);
    state.currentFile = { root, path: filePath };
    closeIntelligenceReader();
    renderCode(data.content, filePath);
    addFileTab(filePath, root);
    $$('.line.evidence-focus', $('#codeContent')).forEach((row) => row.classList.remove('evidence-focus'));
    if (line > 0) {
      const row = $('#codeContent').children[line - 1];
      if (row) {
        row.classList.add('evidence-focus');
        row.scrollIntoView({ block: 'center' });
      }
    }
    if (window.innerWidth <= 620) $('#sidebar').classList.remove('mobile-open');
  } catch (error) {
    toast(error.message, true);
  }
}

function treeNode(item, root, depth = 0) {
  const wrapper = document.createElement('div');
  wrapper.className = item.type === 'directory' ? 'folder-node' : 'file-node';
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `tree-row ${item.type === 'directory' ? 'folder' : 'file'}`;
  row.style.paddingLeft = `${6 + Math.min(depth, 8) * 10}px`;
  row.dataset.path = item.path;
  row.dataset.root = root;
  if (item.type === 'directory') {
    row.innerHTML = '<i data-lucide="chevron-right"></i><i data-lucide="folder"></i><span></span>';
  } else {
    row.innerHTML = '<span class="tree-spacer"></span><i data-lucide="file-code"></i><span></span><small></small>';
    $('small', row).textContent = item.size > 1024 * 1024 ? formatBytes(item.size) : '';
  }
  $$('span', row).find((span) => !span.classList.contains('tree-spacer')).textContent = item.name;
  wrapper.appendChild(row);
  if (item.type === 'directory' && item.children?.length) {
    const children = document.createElement('div');
    children.className = 'tree-children';
    children.hidden = true;
    item.children.forEach((child) => children.appendChild(treeNode(child, root, depth + 1)));
    wrapper.appendChild(children);
  }
  return wrapper;
}

async function loadTree(mode = state.treeMode) {
  if (!state.project || state.project.state !== 'ready') return;
  state.treeMode = mode;
  const root = mode === 'java' ? 'sources' : 'decoded';
  const data = await api(`/api/projects/${state.project.id}/tree?root=${root}`);
  let tree = data.tree;
  if (mode === 'smali') tree = tree.filter((item) => /^smali/.test(item.name));
  const container = $('#fileTree');
  container.dataset.mode = 'real';
  container.replaceChildren(...tree.map((item) => treeNode(item, root)));
  if (!tree.length) container.innerHTML = '<div class="empty-tree">当前视图没有可显示的文件</div>';
  const countNodes = (nodes) => nodes.reduce((counts, item) => {
    if (item.type === 'directory') counts.directories += 1;
    else counts.files += 1;
    if (item.children) {
      const nested = countNodes(item.children);
      counts.directories += nested.directories;
      counts.files += nested.files;
    }
    return counts;
  }, { directories: 0, files: 0 });
  const counts = countNodes(tree);
  $('#folderCount').textContent = counts.directories;
  $('#fileCount').textContent = counts.files;
  $('#riskCount').textContent = state.project.analysis?.risks?.length ?? '--';
  if (window.lucide) window.lucide.createIcons();
}

function updateAnalysis(analysis) {
  if (!analysis) return;
  const score = $('.score-ring strong');
  score.textContent = analysis.score;
  $('.analysis-score p').textContent = `发现 ${analysis.risks.length} 个待检查项`;
  $('.analysis-score > div:last-child strong').textContent = analysis.score >= 80 ? '低风险' : analysis.score >= 55 ? '中等风险' : '高风险';
  const list = $('.check-list');
  list.replaceChildren(...analysis.risks.map((risk) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<span class="severity ${risk.severity}"></span><div><strong></strong><small></small><small class="evidence-path"></small></div><i data-lucide="chevron-right"></i>`;
    $('strong', button).textContent = risk.title;
    $('small:not(.evidence-path)', button).textContent = risk.detail;
    const firstEvidence = risk.evidence?.[0];
    $('.evidence-path', button).textContent = firstEvidence ? `${firstEvidence.path}:${firstEvidence.line}` : '暂无可定位证据';
    if (firstEvidence) {
      button.dataset.root = firstEvidence.root;
      button.dataset.path = firstEvidence.path;
      button.dataset.line = firstEvidence.line;
    }
    return button;
  }));
  if (!analysis.risks.length) list.innerHTML = '<div class="empty-tree">未发现规则库覆盖的风险</div>';
  const components = ['activity', 'service', 'receiver', 'provider'];
  $$('.component-grid button strong').forEach((element, index) => { element.textContent = analysis.components?.[components[index]] ?? 0; });
  const metadata = $$('.metadata dd');
  if (metadata[0]) metadata[0].textContent = analysis.packageName || '未知';
  if (metadata[1]) metadata[1].innerHTML = `<span class="sdk">${analysis.minSdk || '?'}</span> Android`;
  if (metadata[2]) metadata[2].innerHTML = `<span class="sdk">${analysis.targetSdk || '?'}</span> Android`;
  if (metadata[3]) metadata[3].textContent = analysis.architectures?.length ? analysis.architectures.join(', ') : '无原生库';
  if (metadata[4]) {
    metadata[4].className = analysis.signature?.verified ? 'verified' : '';
    metadata[4].textContent = analysis.signature?.verified
      ? `${analysis.signature.schemes.join(' / ') || '已'} 签名有效`
      : '未签名或签名无效';
  }
  const permissionList = $('.permission-list');
  permissionList.replaceChildren(...analysis.permissions.map((permission) => {
    const dangerous = /CONTACTS|SMS|CALL_LOG|LOCATION|CAMERA|MICROPHONE|RECORD_AUDIO|STORAGE/.test(permission);
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<span class="severity ${dangerous ? 'high' : 'low'}"></span><span></span><i data-lucide="arrow-up-right"></i>`;
    const label = permission.split('.').pop();
    $('span:nth-child(2)', button).innerHTML = '';
    const name = document.createTextNode(label);
    const detail = document.createElement('small');
    detail.textContent = dangerous ? '危险权限' : '普通权限';
    $('span:nth-child(2)', button).append(name, detail);
    return button;
  }));
  $('.count-badge').textContent = analysis.permissions.length;
  $('#riskCount').textContent = analysis.risks.length;
  $('#problemCount').textContent = analysis.risks.length;
  const profile = analysis.profile;
  $('#analysisProfile').hidden = !profile;
  if (profile) {
    $('#profileSha').textContent = profile.sha256?.slice(0, 16) || '--';
    $('#profileSha').title = profile.sha256 || '';
    $('#profileFiles').textContent = profile.fileCount ?? 0;
    $('#profileDex').textContent = profile.dexCount ?? 0;
    $('#profileNative').textContent = profile.nativeLibraries?.length ?? 0;
    $('#profileDomains').textContent = profile.domains?.length ?? 0;
    const domains = $('#domainList');
    domains.replaceChildren(...(profile.domains || []).slice(0, 30).map((domain) => {
      const button = document.createElement('button');
      button.type = 'button';
      const evidence = profile.urls?.find((item) => {
        try { return new URL(item.url).hostname.toLowerCase() === domain; } catch { return false; }
      });
      if (evidence) {
        button.dataset.root = evidence.root;
        button.dataset.path = evidence.path;
        button.dataset.line = evidence.line;
      }
      button.innerHTML = '<i data-lucide="globe-2"></i><span></span>';
      $('span', button).textContent = domain;
      return button;
    }));
    if (!profile.domains?.length) domains.innerHTML = '<div class="empty-tree">未提取到域名</div>';
  }
  if (window.lucide) window.lucide.createIcons();
}

function resetAnalysisView(detail = '导入并反编译 APK 后运行扫描') {
  $('.score-ring strong').textContent = '--';
  $('.analysis-score > div:last-child strong').textContent = '尚未扫描';
  $('.analysis-score p').textContent = detail;
  $('.check-list').innerHTML = '<div class="empty-tree">暂无扫描结果</div>';
  $('#riskCount').textContent = '0';
  $('#problemCount').textContent = '0';
  $('#analysisProfile').hidden = true;
  $('#downloadReport').hidden = true;
}

function resetInspector(name, detail) {
  $('.app-overview strong').textContent = name;
  $('.app-overview span').textContent = detail;
  $$('.metadata dd').forEach((item) => { item.textContent = '--'; item.className = ''; });
  $$('.component-grid button strong').forEach((item) => { item.textContent = '0'; });
  $('.permission-list').innerHTML = '<div class="empty-tree">暂无权限数据</div>';
  $('.count-badge').textContent = '0';
}

function resetWorkspace(message, breadcrumb) {
  state.currentFile = null;
  closeIntelligenceReader();
  $('#fileTree').innerHTML = `<div class="empty-tree">${message}</div>`;
  $('#folderCount').textContent = '0';
  $('#fileCount').textContent = '0';
  $$('.file-tab').forEach((tab) => tab.remove());
  renderCode(`// ${message}`, breadcrumb, 'TEXT');
}

async function loadProject(project) {
  state.project = project;
  const appName = project.name.replace(/\.(apk|xapk|apks)$/i, '');
  const stateLabel = { imported: '等待反编译', ready: '分析就绪', failed: '处理失败' }[project.state] || project.state;
  $('#projectName').textContent = project.name;
  $('#projectMeta').textContent = `${project.analysis?.packageName || stateLabel} · ${formatBytes(project.size)}`;
  $('#projectStateStatus').textContent = stateLabel;
  $('#buildOutputName').value = `${appName}_patched.apk`;
  $('#resumeDecompile').hidden = project.state === 'ready';
  $('#runAnalysis').hidden = project.state !== 'ready';
  $('#downloadReport').hidden = !project.analysis;
  if (project.analysis) $('#downloadReport').href = `/api/projects/${project.id}/report`;
  $('.breadcrumbs > span').textContent = project.name;
  $('.app-overview strong').textContent = appName;
  $('.app-overview span').textContent = project.analysis
    ? `v${project.analysis.versionName || '?'} (${project.analysis.versionCode || '?'})`
    : stateLabel;
  $('#buildResult').hidden = !project.lastBuild;
  if (project.lastBuild) $('#downloadBuild').href = `/api/projects/${project.id}/output`;
  if (project.analysis) updateAnalysis(project.analysis);
  else resetAnalysisView(project.state === 'ready' ? '可运行安全扫描' : '等待反编译完成');
  if (project.state === 'ready') {
    $$('.file-tab').forEach((tab) => tab.remove());
    await loadTree(state.treeMode);
    try { await openFile('decoded', 'AndroidManifest.xml'); } catch {}
  } else {
    resetWorkspace('项目已导入，等待反编译完成', '等待反编译');
    resetInspector(appName, stateLabel);
  }
}

function showEmptyState() {
  state.project = null;
  $('#projectName').textContent = '打开 APK 开始分析';
  $('#projectMeta').textContent = '本地处理 · 文件不会上传';
  $('#projectStateStatus').textContent = '未载入项目';
  $('#buildOutputName').value = '';
  $('#buildResult').hidden = true;
  $('#resumeDecompile').hidden = true;
  $('#runAnalysis').hidden = false;
  resetWorkspace('按 Ctrl+O 或点击顶部项目区域导入 APK', '等待导入');
  $('.breadcrumbs > span').textContent = '未打开项目';
  resetInspector('未载入应用', '等待导入 APK');
  resetAnalysisView();
}

async function loadFridaProcesses() {
  const container = $('#fridaProcesses');
  container.innerHTML = '<div class="empty-tree">正在读取 USB 进程...</div>';
  try {
    const data = await api('/api/frida/processes');
    const lines = (data.output || data.error || '').split(/\r?\n/)
      .filter((line) => line.trim() && !/^\s*PID\s+Name\s+Identifier/.test(line) && !/^[-\s]+$/.test(line));
    if (!lines.length || data.error) {
      emptyMessage(container, data.error || '未发现进程，请确认设备已启动 frida-server');
      return;
    }
    container.replaceChildren(...lines.slice(0, 80).map((line) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = '<i data-lucide="cpu"></i><span></span><i data-lucide="chevron-right"></i>';
      $('span', button).textContent = line;
      return button;
    }));
    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    emptyMessage(container, error.message);
  }
}

async function refreshStatus() {
  if (isStaticPreview) {
    showEmptyState();
    $('#projectMeta').textContent = '网页预览 · 本地工具链未连接';
    $('#projectStateStatus').textContent = '网页预览';
    $('#deviceName').textContent = '网页预览';
    $('#deviceVersion').textContent = 'Pages';
    $('.device-pill .status-dot').style.background = 'var(--amber)';
    $('.statusbar .connected').textContent = 'GitHub Pages · 仅界面预览';
    $('#fridaStatus small').textContent = '需要本地 Frida 环境';
    $('#fridaStatus .status-dot').style.background = 'var(--amber)';
    $('#runAnalysis').disabled = true;
    $('#buildButton').disabled = true;
    toast('网页预览已加载，真实分析能力需要本地服务');
    return;
  }
  try {
    state.status = await api('/api/status');
    const device = state.status.devices[0];
    $('#deviceName').textContent = device ? device.model : '无设备';
    $('#deviceVersion').textContent = device ? device.serial : 'ADB';
    $('.device-pill .status-dot').style.background = device ? 'var(--green)' : 'var(--red)';
    $('.statusbar .connected').textContent = device ? `设备已连接 · ${device.model}` : 'ADB 未连接设备';
    const frida = state.status.tools.frida?.available;
    $('#fridaStatus small').textContent = frida ? '命令行工具已就绪' : '未安装 Frida CLI';
    $('#fridaStatus .status-dot').style.background = frida ? 'var(--green)' : 'var(--amber)';
    if (!state.project && state.status.projects.length) await loadProject(state.status.projects[0]);
    else if (!state.project) showEmptyState();
  } catch (error) {
    $('#projectMeta').textContent = '后端未连接，请运行 npm start';
    $('.device-pill .status-dot').style.background = 'var(--red)';
    toast(error.message, true);
  }
}

async function importApk(file) {
  if (!file) return;
  if (isStaticPreview) {
    $('#apkInput').value = '';
    return toast('网页预览不会上传 APK，请在本机运行 npm start', true);
  }
  if (!/\.apk$/i.test(file.name)) return toast('当前版本仅支持标准 APK 文件', true);
  closeCommand();
  const banner = $('#jobBanner');
  banner.hidden = false;
  $('#jobStage').textContent = `正在导入 ${file.name}`;
  $('#jobPercent').textContent = formatBytes(file.size);
  $('#jobProgress').removeAttribute('value');
  try {
    const data = await api(`/api/projects/import?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    state.project = data.project;
    $('#jobProgress').value = 0;
    await loadProject(data.project);
    await startDecompilation(data.project);
  } catch (error) {
    hideJob();
    toast(error.message, true);
  } finally {
    $('#apkInput').value = '';
  }
}

async function startDecompilation(project = state.project) {
  if (!project) return toast('请先导入 APK', true);
  const button = $('#resumeDecompile');
  button.disabled = true;
  setButtonContent(button, 'loader-circle', '正在反编译');
  try {
    const decompile = await api(`/api/projects/${project.id}/decompile`, { method: 'POST' });
    await monitorJob(decompile.job, async (result) => {
      await loadProject(result.project);
      toast('APK 反编译与安全分析完成');
    });
  } catch (error) {
    hideJob();
    toast(error.message, true);
  } finally {
    button.disabled = false;
    setButtonContent(button, 'rotate-cw', '继续反编译');
  }
}

async function runAnalysis() {
  if (!state.project || state.project.state !== 'ready') return toast('请先导入并完成反编译', true);
  const button = $('#runAnalysis');
  button.disabled = true;
  setButtonContent(button, 'loader-circle', '正在扫描');
  try {
    const data = await api(`/api/projects/${state.project.id}/analysis`, { method: 'POST' });
    await monitorJob(data.job, async (result) => {
      await loadProject(result.project);
      toast(`扫描完成：发现 ${result.project.analysis.risks.length} 个风险项`);
    });
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    setButtonContent(button, 'play', '重新运行扫描');
  }
}

async function buildProject() {
  if (!state.project || state.project.state !== 'ready') return toast('请先导入并反编译 APK', true);
  const button = $('#buildButton');
  button.disabled = true;
  setButtonContent(button, 'loader-circle', '正在构建');
  try {
    const data = await api(`/api/projects/${state.project.id}/build`, { method: 'POST' });
    await monitorJob(data.job, async (result) => {
      $('#buildResult').hidden = false;
      $('#downloadBuild').href = result.downloadUrl;
      toast('重打包、对齐与签名完成');
    });
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    setButtonContent(button, 'hammer', '重新构建并签名');
  }
}

async function installBuild() {
  if (!state.project) return;
  if (!window.confirm('将把签名后的 APK 安装到当前 ADB 设备，是否继续？')) return;
  try {
    const data = await api(`/api/projects/${state.project.id}/install`, { method: 'POST' });
    await monitorJob(data.job, () => toast('APK 已安装到设备'));
  } catch (error) { toast(error.message, true); }
}

async function refreshLogcat() {
  try {
    setLogs(['正在读取设备 Logcat...']);
    const data = await api('/api/adb/logcat');
    setLogs((data.output || data.error).split(/\r?\n/).filter(Boolean), 'logcat');
    toast('已读取最近 200 行 Logcat');
  } catch (error) { toast(error.message, true); }
}

let searchTimer;
async function globalSearch(query) {
  const list = $('.search-results');
  const term = query.trim();
  if (!state.project || state.project.state !== 'ready') {
    $('.result-caption').textContent = '请先导入并完成反编译';
    return emptyMessage(list, '暂无搜索结果');
  }
  if (term.length < 2) {
    $('.result-caption').textContent = '输入至少 2 个字符开始搜索';
    return emptyMessage(list, '暂无搜索结果');
  }
  list.innerHTML = '<div class="empty-tree">正在搜索...</div>';
  try {
    const data = await api(`/api/projects/${state.project.id}/search?q=${encodeURIComponent(term)}`);
    $('.result-caption').textContent = `${data.results.length} 个结果`;
    list.replaceChildren(...data.results.map((result) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.root = result.root;
      button.dataset.path = result.path;
      button.innerHTML = '<strong></strong><span></span><small></small>';
      $('strong', button).textContent = result.path.split('/').pop();
      $('span', button).textContent = result.text;
      $('small', button).textContent = result.line;
      return button;
    }));
    if (!data.results.length) list.innerHTML = '<div class="empty-tree">没有找到匹配内容</div>';
  } catch (error) { emptyMessage(list, error.message); }
}

const overlay = $('#commandOverlay');
function openCommand() {
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#commandInput').focus(), 20);
}
function closeCommand() {
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

$$('.activity-btn[data-panel]').forEach((button) => {
  button.addEventListener('click', () => {
    $$('.activity-btn[data-panel]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    $$('.side-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panelContent === button.dataset.panel));
    $('#sidebar').classList.add('mobile-open');
    if (button.dataset.panel === 'search') $('#globalSearch').focus();
    if (button.dataset.panel === 'hook') loadFridaProcesses();
    if (button.dataset.panel === 'intelligence') loadIntelligence(false);
  });
});

$$('.view-tabs button').forEach((button) => button.addEventListener('click', async () => {
  $$('.view-tabs button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  try { await loadTree(button.dataset.tree); } catch (error) { toast(error.message, true); }
}));

$$('.segmented button').forEach((button) => button.addEventListener('click', () => {
  $$('.segmented button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  toast(button.dataset.view === 'structure' ? '结构视图会在下一版提供可视化编辑' : '已切换为源码视图');
}));

$('#fileTree').addEventListener('click', (event) => {
  const row = event.target.closest('.tree-row');
  if (!row) return;
  if (row.classList.contains('folder')) {
    const children = row.nextElementSibling;
    if (children) children.hidden = !children.hidden;
    row.classList.toggle('open', children && !children.hidden);
    const firstIcon = $('svg', row);
    const folderIcon = $$('svg', row)[1];
    if (firstIcon) firstIcon.outerHTML = `<i data-lucide="${row.classList.contains('open') ? 'chevron-down' : 'chevron-right'}"></i>`;
    if (folderIcon) folderIcon.outerHTML = `<i data-lucide="${row.classList.contains('open') ? 'folder-open' : 'folder'}"></i>`;
    if (window.lucide) window.lucide.createIcons();
  } else if (state.project && row.dataset.path) {
    $$('.tree-row.file').forEach((item) => item.classList.remove('active'));
    row.classList.add('active');
    openFile(row.dataset.root, row.dataset.path);
  }
});

$('#tabbar').addEventListener('click', (event) => {
  const tab = event.target.closest('.file-tab');
  if (!tab) return;
  if (event.target.closest('.close')) {
    tab.remove();
    return;
  }
  if (tab.dataset.path) openFile(tab.dataset.root, tab.dataset.path);
  else {
    $$('.file-tab').forEach((item) => item.classList.toggle('active', item === tab));
    $('.breadcrumbs strong').textContent = tab.dataset.tab;
  }
});

$('#treeFilter').addEventListener('input', (event) => {
  const term = event.target.value.trim().toLowerCase();
  $$('.tree-row', $('#fileTree')).forEach((row) => {
    if (row.classList.contains('file')) row.closest('.file-node, .tree-row').style.display = !term || row.textContent.toLowerCase().includes(term) ? '' : 'none';
  });
});

$('#globalSearch').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => globalSearch(event.target.value), 320);
});
$('.search-results').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-path]');
  if (button) openFile(button.dataset.root, button.dataset.path);
});

$('.check-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-path]');
  if (button) openFile(button.dataset.root, button.dataset.path, Number(button.dataset.line || 0));
});

$('#domainList').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-path]');
  if (button) openFile(button.dataset.root, button.dataset.path, Number(button.dataset.line || 0));
});

$$('.intel-filters button').forEach((button) => button.addEventListener('click', () => {
  $$('.intel-filters button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  state.intelligenceFilter = button.dataset.intelFilter;
  renderIntelligence();
}));

$('#intelFeed').addEventListener('click', (event) => {
  const item = event.target.closest('[data-intel-id]');
  if (!item) return;
  const read = readIntelligenceIds();
  read.add(item.dataset.intelId);
  localStorage.setItem('androforge.intelligence.read', JSON.stringify([...read].slice(-300)));
  item.classList.remove('unread');
  updateIntelligenceBadge();
  openIntelligenceReader(state.intelligence?.items.find((entry) => entry.id === item.dataset.intelId));
});

$('#closeIntelReader').addEventListener('click', closeIntelligenceReader);
$('#copyIntelLink').addEventListener('click', async () => {
  const url = state.currentIntelligenceItem?.url;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast('原文链接已复制');
  } catch {
    toast('无法访问剪贴板', true);
  }
});

$$('[data-action="command"], .new-tab, #projectSwitcher').forEach((button) => button.addEventListener('click', openCommand));
$('[data-action="focus-search"]').addEventListener('click', () => $('.activity-btn[data-panel="search"]').click());
overlay.addEventListener('click', (event) => { if (event.target === overlay) closeCommand(); });

$$('.command-list button').forEach((button) => button.addEventListener('click', () => {
  closeCommand();
  const command = button.dataset.command;
  if (command === 'open') $('#apkInput').click();
  if (command === 'scan') { $('.activity-btn[data-panel="analysis"]').click(); runAnalysis(); }
  if (command === 'intelligence') { $('.activity-btn[data-panel="intelligence"]').click(); loadIntelligence(true); }
  if (command === 'frida') $('.activity-btn[data-panel="hook"]').click();
  if (command === 'build') { $('.activity-btn[data-panel="build"]').click(); buildProject(); }
}));

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommand(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); $('#apkInput').click(); }
  if (event.key === 'Escape') { closeCommand(); $('#sidebar').classList.remove('mobile-open'); }
});

$('#apkInput').addEventListener('change', (event) => importApk(event.target.files[0]));
$('#runAnalysis').addEventListener('click', runAnalysis);
$('#resumeDecompile').addEventListener('click', () => startDecompilation(state.project));
$('#buildButton').addEventListener('click', buildProject);
$('#installBuild').addEventListener('click', installBuild);
$('#refreshLogcat').addEventListener('click', refreshLogcat);
$('#refreshIntelligence').addEventListener('click', () => loadIntelligence(true));
$('#deviceButton').addEventListener('click', refreshStatus);
$('#fridaStatus button').addEventListener('click', async () => { await refreshStatus(); loadFridaProcesses(); });
$('[data-action="settings"]').addEventListener('click', () => toast('工具路径由服务端自动探测'));

const consoleResizer = $('#consoleResizer');

function consoleHeightMode() {
  const mobile = window.innerWidth <= 620;
  return {
    mobile,
    variable: mobile ? '--console-height-mobile' : '--console-height-desktop',
    storageKey: mobile ? 'androforge.console.height.mobile' : 'androforge.console.height.desktop',
    minimum: mobile ? 110 : 120,
  };
}

function consoleHeightBounds() {
  const editorHeight = $('.editor-area').getBoundingClientRect().height;
  const topRows = window.innerWidth <= 620 ? 76 : 86;
  return { maximum: Math.max(120, editorHeight - topRows - 180) };
}

function expandConsoleForResize(mobile) {
  const editor = $('.editor-area');
  if (mobile) editor.classList.add('console-open-mobile');
  else editor.classList.remove('console-collapsed');
}

function setConsoleHeight(value, persist = false) {
  const mode = consoleHeightMode();
  const { maximum } = consoleHeightBounds();
  const height = Math.round(Math.min(maximum, Math.max(mode.minimum, value)));
  $('.editor-area').style.setProperty(mode.variable, `${height}px`);
  consoleResizer.setAttribute('aria-valuemin', mode.minimum);
  consoleResizer.setAttribute('aria-valuemax', Math.round(maximum));
  consoleResizer.setAttribute('aria-valuenow', height);
  if (persist) localStorage.setItem(mode.storageKey, String(height));
  return height;
}

function currentConsoleHeight() {
  const mode = consoleHeightMode();
  return Number.parseFloat(getComputedStyle($('.editor-area')).getPropertyValue(mode.variable)) || (mode.mobile ? 165 : 174);
}

for (const mode of ['desktop', 'mobile']) {
  const value = Number(localStorage.getItem(`androforge.console.height.${mode}`));
  if (Number.isFinite(value) && value > 0) {
    $('.editor-area').style.setProperty(`--console-height-${mode}`, `${value}px`);
  }
}

let consoleResizeState = null;
consoleResizer.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const mode = consoleHeightMode();
  expandConsoleForResize(mode.mobile);
  consoleResizeState = { pointerId: event.pointerId, startY: event.clientY, startHeight: currentConsoleHeight() };
  consoleResizer.setPointerCapture(event.pointerId);
  document.body.classList.add('resizing-console');
  event.preventDefault();
});

consoleResizer.addEventListener('pointermove', (event) => {
  if (!consoleResizeState || event.pointerId !== consoleResizeState.pointerId) return;
  setConsoleHeight(consoleResizeState.startHeight + consoleResizeState.startY - event.clientY);
});

function finishConsoleResize(event) {
  if (!consoleResizeState || event.pointerId !== consoleResizeState.pointerId) return;
  setConsoleHeight(currentConsoleHeight(), true);
  consoleResizeState = null;
  document.body.classList.remove('resizing-console');
}

consoleResizer.addEventListener('pointerup', finishConsoleResize);
consoleResizer.addEventListener('pointercancel', finishConsoleResize);
consoleResizer.addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const mode = consoleHeightMode();
  expandConsoleForResize(mode.mobile);
  setConsoleHeight(currentConsoleHeight() + (event.key === 'ArrowUp' ? 24 : -24), true);
  event.preventDefault();
});

$('#collapseConsole').addEventListener('click', () => {
  const editor = $('.editor-area');
  if (window.innerWidth <= 620) editor.classList.toggle('console-open-mobile');
  else editor.classList.toggle('console-collapsed');
});

$$('.switch').forEach((button) => button.addEventListener('click', () => button.classList.toggle('on')));
$$('.bottom-tabs > button').forEach((button) => button.addEventListener('click', () => {
  $$('.bottom-tabs > button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  if (button.dataset.console === 'logcat') refreshLogcat();
  else if (button.dataset.console === 'build') setLogs(['构建任务的实时输出会显示在这里']);
  else setLogs(state.project?.analysis?.risks?.map((risk) => `${risk.severity.toUpperCase()} ${risk.title}: ${risk.detail}`) || []);
}));

window.addEventListener('resize', () => { if (window.innerWidth > 620) $('#sidebar').classList.remove('mobile-open'); });
refreshStatus();
setTimeout(() => loadIntelligence(false, true), 700);
setInterval(() => loadIntelligence(false, true), 15 * 60 * 1000);
