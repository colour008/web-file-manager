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

// 重命名
app.post('/api/rename', async (req, res) => {
	const { oldPath, newPath } = req.body;
	if (!(await exists(oldPath))) return fail(res, '原路径不存在');
	if (await exists(newPath)) return fail(res, '新路径已存在');

	await fs.rename(oldPath, newPath);
	ok(res, null, '重命名成功');
});

// 删除
app.post('/api/delete', async (req, res) => {
	if (!(await exists(req.body.targetPath))) return fail(res, '路径不存在');

	await fileService.remove(req.body.targetPath);
	ok(res, null, '删除成功');
});

// 批量删除
app.post('/api/batchDelete', async (req, res) => {
	for (const p of req.body.paths || []) {
		if (await exists(p)) await fileService.remove(p);
	}
	ok(res, null, '批量删除成功');
});

// 新建文件夹
app.post('/api/newFolder', async (req, res) => {
	if (await exists(req.body.targetPath)) return fail(res, '文件夹已存在');

	await fileService.createFolder(req.body.targetPath);
	ok(res, null, '文件夹创建成功');
});

// 新建文件
app.post('/api/newFile', async (req, res) => {
	if (await exists(req.body.targetPath)) return fail(res, '文件已存在');

	await fileService.createFile(req.body.targetPath);
	ok(res, null, '文件创建成功');
});

// 复制
app.post('/api/copy', async (req, res) => {
	const { sourcePath, targetPath } = req.body;
	if (!(await exists(sourcePath))) return fail(res, '源路径不存在');

	const newPath = await fileService.copy(sourcePath, targetPath);
	ok(res, newPath ? { newPath } : null, '复制成功');
});

// 批量复制
app.post('/api/copyBatch', async (req, res) => {
	const { sourcePaths, targetPath } = req.body;
	if (!Array.isArray(sourcePaths)) return fail(res, '参数错误');

	for (const src of sourcePaths) {
		if (!(await exists(src))) return fail(res, `源路径不存在: ${src}`);

		await fileService.copy(src, targetPath);
	}

	ok(res, null, '批量复制成功');
});

// 剪切
app.post('/api/cut', async (req, res) => {
	const { sourcePath, targetPath } = req.body;
	if (!(await exists(sourcePath))) return fail(res, '源路径不存在');

	await fileService.move(sourcePath, targetPath);
	ok(res, null, '移动成功');
});

// 批量剪切
app.post('/api/cutBatch', async (req, res) => {
	const { sourcePaths, targetPath } = req.body;
	if (!Array.isArray(sourcePaths)) return fail(res, '参数错误');

	for (const src of sourcePaths) {
		if (!(await exists(src))) return fail(res, `源路径不存在: ${src}`);

		await fileService.move(src, path.join(targetPath, path.basename(src)));
	}

	ok(res, null, '批量移动成功');
});

// 上传
app.post('/api/upload', upload.array('files'), (req, res) => {
	if (!req.files?.length) return fail(res, '请选择要上传的文件');

	ok(res, { count: req.files.length }, '上传成功');
});

// 导出 Excel
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
