const baseUrl = 'http://localhost:3001/api';

// 全局配置：隐藏文件过滤规则（增强版）
const HIDDEN_FILE_PATTERNS = [
	// 特殊临时文件（如 Word 临时文件）
	/^~/,
	// Windows 系统文件
	/^desktop\.ini$/,
	/\.sys$/,
	/\.bak$/,
	// Linux/Mac 隐藏文件（. 开头）
	/^\./,
	// 其他特殊隐藏文件
	/^Thumbs\.db$/,
	/^ehthumbs\.db$/,
	/^\.DS_Store$/,
	/^\.Spotlight-V100/,
	/^\.Trashes/,
	/^Icon\r$/,
	/^\.AppleDouble$/,
	/^\.LSOverride$/,
	// Windows 隐藏系统文件
	/^\$RECYCLE\.BIN$/,
	/^System Volume Information$/,
	/^bootmgr$/,
	/^BOOTSECT\.BAK$/,
];

// 判断是否为隐藏文件
function isHiddenFile(fileName) {
	return HIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

// 全局状态管理
let currentPath = '';
let parentPath = '';
let currentViewMode = 'card';
let fileDataCache = {};
let sortConfig = { field: '', direction: '', original: [] };
let searchKeyword = '';
let currentContextItem = null;
let selectedItems = [];
let clipboard = null;
let clipboardAction = null; // 'copy' or 'cut'
const contextMenu = document.getElementById('contextMenu');

// 前端路径处理工具函数（替代Node.js的path模块）
const pathUtils = {
	dirname: function (path) {
		const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
		const lastSlash = normalized.lastIndexOf('/');
		return lastSlash === -1 ? '.' : normalized.substring(0, lastSlash);
	},
	join: function (...paths) {
		const joined = paths.join('/').replace(/\\/g, '/');
		return joined.replace(/\/+/g, '/');
	},
	basename: function (path) {
		const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
		const lastSlash = normalized.lastIndexOf('/');
		return lastSlash === -1
			? normalized
			: normalized.substring(lastSlash + 1);
	},
	// 判断是否为快捷方式文件
	isShortcut: function (fileName) {
		return fileName.toLowerCase().endsWith('.lnk');
	},
};

// ===================== 初始化事件绑定 =====================
document.addEventListener('DOMContentLoaded', function () {
	// 基础操作事件
	document
		.getElementById('confirmBtn')
		.addEventListener('click', loadPathData);
	document.getElementById('backBtnSidebar').addEventListener('click', goBack);
	document.getElementById('backBtnContent').addEventListener('click', goBack);
	document
		.getElementById('cardViewBtn')
		.addEventListener('click', () => switchViewMode('card'));
	document
		.getElementById('listViewBtn')
		.addEventListener('click', () => switchViewMode('list'));
	document
		.getElementById('pathInput')
		.addEventListener(
			'keydown',
			(e) => e.key === 'Enter' && loadPathData()
		);

	// 搜索事件
	document.getElementById('searchInput').addEventListener('input', (e) => {
		searchKeyword = e.target.value.trim().toLowerCase();
		filterAndRenderFiles();
	});

	// 导出Excel事件
	document
		.getElementById('exportExcelBtn')
		.addEventListener('click', exportToExcel);

	// 批量操作事件
	document
		.getElementById('batchDeleteBtn')
		.addEventListener('click', batchDelete);
	document
		.getElementById('batchCopyBtn')
		.addEventListener('click', batchCopy);
	document.getElementById('batchMoveBtn').addEventListener('click', batchCut);

	// 点击空白处关闭右键菜单
	document.addEventListener('click', (e) => {
		if (!contextMenu.contains(e.target)) {
			contextMenu.style.display = 'none';
			currentContextItem = null;
		}
	});

	// 右键菜单点击事件
	document
		.getElementById('menuOpen')
		.addEventListener('click', handleMenuOpen);
	document
		.getElementById('menuRename')
		.addEventListener('click', handleMenuRename);
	document
		.getElementById('menuDelete')
		.addEventListener('click', handleMenuDelete);
	document
		.getElementById('menuNewFolder')
		.addEventListener('click', handleMenuNewFolder);
	document
		.getElementById('menuNewFile')
		.addEventListener('click', handleMenuNewFile);
	document
		.getElementById('menuCopy')
		.addEventListener('click', handleMenuCopy);
	document.getElementById('menuCut').addEventListener('click', handleMenuCut);
	document
		.getElementById('menuPaste')
		.addEventListener('click', handleMenuPaste);

	// 初始化功能模块
	initResponsiveSidebar();
	initDragUpload();
	initClipboardTip();

	// 页面加载时恢复路径
	const savedPath = localStorage.getItem('currentPath');
	if (savedPath) {
		document.getElementById('pathInput').value = savedPath;
		loadPathData();
	}
});

// ===================== 核心功能函数 =====================

// 切换视图模式（卡片/列表）
function switchViewMode(mode) {
	currentViewMode = mode;
	document
		.getElementById('cardViewBtn')
		.classList.toggle('active', mode === 'card');
	document
		.getElementById('listViewBtn')
		.classList.toggle('active', mode === 'list');
	// 控制导出按钮显示（仅列表模式显示）
	document.getElementById('exportExcelBtn').style.display =
		mode === 'list' ? 'block' : 'none';
	filterAndRenderFiles();
}

// 显示加载动画
function showLoading(message = '加载中...') {
	const overlay = document.getElementById('loadingOverlay');
	if (overlay) {
		overlay.style.display = 'flex';
		overlay.querySelector('.loading-text').textContent = message;
	}
}

// 隐藏加载动画
function hideLoading() {
	const overlay = document.getElementById('loadingOverlay');
	if (overlay) overlay.style.display = 'none';
}

// 加载路径数据（过滤隐藏文件）
async function loadPathData() {
	const inputPath = document.getElementById('pathInput').value.trim();
	if (!inputPath) return alert('请输入有效的文件夹路径！');

	showLoading();
	try {
		const safePath = inputPath.replace(/\//g, '\\');
		const res = await fetch(`${baseUrl}/getFiles`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetPath: safePath }),
		});
		const data = await res.json();

		if (data.code === 0) {
			currentPath = data.data.currentPath;
			parentPath = data.data.parentPath;

			// 保存当前路径到localStorage
			localStorage.setItem('currentPath', currentPath);

			// 过滤隐藏文件
			const filteredDirs = data.data.dirs.filter(
				(dir) => !isHiddenFile(dir.name)
			);
			const filteredFiles = data.data.files.filter(
				(file) => !isHiddenFile(file.name)
			);

			// 缓存当前路径数据
			fileDataCache[currentPath] = {
				dirs: filteredDirs,
				files: filteredFiles,
				items: [
					...filteredDirs.map((d) => ({ ...d, type: 'dir' })),
					...filteredFiles.map((f) => ({ ...f, type: 'file' })),
				],
			};

			// 重置排序和搜索
			sortConfig = {
				field: '',
				direction: '',
				original: [...fileDataCache[currentPath].items],
			};
			searchKeyword = '';
			document.getElementById('searchInput').value = '';

			// 更新UI显示
			document.getElementById(
				'pathBar'
			).textContent = `📁 ${currentPath}`;
			const isRoot = currentPath === parentPath;
			document.getElementById('backBtnSidebar').disabled = isRoot;
			document.getElementById('backBtnContent').disabled = isRoot;

			// 渲染目录树和文件列表
			renderTree(currentPath);
			filterAndRenderFiles();
		} else {
			showError(data.msg);
		}
	} catch (err) {
		showError(`加载失败：${err.message}`);
	} finally {
		hideLoading();
	}
}

