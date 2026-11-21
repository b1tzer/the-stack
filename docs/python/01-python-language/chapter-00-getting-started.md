---
type: howto
level: basic
---

# 环境准备：安装 Python 与版本管理

本章面向已经会写 Python、需要在一台机器上准备好 Python 环境或管理多个版本的读者。环境已装好 Python 3.13 及以上版本的，可直接跳过本章，进入[值、变量与类型](./chapter-01-values-and-variables.md)。

## 1. 安装 Python

按你的操作系统选一种方式。

**macOS**

用 Homebrew 安装最简单。先在终端运行 `brew --version`，能输出版本号说明已安装 Homebrew；然后：

```txt
brew install python
```

**Windows**

到 python.org 的下载页，下载最新的 Windows 安装器（64 位）。运行安装器时**务必勾选 "Add python.exe to PATH"**，再点 Install。不勾选的话，之后在终端里敲 `python` 会提示找不到命令。

**Linux**

大多数发行版自带 Python，或用包管理器安装：

```txt
sudo apt install python3
```

## 2. 验证安装

打开终端，运行：

```txt
python3 --version
```

成功标志：输出形如 `Python 3.14.8` 的一行版本号。版本号在 3.13 或更高即可，本章与后续章节都能正常进行。写作时的最新稳定版是 Python 3.15，旧一些的 3.13、3.14 同样可用。

Windows 上如果安装时勾选了 PATH，命令通常是 `python --version` 而不是 `python3`。两个都试一下，哪个能输出版本号就用哪个。下文统一写 `python3`，你在 Windows 上换成 `python` 即可。

如果提示 `command not found`（或 Windows 的「不是内部或外部命令」），回到第 1 步检查 PATH 是否配置，或重装一次并确认勾选了 PATH。

## 3. 管理多个 Python 版本

同一台机器常需要同时保留多个 Python 版本（比如 3.11 跑旧项目、3.13 跑新项目）。用版本管理器 pyenv 按目录切换版本：

```txt
# 安装 pyenv（macOS 用 Homebrew）
brew install pyenv

# 列出可安装的版本
pyenv install --list

# 安装指定版本
pyenv install 3.13.0

# 在当前目录使用某个版本
pyenv local 3.13.0
```

`pyenv local` 会在当前目录写入一个 `.python-version` 文件，进入该目录后 `python` 自动指向对应版本。这样每个项目都能固定自己的解释器版本，避免全局升级破坏旧项目。

虚拟环境（venv）解决的是「每个项目一套依赖」，与 pyenv 解决「每个项目一个解释器版本」是两个正交的问题，两者常配合使用，详见[依赖管理与测试](../02-python-engineering/chapter-01-project-and-testing.md)。

## 4. 运行 Python 代码的三种方式

验证环境可用，通常用下面三种方式之一：

- **交互式环境（REPL）**：终端输入 `python3` 回车，提示符变成 `>>>`，输入代码回车立即执行，`exit()` 退出。适合随手验证语法。
- **脚本文件**：把代码写进 `.py` 文件，用 `python3 hello.py` 运行。这是日常写程序的方式。
- **`python -m` 模块方式**：`python3 -m http.server` 这样以模块方式运行标准库或包，等价于执行模块的入口代码，常用于运行工具和包内的命令行入口。

跑通任意一种（比如 `python3 -c "print('ok')"` 输出 `ok`），就说明环境可用。

## 5. 下一步

环境就绪后，进入[值、变量与类型](./chapter-01-values-and-variables.md)，从值、对象与变量语义开始回顾语言核心机制。
