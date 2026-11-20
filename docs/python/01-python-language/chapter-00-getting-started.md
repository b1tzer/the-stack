---
type: tutorial
level: basic
---

# 起步：安装 Python 并运行第一个程序

本章面向从没写过代码的人，目标是在你的电脑上装好 Python、运行第一段代码，并建立「程序、语句、变量」这三个最基本的概念。装好之后，后面的章节都假设你能随时运行 Python。

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

打开终端（macOS 是「终端」，Windows 是 PowerShell 或命令提示符），运行：

```txt
python3 --version
```

成功标志：输出形如 `Python 3.14.8` 的一行版本号。版本号在 3.13 或更高即可，本章与后续章节都能正常进行。写作时的最新稳定版是 Python 3.15，旧一些的 3.13、3.14 同样可用。

Windows 上如果安装时勾选了 PATH，命令通常是 `python --version` 而不是 `python3`。两个都试一下，哪个能输出版本号就用哪个。下文统一写 `python3`，你在 Windows 上换成 `python` 即可。

如果提示 `command not found`（或 Windows 的「不是内部或外部命令」），回到第 1 步检查 PATH 是否配置，或重装一次并确认勾选了 PATH。

## 3. 运行第一段代码：交互式环境

在终端输入 `python3` 并回车，会进入交互式环境（REPL），提示符从 `$` 变成 `>>>`。在 `>>>` 后面输入代码，回车立即执行：

```python
>>> print('hello')
hello
```

`print` 把括号里的内容打印到屏幕。看到 `hello` 就说明 Python 正常工作。输入 `exit()` 并回车，退出交互式环境。

## 4. 运行第一个脚本文件

交互式环境适合随手试，真正的程序要写进文件保存、反复运行。用任意文本编辑器（VS Code、记事本均可）新建文件 `hello.py`，内容只有一行：

```python
print('你好，Python')
```

保存后，在终端进入该文件所在目录，运行：

```txt
python3 hello.py
```

成功标志：终端输出 `你好，Python`。这就是「运行一个程序」的完整过程：把代码写进 `.py` 文件，用 `python3` 执行它。

## 5. 程序、语句与变量

跑通第一个程序后，先建立三个最基本的心智模型，后面的章节都建立在它们之上。

**程序是顺序执行的指令。** 一个 `.py` 文件里的代码从上到下逐条执行，上面的先执行：

```python
print('第一行')
print('第二行')
```

运行输出：

```txt
第一行
第二行
```

**语句是让计算机做一件事的指令。** `print('第一行')` 是一条语句，让计算机打印一行文字。

**变量是给值起的名字。** 把一个值存起来、起个名字，之后反复使用：

```python
name = '小明'
print(name)
```

`name = '小明'` 把字符串 `'小明'` 存进变量 `name`，下一行 `print(name)` 打印变量里的值，输出 `小明`。这里的 `=` 不是「等于」，而是「把右边的值放进左边的名字里」——这个含义在后面的章节会反复用到。

## 6. 出错时怎么办

刚开始写代码，报错是常态，不是失败。Python 报错时会打印一段信息，最关键的是**最后一行**，它说明错在哪里：

```python
print(hello)
```

运行会得到：

```txt
NameError: name 'hello' is not defined
```

`NameError` 是错误类型，冒号后面是具体原因：`hello` 这个变量没有定义——因为 `hello` 没加引号，Python 把它当成变量名，而不是字符串 `'hello'`。看到报错，先读最后一行，通常就能定位问题。

最常见的两类错误：

- `SyntaxError`：语法写错了，比如少了括号、引号没配对。
- `NameError`：用了一个没定义过的名字。

遇到不理解的报错，把最后一行复制到搜索引擎，通常能找到解释。

## 7. 下一步

环境装好、第一个程序跑通、三个基本概念建立后，进入[值、变量与类型](./chapter-01-values-and-variables.md)，开始学 Python 的核心机制。