// 导出Excel文件
async function exportToExcel() {
	if (!currentPath || !fileDataCache[currentPath]) {
		alert('暂无数据可导出');
		return;
	}

	showLoading('正在生成Excel文件...');
	try {
		// 获取当前筛选后的文件列表
		let items = [...fileDataCache[currentPath].items];
		if (searchKeyword) {
			items = items.filter((item) =>
				item.name.toLowerCase().includes(searchKeyword)
			);
		}
		items = sortFiles(items, sortConfig.field, sortConfig.direction);

		// 转换数据格式
		const exportData = items.map((item) => ({
			文件名: item.name,
			类型:
				item.type === 'dir'
					? '文件夹'
					: pathUtils.isShortcut(item.name)
					? '文件夹快捷方式'
					: '文件',
			大小: item.type === 'dir' ? '-' : formatFileSize(item.size),
			修改时间: item.mtime,
			路径: item.path,
		}));

		// 优化：简化文件名，避免特殊字符
		const folderName = pathUtils
			.basename(currentPath)
			.replace(/[^\w\u4e00-\u9fa5]/g, '_')
			.substring(0, 20);
		const fileName = `文件列表_${folderName}_${new Date().getTime()}`;

		// 调用后端接口生成并下载Excel
		const res = await fetch(`${baseUrl}/exportExcel`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				data: exportData,
				fileName: fileName,
			}),
		});

		// 处理文件下载
		const blob = await res.blob();
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `文件列表_${folderName}.xlsx`;
		document.body.appendChild(a);
		a.click();
		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);

		hideLoading();
		alert('✅ Excel导出成功！');
	} catch (err) {
		hideLoading();
		alert(`❌ 导出失败：${err.message}`);
	}
}

