# Web File Manager

一个基于` Node.js + Express `开发的网页版文件管理器，支持文件/文件夹的查看、操作、Excel 导出等功能，适配 Windows 系统，内置隐藏文件过滤机制。

<p align="center">
<img src="https://img.shields.io/badge/demo-运行中-brightgreen" alt="demo-screenshot" />&nbsp;&nbsp;
<img src="https://img.shields.io/badge/node->%3D14.0.0-blue" alt="node-version" />&nbsp;&nbsp;
<img src="https://img.shields.io/badge/license-MIT-green" alt="license" />&nbsp;
</p>

## ✨ 核心功能
- 📁 目录浏览：支持树形目录导航、卡片/列表双视图切换
- 📋 文件操作：新建/删除/重命名/复制/剪切/粘贴文件/文件夹
- 📊 数据导出：列表视图下可导出文件列表为 Excel 表格
- 📱 响应式：适配PC/移动端，支持侧边栏折叠
- 🔍 实时搜索：支持文件名模糊搜索、多字段排序
- 🛡️ 隐藏过滤：自动过滤系统隐藏文件（如 ~$ 临时文件、desktop.ini、.sys 等）
- 📤 拖拽上传：支持拖拽文件到指定目录完成上传

## 📋 技术栈
- 前端：原生 HTML + CSS + JavaScript（无框架）、Font Awesome 图标
- 后端：Node.js + Express、fs-extra（文件操作）、xlsx（Excel 生成）、multer（文件上传）

## 🚀 快速部署

### 1. 环境准备
- 安装 Node.js（推荐 v14.0.0 及以上版本）：[Node.js 官网](https://nodejs.org/)
- 克隆仓库到本地：
```bash
git clone https://github.com/colour008/web-file-manager.git

cd web-file-manager
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动服务

```bash
node server.js
```

### 4. 访问应用

打开浏览器访问：`http://localhost:3001`或`http://localhost:3001/index.html`

## 📖 使用说明

### 基础操作

1. **加载目录**：在左侧输入文件夹绝对路径（如 `C:\Users\XXX\Desktop` 或 `/home/XXX`），点击「确认加载」
2. **视图切换**：支持「卡片视图」「列表视图」切换，列表视图支持按名称 / 大小 / 修改时间 / 类型排序
3. **文件操作：**右键菜单可执行打开 / 重命名 / 删除 等操作
4. **Excel 导出**：切换到列表视图后，点击「导出 Excel」按钮，自动下载当前目录的文件列表

### 注意事项

- 运行服务时需保证 Node.js 进程有对应目录的读写权限
- 仅支持访问服务端所在机器的本地文件系统
- 导出的 Excel 包含文件名、类型、大小、修改时间、完整路径等信息

## 📋️ ToDo List

* 拖拽上传：将文件拖拽到右侧内容区，可上传到当前选中的目录
* 单个文件 / 文件夹：复制 / 剪切功能
* 批量操作：按住 Ctrl 键多选文件 / 文件夹，可批量删除 / 复制 / 剪切

## ⚠️ 安全提示

- 该工具仅建议在本地 / 内网环境使用，请勿直接暴露到公网
- 如需公网访问，建议添加身份验证、限制访问 IP 等安全措施
- 操作文件时请谨慎，避免误删重要系统文件

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 📞 问题反馈

如有 bug 或功能建议，欢迎提交 Issue 或 Pull Request。
