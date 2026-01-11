const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsExtra = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const PORT = 3001;

/* ================= 基础配置 ================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ================= 统一返回 ================= */
const ok = (res, data = null, msg = 'success') =>
	res.json({ code: 0, msg, data });

const fail = (res, msg) => res.json({ code: -1, msg });

/* ================= 通用工具 ================= */
const exists = async (p) => {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
};

const isHiddenFile = (name) => {
	const rules = [
		/^~/,
		/^\./,
		/^desktop\.ini$/,
		/^Thumbs\.db$/,
		/^\.DS_Store$/,
		/^\$RECYCLE\.BIN$/,
		/^System Volume Information$/,
	];
	return rules.some((r) => r.test(name));
};

// 判断是否为快捷方式文件
const isShortcutFile = (fileName) => {
	return fileName.toLowerCase().endsWith('.lnk');
};

// 重构：增强版二进制解析.lnk文件（纯JS实现，不依赖PowerShell）
const parseLnkFileEnhanced = async (lnkPath) => {
	try {
		const buffer = await fs.readFile(lnkPath);
		const uint8Buffer = new Uint8Array(buffer);

		// 1. 验证是否为有效的LNK文件
		if (uint8Buffer.length < 76 || uint8Buffer[0] !== 0x4c) {
			throw new Error('不是有效的LNK文件');
		}

		// 2. 查找标志位（根据MS-SHLLINK规范）
		// LinkFlags (0x14): bit 0 indicates if the shell link has a target ID list
		const linkFlags =
			uint8Buffer[0x14] |
			(uint8Buffer[0x15] << 8) |
			(uint8Buffer[0x16] << 16) |
			(uint8Buffer[0x17] << 24);
		const hasLinkTargetIDList = (linkFlags & 0x01) !== 0;

		// 3. 查找LocalBasePath（目标路径）
		let targetPath = '';
		let offset = 0x4c; // 默认偏移

		// 如果有ID列表，跳过ID列表部分
		if (hasLinkTargetIDList) {
			const idListOffset = 0x4c;
			const idListSize =
				uint8Buffer[idListOffset] |
				(uint8Buffer[idListOffset + 1] << 8);
			offset += idListSize;
		}

		// 4. 从多个可能的偏移位置查找路径
		const possibleOffsets = [offset, 0x11c, 0x124, 0x30, 0x80, 0x100];

		for (const pos of possibleOffsets) {
			if (pos + 100 > uint8Buffer.length) continue;

			// 读取UTF-16编码的路径
			let pathBuffer = [];
			for (let i = pos; i < pos + 500; i += 2) {
				const charCode = uint8Buffer[i] | (uint8Buffer[i + 1] << 8);
				if (charCode === 0) break;
				pathBuffer.push(String.fromCharCode(charCode));
			}

			const tempPath = pathBuffer
				.join('')
				.replace(/[\x00-\x1F\x7F]/g, '')
				.trim();

			// 验证是否为有效的Windows路径
			if (tempPath && tempPath.match(/^[A-Za-z]:\\/)) {
				targetPath = tempPath;
				break;
			}
		}

		// 5. 备用解析：查找所有包含盘符的路径
		if (!targetPath) {
			const allChars = [];
			for (let i = 0; i < uint8Buffer.length; i += 2) {
				const charCode = uint8Buffer[i] | (uint8Buffer[i + 1] << 8);
				if (charCode > 0x20 && charCode < 0x7f) {
					allChars.push(String.fromCharCode(charCode));
				}
			}

			const allText = allChars.join('');
			const pathMatch = allText.match(/[A-Za-z]:\\[^*?"<>|]{1,200}/);
			if (pathMatch) {
				targetPath = pathMatch[0];
			}
		}

		// 6. 清理路径
		targetPath = targetPath
			.replace(/\/+/g, '\\') // 替换Linux路径分隔符
			.replace(/\\\\+/g, '\\') // 合并多个反斜杠
			.trim();

		// 7. 验证路径
		if (!targetPath || !targetPath.match(/^[A-Za-z]:\\/)) {
			throw new Error('未找到有效的目标路径');
		}

		return targetPath;
	} catch (err) {
		console.error('二进制解析失败:', err.message);
		throw err;
	}
};

/* ================= 文件服务 ================= */
const fileService = {
	async list(dir) {
		const items = await fs.readdir(dir, { withFileTypes: true });
		const dirs = [];
		const files = [];

		for (const item of items) {
			if (isHiddenFile(item.name)) continue;

			const fullPath = path.join(dir, item.name);
			const stat = await fs.stat(fullPath);
			const base = {
				name: item.name,
				path: fullPath,
				mtime: stat.mtime.toLocaleString(),
			};

			item.isDirectory()
				? dirs.push(base)
				: files.push({ ...base, size: stat.size });
		}

		dirs.sort((a, b) => a.name.localeCompare(b.name));
		files.sort((a, b) => a.name.localeCompare(b.name));

		return {
			currentPath: dir,
			parentPath: path.dirname(dir),
			dirs,
			files,
		};
	},

	async getCopyPath(targetPath) {
		const dir = path.dirname(targetPath);
		const ext = path.extname(targetPath);
		const name = path.basename(targetPath, ext);

		let index = 0;
		let newPath;
		do {
			newPath = path.join(dir, `${name}(副本${index || ''})${ext}`);
			index++;
		} while (await exists(newPath));

		return newPath;
	},

	async copy(source, target) {
		if (source === target) {
			target = await this.getCopyPath(target);
		}
		await fsExtra.copy(source, target);
		return target;
	},

	// 重构：解析快捷方式（纯JS实现，无PowerShell依赖）
	async resolveShortcut(shortcutPath) {
		try {
			// 1. 基础校验
			if (!(await exists(shortcutPath))) {
				throw new Error('快捷方式文件不存在');
			}

			if (!isShortcutFile(path.basename(shortcutPath))) {
				throw new Error('不是有效的快捷方式文件(.lnk)');
			}

			// 2. 使用增强版二进制解析
			let targetPath = await parseLnkFileEnhanced(shortcutPath);

			// 3. 验证目标路径是否存在且为文件夹
			if (!(await exists(targetPath))) {
				// 尝试修复常见的路径问题
				const fixedPath = targetPath
					.replace(/^([A-Za-z]):\\+/, '$1:\\')
					.replace(/\\+$/, '');

				if (await exists(fixedPath)) {
					targetPath = fixedPath;
				} else {
					throw new Error('快捷方式指向的目标路径不存在');
				}
			}

			// 4. 验证是否为文件夹
			const stat = await fs.stat(targetPath);
			if (!stat.isDirectory()) {
				throw new Error('快捷方式指向的不是文件夹');
			}

			return targetPath;
		} catch (err) {
			console.error('解析快捷方式失败:', err.message);
			throw err;
		}
	},

	move: (s, t) => fsExtra.move(s, t),
	remove: (p) => fsExtra.remove(p),
	createFile: (p) => fs.writeFile(p, ''),
	createFolder: (p) => fs.mkdir(p, { recursive: true }),
};

/* ================= 上传 ================= */
const upload = multer({
	storage: multer.diskStorage({
		destination: (req, file, cb) => cb(null, req.body.targetPath),
		filename: (req, file, cb) => cb(null, file.originalname),
	}),
});

/* ================= API ================= */

// 获取文件列表
app.post('/api/getFiles', async (req, res) => {
	const { targetPath } = req.body;
	if (!targetPath || !(await exists(targetPath)))
		return fail(res, '路径不存在');

	ok(res, await fileService.list(targetPath));
});

// 打开文件
app.post('/api/openFile', async (req, res) => {
	const { targetPath } = req.body;
	if (!targetPath || !(await exists(targetPath)))
		return fail(res, '文件不存在');

	const cmd =
		process.platform === 'win32'
			? `start "" "${targetPath}"`
			: `open "${targetPath}"`;

	exec(cmd, (err) => (err ? fail(res, '打开文件失败') : ok(res)));
});

// 解析快捷方式接口
app.post('/api/resolveShortcut', async (req, res) => {
	try {
		const { shortcutPath } = req.body;

		if (!shortcutPath) {
			return fail(res, '缺少参数：shortcutPath');
		}

		const targetPath = await fileService.resolveShortcut(shortcutPath);
		ok(res, { targetPath }, '解析快捷方式成功');
	} catch (err) {
		// 返回友好的错误信息
		const friendlyMsg = {
			不是有效的快捷方式文件: '该文件不是有效的Windows快捷方式(.lnk)',
			不是文件夹: '该快捷方式指向的不是文件夹',
			不存在: '快捷方式指向的目标路径不存在',
			未找到有效的目标路径: '无法解析该快捷方式的目标路径',
		};

		let msg = err.message;
		for (const [key, value] of Object.entries(friendlyMsg)) {
			if (err.message.includes(key)) {
				msg = value;
				break;
			}
		}

		fail(res, msg);
	}
});

// 其他API保持不变...
app.post('/api/rename', async (req, res) => {
	const { oldPath, newPath } = req.body;
	if (!(await exists(oldPath))) return fail(res, '原路径不存在');
	if (await exists(newPath)) return fail(res, '新路径已存在');

	await fs.rename(oldPath, newPath);
	ok(res, null, '重命名成功');
});

app.post('/api/delete', async (req, res) => {
	if (!(await exists(req.body.targetPath))) return fail(res, '路径不存在');

	await fileService.remove(req.body.targetPath);
	ok(res, null, '删除成功');
});

app.post('/api/batchDelete', async (req, res) => {
	for (const p of req.body.paths || []) {
		if (await exists(p)) await fileService.remove(p);
	}
	ok(res, null, '批量删除成功');
});

app.post('/api/newFolder', async (req, res) => {
	if (await exists(req.body.targetPath)) return fail(res, '文件夹已存在');

	await fileService.createFolder(req.body.targetPath);
	ok(res, null, '文件夹创建成功');
});

app.post('/api/newFile', async (req, res) => {
	if (await exists(req.body.targetPath)) return fail(res, '文件已存在');

	await fileService.createFile(req.body.targetPath);
	ok(res, null, '文件创建成功');
});

app.post('/api/copy', async (req, res) => {
	const { sourcePath, targetPath } = req.body;
	if (!(await exists(sourcePath))) return fail(res, '源路径不存在');

	const newPath = await fileService.copy(sourcePath, targetPath);
	ok(res, newPath ? { newPath } : null, '复制成功');
});

app.post('/api/copyBatch', async (req, res) => {
	const { sourcePaths, targetPath } = req.body;
	if (!Array.isArray(sourcePaths)) return fail(res, '参数错误');

	for (const src of sourcePaths) {
		if (!(await exists(src))) return fail(res, `源路径不存在: ${src}`);

		await fileService.copy(src, targetPath);
	}

	ok(res, null, '批量复制成功');
});

app.post('/api/cut', async (req, res) => {
	const { sourcePath, targetPath } = req.body;
	if (!(await exists(sourcePath))) return fail(res, '源路径不存在');

	await fileService.move(sourcePath, targetPath);
	ok(res, null, '移动成功');
});

app.post('/api/cutBatch', async (req, res) => {
	const { sourcePaths, targetPath } = req.body;
	if (!Array.isArray(sourcePaths)) return fail(res, '参数错误');

	for (const src of sourcePaths) {
		if (!(await exists(src))) return fail(res, `源路径不存在: ${src}`);

		await fileService.move(src, path.join(targetPath, path.basename(src)));
	}

	ok(res, null, '批量移动成功');
});

app.post('/api/upload', upload.array('files'), (req, res) => {
	if (!req.files?.length) return fail(res, '请选择要上传的文件');

	ok(res, { count: req.files.length }, '上传成功');
});

app.post('/api/exportExcel', async (req, res) => {
	const { data, fileName } = req.body;
	if (!Array.isArray(data) || !data.length) return fail(res, '无导出数据');

	const wb = XLSX.utils.book_new();
	const ws = XLSX.utils.json_to_sheet(data);
	ws['!cols'] = [
		{ wch: 30 },
		{ wch: 8 },
		{ wch: 12 },
		{ wch: 20 },
		{ wch: 50 },
	];

	XLSX.utils.book_append_sheet(wb, ws, '文件列表');

	const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
	const name = encodeURIComponent(fileName || `文件列表_${Date.now()}`);

	res.setHeader(
		'Content-Type',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	);
	res.setHeader(
		'Content-Disposition',
		`attachment; filename="${name}.xlsx"; filename*=UTF-8''${name}.xlsx`
	);

	res.send(buffer);
});

/* ================= 启动 ================= */
app.listen(PORT, () => {
	console.log(`✅ 前端页面 http://localhost:${PORT}/index.html`);
});