// 递归渲染目录树
function renderTree(path) {
	const treeContainer = document.getElementById('dirTree');
	const data = fileDataCache[path];
	if (!data) {
		treeContainer.innerHTML = '<div class="error-tip">路径数据未加载</div>';
		return;
	}

	treeContainer.innerHTML = '';
	const allItems = [
		...data.dirs.map((d) => ({ ...d, type: 'dir' })),
		...data.files.map((f) => ({ ...f, type: 'file' })),
	];

	if (allItems.length === 0) {
		treeContainer.innerHTML =
			'<div class="empty-tip">当前路径无文件和目录</div>';
		return;
	}

	allItems.forEach((item, index) => {
		const wrapper = createTreeNodeWrapper(index === allItems.length - 1);
		const node = createTreeNode(item, path);
		wrapper.appendChild(node);

		if (item.type === 'dir') {
			const childrenContainer = document.createElement('div');
			childrenContainer.className = 'tree-children';
			childrenContainer.dataset.path = item.path;
			wrapper.appendChild(childrenContainer);

			const toggleIcon = node.querySelector('.toggle-icon');
			toggleIcon.addEventListener('click', async (e) => {
				e.stopPropagation();
				const isShow = childrenContainer.classList.toggle('show');
				toggleIcon.textContent = isShow ? '−' : '+';

				if (isShow && !childrenContainer.innerHTML) {
					try {
						const childRes = await fetch(`${baseUrl}/getFiles`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ targetPath: item.path }),
						});
						const childData = await childRes.json();

						if (childData.code === 0) {
							const filteredChildDirs =
								childData.data.dirs.filter(
									(dir) => !isHiddenFile(dir.name)
								);
							const filteredChildFiles =
								childData.data.files.filter(
									(file) => !isHiddenFile(file.name)
								);

							fileDataCache[item.path] = {
								dirs: filteredChildDirs,
								files: filteredChildFiles,
								items: [
									...filteredChildDirs.map((d) => ({
										...d,
										type: 'dir',
									})),
									...filteredChildFiles.map((f) => ({
										...f,
										type: 'file',
									})),
								],
							};

							const childItems = [
								...filteredChildDirs.map((d) => ({
									...d,
									type: 'dir',
								})),
								...filteredChildFiles.map((f) => ({
									...f,
									type: 'file',
								})),
							];

							if (childItems.length === 0) {
								childrenContainer.innerHTML =
									'<div class="empty-tip" style="padding-left: 10px; font-size: 12px;">无下级文件和目录</div>';
								return;
							}

							childItems.forEach((childItem, childIndex) => {
								const childWrapper = createTreeNodeWrapper(
									childIndex === childItems.length - 1
								);
								const childNode = createTreeNode(
									childItem,
									item.path
								);
								childWrapper.appendChild(childNode);

								if (childItem.type === 'dir') {
									const grandChildContainer =
										document.createElement('div');
									grandChildContainer.className =
										'tree-children';
									grandChildContainer.dataset.path =
										childItem.path;
									childWrapper.appendChild(
										grandChildContainer
									);

									const childToggle =
										childNode.querySelector('.toggle-icon');
									childToggle.addEventListener(
										'click',
										async (e) => {
											e.stopPropagation();
											const isGrandShow =
												grandChildContainer.classList.toggle(
													'show'
												);
											childToggle.textContent =
												isGrandShow ? '−' : '+';

											if (
												isGrandShow &&
												!grandChildContainer.innerHTML
											) {
												try {
													const grandRes =
														await fetch(
															`${baseUrl}/getFiles`,
															{
																method: 'POST',
																headers: {
																	'Content-Type':
																		'application/json',
																},
																body: JSON.stringify(
																	{
																		targetPath:
																			childItem.path,
																	}
																),
															}
														);
													const grandData =
														await grandRes.json();

													if (grandData.code === 0) {
														const filteredGrandDirs =
															grandData.data.dirs.filter(
																(dir) =>
																	!isHiddenFile(
																		dir.name
																	)
															);
														const filteredGrandFiles =
															grandData.data.files.filter(
																(file) =>
																	!isHiddenFile(
																		file.name
																	)
															);

														fileDataCache[
															childItem.path
														] = {
															dirs: filteredGrandDirs,
															files: filteredGrandFiles,
															items: [
																...filteredGrandDirs.map(
																	(d) => ({
																		...d,
																		type: 'dir',
																	})
																),
																...filteredGrandFiles.map(
																	(f) => ({
																		...f,
																		type: 'file',
																	})
																),
															],
														};

														const grandItems = [
															...filteredGrandDirs.map(
																(d) => ({
																	...d,
																	type: 'dir',
																})
															),
															...filteredGrandFiles.map(
																(f) => ({
																	...f,
																	type: 'file',
																})
															),
														];

														if (
															grandItems.length ===
															0
														) {
															grandChildContainer.innerHTML =
																'<div class="empty-tip" style="padding-left: 10px; font-size: 12px;">无下级文件和目录</div>';
															return;
														}

														grandItems.forEach(
															(
																grandItem,
																grandIndex
															) => {
																const grandWrapper =
																	createTreeNodeWrapper(
																		grandIndex ===
																			grandItems.length -
																				1
																	);
																const grandNode =
																	createTreeNode(
																		grandItem,
																		childItem.path
																	);
																grandWrapper.appendChild(
																	grandNode
																);
																grandChildContainer.appendChild(
																	grandWrapper
																);
															}
														);
													}
												} catch (err) {
													grandChildContainer.innerHTML = `<div class="error-tip" style="padding-left: 10px; font-size: 12px;">加载失败：${err.message}</div>`;
												}
											}
										}
									);
								}

								childrenContainer.appendChild(childWrapper);
							});
						}
					} catch (err) {
						childrenContainer.innerHTML = `<div class="error-tip" style="padding-left: 10px; font-size: 12px;">加载失败：${err.message}</div>`;
					}
				}
			});
		}

		treeContainer.appendChild(wrapper);
	});
}

// 创建目录树节点包装器
function createTreeNodeWrapper(isLast) {
	const wrapper = document.createElement('div');
	wrapper.className = 'tree-node-wrapper';
	if (isLast) wrapper.classList.add('last-node');
	return wrapper;
}

// 创建目录/文件节点
function createTreeNode(item, parentPath) {
	const node = document.createElement('div');
	node.className = `tree-node ${item.type}`;
	// 为快捷方式添加专属类名
	if (item.type === 'file' && pathUtils.isShortcut(item.name)) {
		node.classList.add('shortcut-file');
	}
	node.dataset.path = item.path;
	node.dataset.type = item.type;
	node.dataset.name = item.name;

	const icon =
		item.type === 'dir'
			? '<i class="node-icon fas fa-folder"></i>'
			: getFileIcon(item.name);
	const toggleIcon =
		item.type === 'dir'
			? '<span class="toggle-icon">+</span>'
			: '<span class="toggle-icon"></span>';

	node.innerHTML = `
		${toggleIcon}
		${icon}
		<span class="node-name">${item.name}</span>
	`;

	// 单击选中
	node.addEventListener('click', (e) => {
		if (e.ctrlKey) {
			toggleSelection(item, node);
		} else {
			clearAllSelections();
			node.classList.add('active');
			syncSelectionToRight(item.path);
		}
	});

	// 双击打开
	node.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		handleItemOpen(item);
	});

	// 右键菜单
	node.addEventListener('contextmenu', (e) => {
		e.preventDefault();
		currentContextItem = item;
		showContextMenu(e.clientX, e.clientY, false);
	});

	return node;
}

