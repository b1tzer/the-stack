---
type: howto
level: intermediate
---

# 依赖管理与测试

本页面向已经能写 Python 代码、想把它组织成可复现项目的读者，回答一个问题：如何初始化一个带虚拟环境和测试的 Python 项目。前置知识是前面的语言章节，尤其[异常与资源管理](../01-python-language/chapter-05-exceptions-and-io.md)里"异常运行时才暴露、正确性靠测试兜底"的结论。

命令以 Python 3.13+、pip 与 pytest 8.x 为准；成功标志与预期输出在每步下方给出。

## 1. 为什么需要虚拟环境

Python 的依赖默认装到全局解释器，不同项目对同一包的版本要求会互相冲突。虚拟环境（venv）为每个项目创建独立的包目录，把依赖隔离在项目内部。

没有虚拟环境时，两个项目分别需要 `requests` 的 2.x 和 3.x 就会冲突。统一用 venv 可以避免这种全局污染。

## 2. 创建并激活虚拟环境

在项目根目录执行：

```txt
python3 -m venv .venv
```

成功标志：没有报错，且生成了 `.venv/` 目录，其中 `.venv/bin/python` 是独立的解释器。创建成功后激活：

```txt
source .venv/bin/activate
```

激活后提示符前会出现 `(.venv)`，此时 `python` 和 `pip` 指向虚拟环境内的版本。用 `deactivate` 退出。`activate` 只修改当前 shell 的环境变量，不持久生效，新终端需要重新激活。

## 3. 声明并安装依赖

依赖用 `pip` 安装，并写入依赖文件以便复现。最简单的是 `requirements.txt`，每行一个包：

```txt
requests>=2.31
pytest>=8.0
```

安装：

```txt
pip install -r requirements.txt
```

成功标志：输出以 `Successfully installed ...` 结尾。`requirements.txt` 声明包和版本，但不声明构建流程。

现代项目更常用 `pyproject.toml` 统一声明依赖、构建和工具配置，用 `pip install -e .` 以可编辑模式安装当前项目。起步阶段用 `requirements.txt` 足够，包要发布或需要统一配置时再迁到 `pyproject.toml`。

## 4. 用 pytest 写测试

Python 没有编译期类型检查，类型和逻辑错误都留到运行时，因此测试在 Python 里尤其关键。pytest 是事实标准的测试框架。

测试文件以 `test_` 开头，测试函数也以 `test_` 开头，用 `assert` 表达断言：

```python
# test_math.py
def add(a, b):
    return a + b

def test_add():
    assert add(1, 2) == 3
    assert add(-1, 1) == 0
```

运行：

```txt
pytest test_math.py
```

成功标志：输出末尾为 `1 passed in 0.0Xs`；失败时输出具体的 `assert` 对比值和失败行号。pytest 自动发现 `test_*.py` 文件里的 `test_*` 函数，不需要额外的类或注解。

把测试放在项目根的 `tests/` 目录、被测代码放在 `src/` 或包内，是常见的可扩展布局；起步阶段先让测试能跑，再谈目录结构。

### 4.1 fixture、mock 与参数化

测试需要共享的初始化、隔离外部依赖、覆盖多组输入时，用 pytest 的三个核心机制：

- **fixture**：用 `@pytest.fixture` 定义可复用的测试准备逻辑，测试函数以参数形式声明依赖：

```python
import pytest

@pytest.fixture
def sample_data():
    return {'a': 1, 'b': 2}

def test_keys(sample_data):
    assert set(sample_data.keys()) == {'a', 'b'}
```

- **参数化**：用 `@pytest.mark.parametrize` 让同一测试跑多组输入：

```python
@pytest.mark.parametrize('a, b, expected', [(1, 2, 3), (-1, 1, 0), (0, 0, 0)])
def test_add(a, b, expected):
    assert a + b == expected
```

- **mock**：用 `unittest.mock` 或 pytest 的 `monkeypatch` fixture 替换外部依赖（网络、数据库、时间），让测试不依赖真实环境。

测试应覆盖正常路径和异常路径（非法输入、边界值、资源失败），因为 Python 没有编译期检查，逻辑错误只能靠测试捕获。

## 5. 选一个方向

语言本身到这里已经覆盖，接下来按用途分叉，不同方向引入不同生态：

| 方向 | 核心库/框架 | 对应内容 |
| :-- | :-- | :-- |
| Web 服务 | FastAPI、Flask | 用 HTTP 接口对外提供服务 |
| 数据与科学计算 | pandas、NumPy | 数据处理与分析 |
| AI 应用 | 见 [AI 工程知识库](../../ai/index.md) | 基于语言能力做 Agent |
| 自动化 | 标准库 + 脚本 | 文件、系统、接口的批量操作 |

每个方向都应回到同一套工程基线：虚拟环境隔离依赖、`pip` 声明依赖、pytest 覆盖关键路径。语言语法会变，这套"可复现 + 可测试"的骨架不变。

### 5.1 打包与项目布局

包要发布或被多个项目引用时，用 `pyproject.toml` 声明元数据，配合 `src` 布局：

```txt
myproj/
├── pyproject.toml
├── src/
│   └── myproj/
│       ├── __init__.py
│       └── core.py
└── tests/
    └── test_core.py
```

`pyproject.toml` 里声明包名、版本、依赖和构建后端，`pip install -e .` 以可编辑模式安装（修改源码立即生效）。

包结构的要点：`src` 布局避免"从项目根误导入源码目录"；`__init__.py` 标记包；相对导入在包内使用（见[函数、作用域与模块](../01-python-language/chapter-04-functions.md)第 4.2 节）。

### 5.2 日志

生产代码用 `logging` 替代 `print` 输出诊断信息，支持级别、格式化和输出目标：

```python
import logging

logging.basicConfig(level=logging.INFO)
logging.info('处理完成: %s', 'ok')
```

级别从低到高是 `DEBUG`、`INFO`、`WARNING`、`ERROR`、`CRITICAL`。起步用 `basicConfig` 足够，需要滚动文件、按模块分级时再引入 handler 配置。

## 6. 失败信号与回退

- `python3 -m venv` 报 `ensurepip is not available`：当前解释器缺少 ensurepip，换用带 pip 的解释器或用系统包管理器安装 `python3-venv`。
- `pip install` 报依赖冲突：检查 `requirements.txt` 的版本约束，用 `pip install -r requirements.txt` 的报错信息定位冲突包。
- `pytest` 报 `ModuleNotFoundError: pytest`：pytest 未安装到当前环境，先确认已激活 venv，再 `pip install pytest`。
- 激活 venv 后 `python` 仍指向全局：确认用的是 `source` 而非直接执行 `activate`，并检查 shell 提示符是否出现 `(.venv)`。
