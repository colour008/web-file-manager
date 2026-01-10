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

// ========== 新增：配置静态文件服务 ==========
// 告诉Express public文件夹下的文件是静态文件，可以直接访问
app.use(express.static(path.join(__dirname, 'public')));
// ==========================================

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 配置multer用于文件上传
const upload = multer({
	storage: multer.diskStorage({
		destination: (req, file, cb) => {
			const targetPath = req.body.targetPath;
			cb(null, targetPath);
		},
		filename: (req, file, cb) => {
			cb(null, file.originalname);
		},
	}),
});

// 验证路径是否存在
async function validatePath(targetPath) {
	try {
		await fs.access(targetPath);
		return true;
	} catch (err) {
		return false;
	}
}

// 获取文件列表（过滤~$开头的临时文件）
app.post('/api/getFiles', async (req, res) => {
	try {
		const { targetPath } = req.body;
		if (!targetPath) {
			return res.json({ code: -1, msg: '请传入目标路径' });
		}

		const exists = await validatePath(targetPath);
		if (!exists) {
			return res.json({ code: -1, msg: '路径不存在' });
		}

		const files = await fs.readdir(targetPath, { withFileTypes: true });
		const dirs = [];
		const fileList = [];

		for (const file of files) {
			// 过滤~$开头的临时文件
			if (file.name.startsWith('~$')) continue;

			const fullPath = path.join(targetPath, file.name);
			const stats = await fs.stat(fullPath);
			const mtime = stats.mtime.toLocaleString();

			if (file.isDirectory()) {
				dirs.push({
					name: file.name,
					path: fullPath,
					mtime: mtime,
				});
			} else {
				fileList.push({
					name: file.name,
					path: fullPath,
					size: stats.size,
					mtime: mtime,
				});
			}
		}

		// 按名称排序
		dirs.sort((a, b) => a.name.localeCompare(b.name));
		fileList.sort((a, b) => a.name.localeCompare(b.name));

		res.json({
			code: 0,
			msg: 'success',
			data: {
				currentPath: targetPath,
				parentPath: path.dirname(targetPath),
				dirs: dirs,
				files: fileList,
			},
		});
	} catch (err) {
		res.json({ code: -1, msg: err.message });
	}
});

// 打开文件
app.post('/api/openFile', async (req, res) => {
	try {
		const { targetPath } = req.body;
		if (!targetPath) {
			return res.json({ code: -1, msg: '请传入目标路径' });
		}

		const exists = await validatePath(targetPath);
		if (!exists) {
			return res.json({ code: -1, msg: '文件不存在' });
		}

		// 跨平台打开文件
		const cmd =
			process.platform === 'win32'
				? `start "" "${targetPath}"`
				: `open "${targetPath}"`;
		exec(cmd, (err) => {
			if (err) {
				return res.json({ code: -1, msg: '打开文件失败' });
			}
			res.json({ code: 0, msg: 'success' });
		});
	} catch (err) {
		res.json({ code: -1, msg: err.message });
	}
});

// 重命名文件/文件夹
app.post('/api/rename', async (req, res) => {
	try {
		const { oldPath, newPath } = req.body;
		if (!oldPath || !newPath) {
			return res.json({ code: -1, msg: '请传入原路径和新路径' });
		}

		const oldExists = await validatePath(oldPath);
		if (!oldExists) {
			return res.json({ code: -1, msg: '原路径不存在' });
		}

		const newExists = await validatePath(newPath);
		if (newExists) {
			return res.json({ code: -1, msg: '新路径已存在' });
		}

		await fs.rename(oldPath, newPath);
		res.json({ code: 0, msg: '重命名成功' });
	} catch (err) {
		res.json({ code: -1, msg: err.message });
	}
});

// 删除文件/文件夹
app.post('/api/delete', async (req, res) => {
	try {
		const { targetPath } = req.body;
		if (!targetPath) {
			return res.json({ code: -1, msg: '请传入目标路径' });
		}

		const exists = await validatePath(targetPath);
		if (!exists) {
			return res.json({ code: -1, msg: '路径不存在' });
		}

		await fsExtra.remove(targetPath);
		res.json({ code: 0, msg: '删除成功' });
	} catch (err) {
		res.json({ code: -1, msg: err.message });
	}
});

// 新建文件夹
app.post('/api/newFolder', async (req, res) => {
	try {
		const { targetPath } = req.body;
		if (!targetPath) {
			return res.json({ code: -1, msg: '请传入目标路径' });
		}

		const exists = await validatePath(targetPath);
		if (exists) {
			return res.json({ code: -1, msg: '文件夹已存在' });
		}

		await fs.mkdir(targetPath, { recursive: true });
		res.json({ code: 0, msg: '文件夹创建成功' });
	} catch (err) {
		res.json({ code: -1, msg: err.message });
	}
});

// 新建文件
app.post('/api/newFile', async (req, res) => {
	try {
		const { targetPath } = req.body;
		if (!targetPath) {
			return res.json({ code: -1, msg: '请传入目标路径' });
		}

		const exists = await validatePath(targetPath);
		if (exists) {
			return res.json({ code: -1, msg: '文件已存在' });
		}

		await fs.writeFile(targetPath, '', 'utf-8');
		res.json({ code: 0, msg: '文件创建成功' });
	} catch (err) {
		res.json({ code: -1, msg: err.message });
	}
});