// 同步选中状态到右侧面板
function syncSelectionToRight(path) {
	// 清除右侧原有选中
	document
		.querySelectorAll(
			'.file-item-card.selected, .file-list-list tr.selected'
		)
		.forEach((el) => {
			el.classList.remove('selected');
		});

	// 选中右侧对应项
	const targetItem = document.querySelector(`[data-path="${path}"]`);
	if (targetItem) {
		targetItem.classList.add('selected');
		// 更新选中数组
		selectedItems = [
			{
				path: path,
				type: targetItem.dataset.type,
				name: targetItem.dataset.name,
			},
		];
		updateBatchActions();
	}
}

// 处理多选
function toggleSelection(item, element) {
	const index = selectedItems.findIndex((i) => i.path === item.path);
	if (index > -1) {
		selectedItems.splice(index, 1);
		element.classList.remove('selected', 'active');
	} else {
		selectedItems.push(item);
		element.classList.add('selected', 'active');
	}
	updateBatchActions();
}

// 清除所有选中状态
function clearAllSelections() {
	document
		.querySelectorAll(
			'.file-item-card.selected, .file-list-list tr.selected, .tree-node.active, .tree-node.selected'
		)
		.forEach((el) => {
			el.classList.remove('selected', 'active');
		});
	selectedItems = [];
	updateBatchActions();
}

// 更新批量操作按钮状态
function updateBatchActions() {
	const batchActions = document.getElementById('batchActions');
	const countElement = document.querySelector('.batch-count strong');

	if (countElement) {
		countElement.textContent = selectedItems.length;
	}

	if (batchActions) {
		batchActions.style.display = selectedItems.length > 0 ? 'flex' : 'none';
	}
}

// 过滤并渲染文件列表
function filterAndRenderFiles() {
	if (!currentPath || !fileDataCache[currentPath]) return;

	let items = [...fileDataCache[currentPath].items];
	// 搜索过滤
	if (searchKeyword) {
		items = items.filter((item) =>
			item.name.toLowerCase().includes(searchKeyword)
		);
	}
	// 排序处理
	items = sortFiles(items, sortConfig.field, sortConfig.direction);

	// 空数据处理
	if (items.length === 0) {
		const tip = searchKeyword
			? '<div class="search-empty-tip">🔍 未找到匹配的文件/目录</div>'
			: '<div class="empty-tip">📁 当前路径无文件和目录</div>';
		document.getElementById('fileDisplayArea').innerHTML = tip;
		// 绑定空白处右键事件
		document
			.getElementById('fileDisplayArea')
			.addEventListener('contextmenu', handleBlankContextMenu);
		return;
	}

	// 渲染文件列表
	renderFiles(items);
}

// 文件排序
function sortFiles(items, field, direction) {
	if (!field || !direction) return items;

	const sorted = [...items];
	switch (field) {
		case 'name':
			sorted.sort((a, b) =>
				direction === 'asc'
					? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
					: b.name.toLowerCase().localeCompare(a.name.toLowerCase())
			);
			break;
		case 'size':
			sorted.sort((a, b) => {
				const sizeA = a.type === 'dir' ? 0 : a.size;
				const sizeB = b.type === 'dir' ? 0 : b.size;
				return direction === 'asc' ? sizeA - sizeB : sizeB - sizeA;
			});
			break;
		case 'mtime':
			sorted.sort((a, b) => {
				const timeA = new Date(a.mtime).getTime();
				const timeB = new Date(b.mtime).getTime();
				return direction === 'asc' ? timeA - timeB : timeB - timeA;
			});
			break;
		case 'type':
			sorted.sort((a, b) => {
				if (a.type !== b.type) {
					return direction === 'asc'
						? a.type === 'dir'
							? -1
							: 1
						: a.type === 'dir'
						? 1
						: -1;
				}
				// 排序时优先区分快捷方式
				if (
					pathUtils.isShortcut(a.name) &&
					!pathUtils.isShortcut(b.name)
				) {
					return direction === 'asc' ? -1 : 1;
				}
				if (
					!pathUtils.isShortcut(a.name) &&
					pathUtils.isShortcut(b.name)
				) {
					return direction === 'asc' ? 1 : -1;
				}
				return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
			});
			break;
	}
	return sorted;
}

// 切换排序状态
function toggleSort(field) {
	document.querySelectorAll('.file-list-list th').forEach((th) => {
		if (th.dataset.field !== field) {
			th.classList.remove('active');
			th.querySelector('.sort-arrow').textContent = '';
		}
	});

	const th = document.querySelector(`th[data-field="${field}"]`);
	const arrow = th.querySelector('.sort-arrow');

	if (sortConfig.field !== field) {
		sortConfig.field = field;
		sortConfig.direction = 'asc';
		th.classList.add('active');
		arrow.textContent = '↑';
	} else if (sortConfig.direction === 'asc') {
		sortConfig.direction = 'desc';
		arrow.textContent = '↓';
	} else {
		sortConfig.field = '';
		sortConfig.direction = '';
		th.classList.remove('active');
		arrow.textContent = '';
	}

	filterAndRenderFiles();
}

