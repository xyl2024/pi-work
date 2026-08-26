---
name: codegraph
description: 使用 CodeGraph 分析代码库。需要查找符号、调用关系、依赖关系或修改影响范围时使用。
---

# CodeGraph

在需要理解项目结构或追踪代码关系时，优先使用 `codegraph`，避免只凭文件名猜测。

执行 `codegraph --help` 获取详细用法。

常用命令：

```bash
# 初始化或更新索引
codegraph init .
codegraph sync .

# 查看索引状态
codegraph status .

# 搜索符号
codegraph query "SymbolName" -p .

# 探索模块或功能
codegraph explore "关键词" -p .

# 查询调用关系
codegraph callers "SymbolName" -p .
codegraph callees "SymbolName" -p .

# 分析修改影响
codegraph impact "SymbolName" -p .
```

先运行 `codegraph status .` 确认索引是否存在且为最新；索引过期时先运行 `codegraph sync .`。将 CodeGraph 的结果与源码一起核对，再进行修改。