// 复制文件/文件夹
app.post('/api/copy', async (req, res) => {
	try {
		const { sourcePath, targetPath } = req.body;
		if (!sourcePath || !targetPath) {
			return res.json({ code: -1, msg: '请传入源路径和目标路径' });
		}

		const sourceExists = await validatePath(sourcePath);
		if (!sourceExists) {
			return res.json({ code: -1, msg: '源路径不存在' });
		}

		// 批量复制
		if (Array.isArray(sourcePath)) {
			for (let i = 0; i < sourcePath.length; i++) {
				const src = sourcePath[i];
				const dest = path.join(targetPath, path.basename(src));
				await fsExtra.copy(src, dest);
			}
			return res.json({ code: 0, msg: '批量复制成功' });
		}

		// 单个复制
		await fsExtra.copy(sourcePath, targetPath);
		res.json({ code: 0, msg: '复制成功' });
	} catch (err) {
		res.json({ code: -1, msg: err.message });
	}
});

// 剪切文件/文件夹
app.post('/api/cut', async (req, res) => {
	try {
		const { sourcePath, targetPath } = req.body;
		if (!sourcePath || !targetPath) {
			return res.json({ code: -1, msg: '请传入源路径和目标路径' });
		}

		const sourceExists = await validatePath(sourcePath);
		if (!sourceExists) {
			return res.json({ code: -1, msg: '源路径不存在' });
		}

		// 批量剪切
		if (Array.isArray(sourcePath)) {
			for (let i = 0; i < sourcePath.length; i++) {
				const src = sourcePath[i];
				const dest = path.join(targetPath, path.basename(src));
				await fsExtra.move(src, dest);
			}
			return res.json({ code: 0, msg: '批量移动成功' });
		}

		// 单个剪切
		await fsExtra.move(sourcePath, targetPath);
		res.json({ code: 0, msg: '移动成功' });
	} catch (err) {
		res.json({ code: -1, msg: err.message });
	}
});

// 批量删除
app.post('/api/batchDelete', async (req, res) => {
	try {
		const { paths } = req.body;
		if (!paths || !Array.isArray(paths)) {
			return res.json({ code: -1, msg: '请传入待删除路径数组' });
		}

		for (const p of paths) {
			const exists = await validatePath(p);
			if (exists) {
				await fsExtra.remove(p);
			}
		}

		res.json({ code: 0, msg: '批量删除成功' });
	} catch (err) {
		res.json({ code: -1, msg: err.message });
	}
});

// 文件上传
app.post('/api/upload', upload.array('files'), async (req, res) => {
	try {
		if (!req.files || req.files.length === 0) {
			return res.json({ code: -1, msg: '请选择要上传的文件' });
		}

		res.json({
			code: 0,
			msg: '上传成功',
			data: { count: req.files.length },
		});
	} catch (err) {
		res.json({ code: -1, msg: err.message });
	}
});

// ========== 新增：默认访问index.html ==========
// 如果访问根路径，自动返回index.html
app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// =============================================

// 导出Excel接口
app.post('/api/exportExcel', async (req, res) => {
	try {
		const { data, fileName } = req.body;
		if (!data || !Array.isArray(data) || data.length === 0) {
			return res.json({ code: -1, msg: '无导出数据' });
		}

		// 创建工作簿和工作表
		const workbook = XLSX.utils.book_new();
		const worksheet = XLSX.utils.json_to_sheet(data);

		// 调整列宽（可选）
		const wscols = [
			{ wch: 30 }, // 文件名
			{ wch: 8 }, // 类型
			{ wch: 12 }, // 大小
			{ wch: 20 }, // 修改时间
			{ wch: 50 }, // 路径
		];
		worksheet['!cols'] = wscols;

		// 将工作表添加到工作簿
		XLSX.utils.book_append_sheet(workbook, worksheet, '文件列表');

		// 生成Excel文件流
		const excelBuffer = XLSX.write(workbook, {
			bookType: 'xlsx',
			type: 'buffer',
		});

		// ========== 修复：处理中文文件名 ==========
		// 1. 基础文件名（避免特殊字符）
		const baseFileName = fileName || `文件列表_${Date.now()}`;
		// 2. 对中文文件名进行URL编码，兼容所有浏览器
		const encodedFileName = encodeURIComponent(baseFileName)
			.replace(/'/g, '%27')
			.replace(/"/g, '%22');
		// 3. 设置兼容的响应头
		res.setHeader(
			'Content-Type',
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
		// 兼容Chrome/Firefox/Edge等浏览器
		res.setHeader(
			'Content-Disposition',
			`attachment; filename="${encodedFileName}.xlsx"; filename*=UTF-8''${encodedFileName}.xlsx`
		);
		// =========================================

		res.send(excelBuffer);
	} catch (err) {
		res.status(500).json({
			code: -1,
			msg: `生成Excel失败：${err.message}`,
		});
	}
});

// 启动服务
app.listen(PORT, () => {
	console.log(`服务运行在 http://localhost:${PORT}`);
	console.log(
		`前端页面访问 http://localhost:${PORT} 或 http://localhost:${PORT}/index.html`
	);
});