// 渲染右侧文件列表
function renderFiles(items) {
	const displayArea = document.getElementById('fileDisplayArea');
	// 移除旧的空白处右键事件，避免重复绑定
	displayArea.removeEventListener('contextmenu', handleBlankContextMenu);
	// 重新绑定空白处右键事件
	displayArea.addEventListener('contextmenu', handleBlankContextMenu);

	if (currentViewMode === 'card') {
		// 卡片视图
		let html = '<div class="file-list-card">';
		items.forEach((item) => {
			const isShortcut =
				item.type === 'file' && pathUtils.isShortcut(item.name);
			const icon =
				item.type === 'dir'
					? '<i class="item-icon dir fas fa-folder"></i>'
					: getFileIcon(item.name, 'item-icon');
			// 为快捷方式添加专属类名
			const shortcutClass = isShortcut ? ' shortcut-file' : '';
			html += `
				<div class="file-item-card ${item.type}${shortcutClass}" data-path="${
				item.path
			}" data-type="${item.type}" data-name="${item.name}">
					${icon}
					<div class="item-name">${item.name}</div>
					${isShortcut ? '<div class="shortcut-tag">快捷方式</div>' : ''}
				</div>
			`;
		});
		html += '</div>';
		displayArea.innerHTML = html;

		// 绑定卡片事件
		document.querySelectorAll('.file-item-card').forEach((card) => {
			const item = {
				path: card.dataset.path,
				type: card.dataset.type,
				name: card.dataset.name,
			};

			// 单击选中
			card.addEventListener('click', (e) => {
				if (e.ctrlKey) {
					toggleSelection(item, card);
				} else {
					clearAllSelections();
					card.classList.add('selected');
					syncSelectionToLeft(item.path);
				}
			});

			// 双击打开
			card.addEventListener('dblclick', () => {
				handleItemOpen(item);
			});

			// 右键菜单
			card.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				currentContextItem = item;
				showContextMenu(e.clientX, e.clientY, false);
			});
		});
	} else {
		// 列表视图
		let html = `
			<table class="file-list-list">
				<thead>
					<tr>
						<th data-field="type">类型 <span class="sort-arrow"></span></th>
						<th data-field="name">名称 <span class="sort-arrow"></span></th>
						<th data-field="size">大小 <span class="sort-arrow"></span></th>
						<th data-field="mtime">修改时间 <span class="sort-arrow"></span></th>
					</tr>
				</thead>
				<tbody>
		`;
		items.forEach((item) => {
			const isShortcut =
				item.type === 'file' && pathUtils.isShortcut(item.name);
			const icon =
				item.type === 'dir'
					? '<i class="list-item-icon dir fas fa-folder"></i>'
					: getFileIcon(item.name, 'list-item-icon');
			const fileSize =
				item.type === 'dir' ? '-' : formatFileSize(item.size);
			// 为快捷方式添加专属类名
			const shortcutClass = isShortcut ? ' shortcut-file' : '';
			html += `
				<tr class="${item.type}${shortcutClass}" data-path="${item.path}" data-type="${
				item.type
			}" data-name="${item.name}">
					<td>${icon}</td>
					<td>${item.name} ${
				isShortcut
					? '<span class="shortcut-tag">（快捷方式）</span>'
					: ''
			}</td>
					<td class="file-size">${fileSize}</td>
					<td class="file-mtime">${item.mtime}</td>
				</tr>
			`;
		});
		html += `
				</tbody>
			</table>
		`;
		displayArea.innerHTML = html;

		// 绑定列表事件
		document.querySelectorAll('.file-list-list tr').forEach((row) => {
			if (!row.dataset.path) return;

			const item = {
				path: row.dataset.path,
				type: row.dataset.type,
				name: row.dataset.name,
			};

			// 单击选中
			row.addEventListener('click', (e) => {
				if (e.ctrlKey) {
					toggleSelection(item, row);
				} else {
					clearAllSelections();
					row.classList.add('selected');
					syncSelectionToLeft(item.path);
				}
			});

			// 双击打开
			row.addEventListener('dblclick', () => {
				handleItemOpen(item);
			});

			// 右键菜单
			row.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				currentContextItem = item;
				showContextMenu(e.clientX, e.clientY, false);
			});
		});

		// 绑定排序事件
		document.querySelectorAll('.file-list-list th').forEach((th) => {
			if (th.dataset.field) {
				th.addEventListener('click', () =>
					toggleSort(th.dataset.field)
				);
			}
		});
	}
}

// 同步选中状态到左侧目录树
function syncSelectionToLeft(path) {
	// 清除左侧原有选中
	document
		.querySelectorAll('.tree-node.active, .tree-node.selected')
		.forEach((el) => {
			el.classList.remove('active', 'selected');
		});

	// 选中左侧对应项
	const targetNode = document.querySelector(
		`.tree-node[data-path="${path}"]`
	);
	if (targetNode) {
		targetNode.classList.add('active');
	}
}

