const fs = require('fs-extra');
const path = require('path');

async function build() {
	try {
		// 清理之前的构建
		await fs.remove('./dist');
		await fs.remove('./release');

		// 创建构建目录
		await fs.ensureDir('./dist');
		await fs.ensureDir('./dist/public');

		// 复制静态文件
		await fs.copy('./public', './dist/public');

		console.log('正在打包主程序...');

		// 使用 ncc 打包
		const { spawn } = require('child_process');

		return new Promise((resolve, reject) => {
			const buildProcess = spawn(
				'npx',
				['@vercel/ncc', 'build', 'server.js', '-o', 'dist'],
				{
					stdio: 'inherit',
					shell: true, // 在 Windows 上使用 shell
				}
			);

			buildProcess.on('close', (code) => {
				if (code === 0) {
					// 创建 package.json
					const pkg = {
						name: 'file-explorer',
						version: '1.0.0',
						main: 'server.js',
						scripts: { start: 'node server.js' },
						dependencies: {
							express: '^4.18.2',
							cors: '^2.8.5',
						},
					};

					fs.writeFileSync(
						'./dist/package.json',
						JSON.stringify(pkg, null, 2)
					);

					console.log('✓ 构建完成! 目录: dist/');
					resolve();
				} else {
					reject(new Error('构建失败'));
				}
			});
		});
	} catch (error) {
		console.error('构建失败:', error);
	}
}

build();