// 根据文件名获取对应图标（Font Awesome）
function getFileIcon(fileName, prefix) {
	// 优先判断是否为快捷方式
	if (pathUtils.isShortcut(fileName)) {
		const classPrefix = prefix ? `${prefix} file ` : 'node-icon file ';
		return `<i class="${classPrefix}shortcut fas fa-external-link-alt"></i>`;
	}

	const ext = fileName.split('.').pop().toLowerCase();
	const classPrefix = prefix ? `${prefix} file ` : 'node-icon file ';

	switch (ext) {
		case 'txt':
			return `<i class="${classPrefix}txt fas fa-file-alt"></i>`;
		case 'doc':
		case 'docx':
			return `<i class="${classPrefix}doc fas fa-file-word"></i>`;
		case 'xls':
		case 'xlsx':
			return `<i class="${classPrefix}xls fas fa-file-excel"></i>`;
		case 'ppt':
		case 'pptx':
			return `<i class="${classPrefix}ppt fas fa-file-powerpoint"></i>`;
		case 'pdf':
			return `<i class="${classPrefix}pdf fas fa-file-pdf"></i>`;
		case 'png':
		case 'jpg':
		case 'jpeg':
		case 'gif':
		case 'bmp':
		case 'svg':
			return `<i class="${classPrefix}img fas fa-file-image"></i>`;
		case 'mp4':
		case 'avi':
		case 'mov':
		case 'wmv':
		case 'flv':
			return `<i class="${classPrefix}video fas fa-file-video"></i>`;
		case 'mp3':
		case 'wav':
		case 'flac':
		case 'aac':
		case 'ogg':
			return `<i class="${classPrefix}audio fas fa-file-audio"></i>`;
		case 'zip':
		case 'rar':
		case '7z':
		case 'tar':
		case 'gz':
			return `<i class="${classPrefix}archive fas fa-file-archive"></i>`;
		case 'js':
		case 'ts':
		case 'jsx':
		case 'tsx':
			return `<i class="${classPrefix}code fas fa-file-code"></i>`;
		case 'html':
		case 'htm':
			return `<i class="${classPrefix}html fas fa-file-code"></i>`;
		case 'css':
			return `<i class="${classPrefix}css fas fa-file-code"></i>`;
		case 'exe':
			return `<i class="${classPrefix}exe fas fa-cogs"></i>`;
		default:
			return `<i class="${classPrefix}default fas fa-file"></i>`;
	}
}

// 格式化文件大小
function formatFileSize(bytes) {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 返回上级目录
function goBack() {
	if (currentPath !== parentPath) {
		document.getElementById('pathInput').value = parentPath;
		loadPathData();
	}
}

// 解析快捷方式目标路径（调用后端接口）
async function resolveShortcutPath(shortcutPath) {
	try {
		const res = await fetch(`${baseUrl}/resolveShortcut`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ shortcutPath: shortcutPath }),
		});
		const data = await res.json();
		if (data.code === 0) {
			return data.data.targetPath;
		} else {
			alert(`❌ 解析快捷方式失败：${data.msg}`);
			return null;
		}
	} catch (err) {
		alert(`❌ 解析快捷方式失败：${err.message}`);
		return null;
	}
}

// 打开文件/目录（增强：支持快捷方式）
// 优化：解析快捷方式目标路径（仅处理文件夹快捷方式）
async function resolveShortcutPath(shortcutPath) {
	try {
		const res = await fetch(`${baseUrl}/resolveShortcut`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ shortcutPath: shortcutPath }),
		});
		const data = await res.json();
		if (data.code === 0) {
			return data.data.targetPath;
		} else {
			// 只提示错误，不阻断后续操作
			console.log(`解析快捷方式失败：${data.msg}`);
			// 非文件夹快捷方式，返回null，前端按普通文件处理
			return null;
		}
	} catch (err) {
		console.log(`解析快捷方式失败：${err.message}`);
		return null;
	}
}

// 优化：打开文件/目录（仅处理文件夹快捷方式）
async function handleItemOpen(item) {
	// 判断是否为.lnk文件（快捷方式）
	if (item.type === 'file' && pathUtils.isShortcut(item.name)) {
		showLoading('解析快捷方式中...');
		// 解析快捷方式目标路径
		const targetPath = await resolveShortcutPath(item.path);
		hideLoading();

		if (targetPath) {
			// 是文件夹快捷方式，打开目标文件夹
			document.getElementById('pathInput').value = targetPath;
			loadPathData();
		} else {
			// 不是文件夹快捷方式，按普通文件打开
			openFile(item.path);
		}
	} else if (item.type === 'dir') {
		// 普通文件夹直接打开
		document.getElementById('pathInput').value = item.path;
		loadPathData();
	} else {
		// 普通文件调用系统打开
		openFile(item.path);
	}
}

// 打开文件（调用后端接口）
async function openFile(path) {
	try {
		const res = await fetch(`${baseUrl}/openFile`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetPath: path }),
		});
		const data = await res.json();
		if (data.code !== 0) alert(data.msg);
	} catch (err) {
		alert(`❌ 打开文件失败：${err.message}`);
	}
}

// 显示错误信息
function showError(msg) {
	document.getElementById(
		'fileDisplayArea'
	).innerHTML = `<div class="error-tip">❌ ${msg}</div>`;
	document.getElementById(
		'dirTree'
	).innerHTML = `<div class="error-tip">❌ ${msg}</div>`;
	document.getElementById('pathBar').textContent = '📁 当前路径：加载失败';
}

// 显示右键菜单
function showContextMenu(x, y, isBlank) {
	// 菜单显示逻辑控制
	if (!isBlank) {
		// 点击文件/目录：显示操作菜单，隐藏新建菜单
		document.getElementById('menuOpen').style.display = 'flex';
		document.getElementById('menuRename').style.display = 'flex';
		document.getElementById('menuDelete').style.display = 'flex';
		document.getElementById('menuNewFolder').style.display = 'none';
		document.getElementById('menuNewFile').style.display = 'none';
		document.getElementById('menuCopy').style.display = 'flex';
		document.getElementById('menuCut').style.display = 'flex';
		document.getElementById('menuPaste').style.display = clipboard
			? 'flex'
			: 'none';

		// 如果是快捷方式，修改"打开"菜单文本
		if (
			currentContextItem &&
			pathUtils.isShortcut(currentContextItem.name)
		) {
			document.getElementById('menuOpen').textContent = '打开目标文件夹';
		} else {
			document.getElementById('menuOpen').textContent = '打开';
		}
	} else {
		// 点击空白处：隐藏操作菜单，显示新建菜单
		document.getElementById('menuOpen').style.display = 'none';
		document.getElementById('menuRename').style.display = 'none';
		document.getElementById('menuDelete').style.display = 'none';
		document.getElementById('menuNewFolder').style.display = 'flex';
		document.getElementById('menuNewFile').style.display = 'flex';
		document.getElementById('menuPaste').style.display = clipboard
			? 'flex'
			: 'none';
		document.getElementById('menuCopy').style.display = 'none';
		document.getElementById('menuCut').style.display = 'none';
	}

	// 处理菜单超出屏幕的情况
	const menu = document.getElementById('contextMenu');
	const windowWidth = window.innerWidth;
	const windowHeight = window.innerHeight;
	const menuWidth = menu.offsetWidth;
	const menuHeight = menu.offsetHeight;

	// 位置修正
	let left = x;
	if (x + menuWidth > windowWidth) left = x - menuWidth;
	let top = y;
	if (y + menuHeight > windowHeight) top = y - menuHeight;

	// 显示菜单
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;
	menu.style.display = 'block';
}

// 空白处右键事件处理
function handleBlankContextMenu(e) {
	e.preventDefault();
	currentContextItem = null;
	showContextMenu(e.clientX, e.clientY, true);
}

// ===================== 右键菜单功能 =====================

// 菜单-打开（增强：支持快捷方式）
async function handleMenuOpen() {
	if (currentContextItem) {
		await handleItemOpen(currentContextItem);
		contextMenu.style.display = 'none';
	}
}

// 菜单-重命名
async function handleMenuRename() {
	if (!currentContextItem) return;

	const newName = prompt('请输入新名称：', currentContextItem.name);
	if (!newName || newName === currentContextItem.name) return;
	if (newName.startsWith('~$')) {
		alert('❌ 不能创建以~$开头的文件/目录！');
		return;
	}

	try {
		// 构造新路径
		const dirPath = pathUtils.dirname(currentContextItem.path);
		const newFilePath = pathUtils.join(dirPath, newName);

		// 发送重命名请求
		const res = await fetch(`${baseUrl}/rename`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				oldPath: currentContextItem.path,
				newPath: newFilePath,
			}),
		});
		const data = await res.json();

		if (data.code === 0) {
			alert('✅ 重命名成功');
			loadPathData(); // 刷新当前目录
		} else {
			alert(`❌ 重命名失败：${data.msg}`);
		}
	} catch (err) {
		alert(`❌ 重命名失败：${err.message}`);
	}

	contextMenu.style.display = 'none';
}

// 菜单-删除
async function handleMenuDelete() {
	if (!currentContextItem) return;

	if (confirm(`⚠️ 确定要删除 ${currentContextItem.name} 吗？`)) {
		try {
			const res = await fetch(`${baseUrl}/delete`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetPath: currentContextItem.path }),
			});
			const data = await res.json();

			if (data.code === 0) {
				alert('✅ 删除成功');
				loadPathData(); // 刷新当前目录
			} else {
				alert(`❌ 删除失败：${data.msg}`);
			}
		} catch (err) {
			alert(`❌ 删除失败：${err.message}`);
		}
	}
	contextMenu.style.display = 'none';
}

// 菜单-新建文件夹
async function handleMenuNewFolder() {
	const folderName = prompt('请输入新文件夹名称：', '新建文件夹');
	if (!folderName) return;
	if (folderName.startsWith('~$')) {
		alert('❌ 不能创建以~$开头的文件夹！');
		return;
	}

	showLoading('创建文件夹中...');
	try {
		const newFolderPath = pathUtils.join(currentPath, folderName);
		const res = await fetch(`${baseUrl}/newFolder`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetPath: newFolderPath }),
		});
		const data = await res.json();

		if (data.code === 0) {
			alert('✅ 文件夹创建成功');
			loadPathData(); // 刷新当前目录
		} else {
			alert(`❌ 创建失败：${data.msg}`);
		}
	} catch (err) {
		alert(`❌ 创建失败：${err.message}`);
	} finally {
		hideLoading();
	}
	contextMenu.style.display = 'none';
}

// 菜单-新建文件
async function handleMenuNewFile() {
	const fileName = prompt('请输入新文件名称（含扩展名）：', '新建文件.txt');
	if (!fileName) return;
	if (fileName.startsWith('~$')) {
		alert('❌ 不能创建以~$开头的文件！');
		return;
	}

	showLoading('创建文件中...');
	try {
		const newFilePath = pathUtils.join(currentPath, fileName);
		const res = await fetch(`${baseUrl}/newFile`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetPath: newFilePath }),
		});
		const data = await res.json();

		if (data.code === 0) {
			alert('✅ 文件创建成功');
			loadPathData(); // 刷新当前目录
		} else {
			alert(`❌ 创建失败：${data.msg}`);
		}
	} catch (err) {
		alert(`❌ 创建失败：${err.message}`);
	} finally {
		hideLoading();
	}
	contextMenu.style.display = 'none';
}

// 菜单-复制
function handleMenuCopy() {
	if (!currentContextItem) return;
	clipboard = currentContextItem;
	clipboardAction = 'copy';
	showClipboardTip(`📋 已复制：${currentContextItem.name}`);
	contextMenu.style.display = 'none';
}

// 菜单-剪切
function handleMenuCut() {
	if (!currentContextItem) return;
	clipboard = currentContextItem;
	clipboardAction = 'cut';
	showClipboardTip(`✂️ 已剪切：${currentContextItem.name}`);
	contextMenu.style.display = 'none';
}

// 菜单-粘贴
async function handleMenuPaste() {
	if (!clipboard) return;

	const targetPath = pathUtils.join(
		currentPath,
		Array.isArray(clipboard)
			? pathUtils.basename(clipboard[0].path)
			: pathUtils.basename(clipboard.path)
	);

	showLoading(clipboardAction === 'copy' ? '📋 复制中...' : '✂️ 移动中...');
	try {
		let apiEndpoint;
		let requestBody;

		if (Array.isArray(clipboard)) {
			// 批量操作
			requestBody = {
				sourcePaths: clipboard.map((item) => item.path),
				targetPath: targetPath,
			};
			apiEndpoint =
				clipboardAction === 'copy'
					? `${baseUrl}/copyBatch`
					: `${baseUrl}/cutBatch`;
		} else {
			// 单个操作
			requestBody = {
				sourcePath: clipboard.path,
				targetPath: targetPath,
			};
			apiEndpoint =
				clipboardAction === 'copy'
					? `${baseUrl}/copy`
					: `${baseUrl}/cut`;
		}

		const res = await fetch(apiEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(requestBody),
		});

		const data = await res.json();

		if (data.code === 0) {
			alert(clipboardAction === 'copy' ? '✅ 复制成功' : '✅ 移动成功');
			loadPathData(); // 刷新当前目录
			// 剪切后清空剪贴板
			if (clipboardAction === 'cut') {
				clipboard = null;
				clipboardAction = null;
			}
		} else {
			alert(
				`❌ ${clipboardAction === 'copy' ? '复制' : '移动'}失败：${
					data.msg
				}`
			);
		}
	} catch (err) {
		alert(
			`❌ ${clipboardAction === 'copy' ? '复制' : '移动'}失败：${
				err.message
			}`
		);
	} finally {
		hideLoading();
	}
	contextMenu.style.display = 'none';
}

// ===================== 批量操作功能 =====================

// 批量删除
async function batchDelete() {
	if (selectedItems.length === 0) return;
	if (!confirm(`⚠️ 确定要删除选中的 ${selectedItems.length} 项吗？`)) return;

	showLoading('🗑️ 批量删除中...');
	try {
		const res = await fetch(`${baseUrl}/batchDelete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				paths: selectedItems.map((item) => item.path),
			}),
		});
		const data = await res.json();

		if (data.code === 0) {
			alert('✅ 批量删除成功');
			loadPathData(); // 刷新当前目录
			clearAllSelections(); // 清空选中状态
		} else {
			alert(`❌ 批量删除失败：${data.msg}`);
		}
	} catch (err) {
		alert(`❌ 批量删除失败：${err.message}`);
	} finally {
		hideLoading();
	}
}

// 批量复制
function batchCopy() {
	if (selectedItems.length === 0) return;
	clipboard = selectedItems;
	clipboardAction = 'copy';
	showClipboardTip(`📋 已复制 ${selectedItems.length} 项`);
}

// 批量剪切
function batchCut() {
	if (selectedItems.length === 0) return;
	clipboard = selectedItems;
	clipboardAction = 'cut';
	showClipboardTip(`✂️ 已剪切 ${selectedItems.length} 项`);
}

// ===================== 辅助功能 =====================

// 显示剪贴板提示
function showClipboardTip(message) {
	const tip = document.getElementById('clipboardTip');
	if (!tip) return;

	tip.textContent = message;
	tip.style.display = 'block';
	setTimeout(() => {
		tip.style.display = 'none';
	}, 3000);
}

// 初始化剪贴板提示
function initClipboardTip() {
	const tip = document.getElementById('clipboardTip');
	if (tip) tip.style.display = 'none';
}

// 初始化拖拽上传
function initDragUpload() {
	const contentArea = document.querySelector('.content');
	if (!contentArea) return;

	contentArea.addEventListener('dragover', (e) => {
		e.preventDefault();
		contentArea.classList.add('dragover');
	});

	contentArea.addEventListener('dragleave', () => {
		contentArea.classList.remove('dragover');
	});

	contentArea.addEventListener('drop', async (e) => {
		e.preventDefault();
		contentArea.classList.remove('dragover');
		if (!e.dataTransfer.files.length) return;

		showLoading('📤 上传中...');
		const formData = new FormData();
		for (let file of e.dataTransfer.files) {
			formData.append('files', file);
		}
		formData.append('targetPath', currentPath);

		try {
			const res = await fetch(`${baseUrl}/upload`, {
				method: 'POST',
				body: formData,
			});
			const data = await res.json();

			if (data.code === 0) {
				alert(`✅ 成功上传 ${data.data.count} 个文件`);
				loadPathData(); // 刷新当前目录
			} else {
				alert(`❌ 上传失败：${data.msg}`);
			}
		} catch (err) {
			alert(`❌ 上传失败：${err.message}`);
		} finally {
			hideLoading();
		}
	});
}

// 初始化响应式侧边栏
function initResponsiveSidebar() {
	const toggleBtn = document.getElementById('sidebarToggle');
	const sidebar = document.getElementById('sidebar');
	if (!toggleBtn || !sidebar) return;

	toggleBtn.addEventListener('click', () => {
		sidebar.style.width = sidebar.style.width === '320px' ? '0' : '320px';
	});
}
