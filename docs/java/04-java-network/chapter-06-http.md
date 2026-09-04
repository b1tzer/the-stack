# HTTP 协议：应用层通信标准

> 你的 Grafana 监控面板亮了一排红灯：502、504、Connection Timeout。team 群里的运营已经在催「接口挂了」。你打开 Nginx error.log，看到 `upstream timed out` 和 `connection refused` 交替出现——但这两个错误的根因完全不同，一个需要修上游代码，一个需要看上游进程是不是挂了。你怎么在 5 分钟内判断应该把时间花在哪？

> **📖 阅读建议**：如果你正盯着 502/504 告警排障，直接从 §6.4 状态码开始。§6.1-§6.3 是 HTTP 协议基础——每天写 REST API 的人建议全部读完，很多坑都源于「你以为你懂了 GET」。

## 1. 一次 HTTP 请求到底花了多少时间

先从你线上真正关心的问题开始：**一个 HTTP 请求的耗时，到底是花在网络上了，还是花在服务端处理上了？**

### 1.1 curl 分阶段计时

你的 API 偶尔从 200ms 飙到 8 秒，没有规律，日志里一切正常。这时候不要猜——用 `curl -w` 把一次请求拆成 6 个阶段的耗时：

```bash
curl -w "DNS解析: %{time_namelookup}s | TCP连接: %{time_connect}s | TLS握手: %{time_appconnect}s | 首字节(TTFB): %{time_starttransfer}s | 总耗时: %{time_total}s\n" \
  -o /dev/null -s https://api.example.com/users/1
```

| 阶段 | 含义 | 异常高意味着什么 |
| :-- | :-- | :-- |
| `time_namelookup` | DNS 解析耗时 | DNS 服务器慢或缓存失效 |
| `time_connect` | TCP 三次握手耗时 | 网络延迟高，检查 RTT |
| `time_appconnect` | TLS 握手耗时 | SSL 证书链长或 OCSP 超时 |
| `time_starttransfer` | 首字节时间（TTFB） | **服务端处理慢**——这是你最该查的阶段 |
| `time_total` | 总耗时 | 前面所有阶段之和 |

```txt
典型结果解读：

正常请求：
DNS:0.002 | TCP:0.005 | TLS:0.015 | TTFB:0.180 | Total:0.202
↑ 网络很快，服务端处理 180ms 也正常

慢请求但网络正常：
DNS:0.001 | TCP:0.003 | TLS:0.012 | TTFB:8.500 | Total:8.516
↑ TTFB 占了 8.5 秒——瓶颈在服务端处理，不是网络

慢请求且网络也慢：
DNS:0.520 | TCP:0.320 | TLS:0.850 | TTFB:0.180 | Total:1.870
↑ DNS+TCP+TLS 占了 1.7 秒——问题在客户端到服务器的链路
```

**如果 TTFB 高**：问题在你的服务端（慢 SQL、锁等待、线程池满、外部依赖超时）。**如果 `time_connect` 高**：问题在链路（跨机房、防火墙、负载均衡）。工具把你的直觉变成了数字，接下来去哪查、怎么查就知道了。

### 1.2 HTTP 在 TCP 连接上的完整生命周期

一个 HTTP 请求从发出到收到响应，经历的不是一个原子操作，而是一组可拆解的阶段：

```txt
客户端                                    服务器
  │                                         │
  ├─ ① DNS 解析 (time_namelookup)           │
  │    api.example.com → 10.0.1.100        │
  │                                         │
  ├─ ② TCP 三次握手 (time_connect)          │
  │  SYN → SYN-ACK → ACK                    │
  │                                         │
  ├─ ③ TLS 握手 (time_appconnect, HTTPS)    │
  │  ClientHello → ServerHello → 证书交换    │
  │                                         │
  ├─ ④ 发送 HTTP Request                    │
  │  GET /api/users/1 HTTP/1.1              │
  │  Host: api.example.com                  │
  │                                         │
  │                    ┌─────────────────────┤
  │                    │ ⑤ 服务端处理(TTFB)    │
  │                    │   - 路由匹配          │
  │                    │   - 业务逻辑          │
  │                    │   - DB 查询           │
  │                    │   - 序列化            │
  │                    └─────────────────────┤
  │                                         │
  │ ←──⑥ HTTP Response ─────────────────── │
  │  HTTP/1.1 200 OK                        │
  │  Content-Type: application/json         │
  │  {"id":1,"name":"张三"}                  │
  │                                         │
  ├─ ⑦ 四次挥手 (或 Keep-Alive 复用)         │
```

**每个阶段都是一个可能的故障点**，而且每个阶段的排查工具不同。§6.4 讲的状态码，就是用来告诉你是哪一段出了问题。

## 2. HTTP 报文：你每天在写的 REST API，底层长什么样

从 curl 分阶段计时你已经知道怎么定位瓶颈了。现在看瓶颈的「承载物」——HTTP 报文本身。

### 2.1 请求报文结构

```http
POST /api/users HTTP/1.1
Host: www.example.com
Content-Type: application/json
Content-Length: 45
Authorization: Bearer eyJhbGciOi...
Connection: keep-alive

{"name":"张三","email":"zhangsan@example.com"}
```

```txt
┌────────────────────────────────────────────┐
│ 请求行 (Request Line)                       │
│   方法  空格  URI  空格  版本  CRLF         │
├────────────────────────────────────────────┤
│ 请求头 (Request Headers)                    │
│   Header: Value CRLF                       │
│   CRLF (空行，头部结束)                      │
├────────────────────────────────────────────┤
│ 请求体 (Request Body, 可选)                 │
└────────────────────────────────────────────┘
```

### 2.2 响应报文结构

```http
HTTP/1.1 201 Created
Content-Type: application/json
Content-Length: 62
Location: /api/users/42

{"id":42,"name":"张三","email":"zhangsan@example.com"}
```

### 2.3 Header 分类速查

| 类别 | 示例 | 说明 |
| :-- | :-- | :-- |
| **通用头** | `Date`, `Connection`, `Cache-Control` | 请求和响应都能用 |
| **请求头** | `Host`, `Authorization`, `Accept` | 客户端发出 |
| **响应头** | `Server`, `Set-Cookie`, `Location` | 服务端返回 |
| **实体头** | `Content-Type`, `Content-Length`, `Content-Encoding` | 描述 Body |

对 Java 开发者而言，你不需要手拼 HTTP 报文——Spring MVC 和 OkHttp 替你做了。但当你线上排查 `415 Unsupported Media Type` 的时候，如果你不知道错误出在 `Content-Type` 头而不是请求体本身，排查方向就错了。

## 3. HTTP 方法：你的 GET 不是真的只读

### 3.1 安全与幂等——这两个属性是你线上数据的防线

HTTP 定义了 9 个方法。对 Java 后端而言，只需要记住两个核心属性就够用了：

| 方法 | 安全（不修改资源） | 幂等（多次调用结果相同） |
| :-- | :--: | :--: |
| GET | ✅ | ✅ |
| HEAD | ✅ | ✅ |
| OPTIONS | ✅ | ✅ |
| PUT | ❌ | ✅ |
| DELETE | ❌ | ✅ |
| POST | ❌ | ❌ |
| PATCH | ❌ | ❌ |

**安全**决定了爬虫、重试、CDN 预取会不会对你的服务产生副作用。**幂等**决定了网络超时重发会不会产生重复数据。

```java
// ✅ GET 是安全的——CDN 预取、爬虫大量请求不会改数据
@GetMapping("/users/{id}")
public User getUser(@PathVariable Long id) {
    return userService.findById(id);
}

// ❌ 线上真实踩坑：GET 里做了写入
@GetMapping("/users/{id}/login")
public void recordLogin(@PathVariable Long id) {
    loginLogService.insert(id, LocalDateTime.now());  // 写入操作！
    // 爬虫扫了这个 URL → 凭空刷了几万条「登录记录」
}

// ✅ 改为 POST——明确告诉调用方「这是有副作用的操作」
@PostMapping("/users/{id}/login")
public void recordLogin(@PathVariable Long id) { ... }
```

### 3.2 GET 与 POST 的常见误解

| 误解 | 事实 |
| :-- | :-- |
| "GET 参数有长度限制" | 协议本身无限制，限制来自浏览器地址栏和服务器默认 buffer |
| "POST 比 GET 安全" | 都是明文传输（HTTP），安全性依赖 HTTPS |
| "GET 不能有 Body" | 协议允许，但大多数框架会忽略 |

## 4. HTTP 状态码：你线上的每一个 5xx 都在说不同的事

这是本章最重要的部分。线上告警亮了最多的就是 4xx 和 5xx，但它们背后对应的排查方向完全不同。

### 4.1 502 vs 504 vs Connection Timeout——别再搞混了

你用 Nginx 做反向代理，后面挂着 Java 应用。线上告警亮了：

```txt
2026-08-09 15:32:11 error.log: connect() failed (111: Connection refused) while connecting to upstream
2026-08-09 15:35:47 error.log: upstream timed out (110: Connection timed out) while reading response header from upstream
2026-08-09 15:40:02 access.log: GET /api/orders 502
2026-08-09 15:40:08 access.log: GET /api/export 504
```

这三种错误码，根因完全不一样：

| 错误 | Nginx error.log 关键词 | 根因 | 排查方向 |
| :-- | :-- | :-- | :-- |
| **502** | `connect() failed` / `connection refused` | 上游根本没响应——进程挂了、端口没监听、防火墙拦了 | `netstat -tlnp` 看端口、`systemctl status` 看进程 |
| **504** | `upstream timed out` | 上游还活着但处理超时——慢 SQL、线程池满、外部依赖卡 | 看 TTFB、`jstack`、数据库慢查询日志 |
| **Connection Timeout** | error.log 干净但客户端连不上 | TCP 握手阶段失败——SYN 队列满、`somaxconn` 太小、防火墙 DROP | `ss -s` 看 SYN-RECV、`netstat -s` 看丢包 |

**502 和 504 的根本区别**：502 是「叫不到人」（上游已死或不存在），504 是「人来了但不理你」（上游忙着处理别的事）。

### 4.2 4xx：问题在你这边

| 状态码 | 什么时候会出现 | 你该查什么 |
| :-- | :-- | :-- |
| **400** | 前端发来的 JSON 少了一个必填字段 | 请求体的 `Content-Type` 和参数校验 |
| **401** | Token 过期了，前端没做刷新 | `Authorization` 头和 JWT 有效期 |
| **403** | 用户有 Token 但没这个接口的权限 | RBAC 配置和 `@PreAuthorize` |
| **404** | URL 写错了或资源真的被删了 | `@RequestMapping` 路径是否匹配 |
| **429** | 触发了网关的限流规则 | 限流配置和客户端退避策略 |

### 4.3 5xx：问题在服务端或中间层

| 状态码 | 什么时候会出现 | 排查命令 |
| :-- | :-- | :-- |
| **500** | 代码没 catch 住的异常（NPE、SQLException） | `grep "ERROR" application.log` |
| **502** | 上游进程挂了、Nginx 连不上 upstream | `netstat -tlnp | grep 8080` |
| **503** | 服务过载、所有 Worker 线程都在忙 | `jstack | grep catalina-exec | wc -l` |
| **504** | 上游处理太慢，超过 Nginx 的 `proxy_read_timeout`（默认 60s） | `grep "upstream timed out" error.log` + 查慢 SQL |

> **生产环境警告**：出现 504 时不要第一反应拉大 `proxy_read_timeout`。如果根因是上游卡在慢 SQL 或锁等待，拉大超时只会让连接占用更久，入口层更容易被拖死。先直连上游看实际响应时间，再决定调配置还是修代码。

### 4.4 快速判断：从 Nginx error.log 定位问题层

```bash
# 一行的快速诊断
grep -E "connect\(\) failed|upstream timed out|no live upstreams|reset by peer" /var/log/nginx/error.log | tail -20
```

| 关键词 | 问题层 | 行动 |
| :-- | :-- | :-- |
| `connect() failed` | 上游未监听 | 重启上游服务 |
| `upstream timed out` | 上游处理慢 | 查慢 SQL、线程池 |
| `no live upstreams` | 全部上游不健康 | 查健康检查或全挂了 |
| `reset by peer` | 上游主动断开 | 查上游 OOM、线程池满 |

## 5. HTTP 版本演进：为什么你的 HTTPS 接口比别人慢一拍

你写好的 REST API，本地测试正常，上线后前端反馈「首次加载慢」。这不是你的代码问题，是 HTTP 协议版本在起作用。

### 5.1 HTTP/1.0 → HTTP/1.1：省掉每次重连的握手

```txt
HTTP/1.0：每请求一次 = 一次 TCP 握手 + 一次数据 + 一次挥手
HTTP/1.1：一次 TCP 握手 → 多次请求/响应（Keep-Alive）→ 最后才挥手
```

### 5.2 HTTP/1.1 → HTTP/2：一个页面 20 个请求不再排队

HTTP/1.1 在同一连接上请求必须按序返回（队头阻塞）。HTTP/2 引入的多路复用在一个 TCP 连接上并行传输多个请求/响应：

```txt
HTTP/1.1：
连接1: 请求CSS → [等待响应] → 请求JS → [等待响应]
连接2: 请求IMG1 → [等待响应] → ...

HTTP/2：
单连接: 并行传输 CSS + JS + IMG1 + IMG2（互不阻塞）
```

### 5.3 HTTP/2 → HTTP/3：TCP 本身也别拖后腿

HTTP/2 解决了应用层队头阻塞，但 TCP 层丢一个包，所有请求都得等重传。HTTP/3 用 QUIC（UDP 之上）彻底消除了这个瓶颈：

```txt
TCP (HTTP/1.1 / HTTP/2):   丢 Packet 3 → 所有 Stream 都等
QUIC (HTTP/3):             丢 Packet 3 → 只影响 Stream 1，其他照常
```

| 维度 | HTTP/1.1 | HTTP/2 | HTTP/3 |
| :-- | :-- | :-- | :-- |
| 传输层 | TCP | TCP | QUIC (UDP) |
| 多路复用 | ❌ | ✅ (应用层) | ✅ (传输层，真正无阻塞) |
| 队头阻塞 | 应用层+TCP | 仅 TCP | 无 |
| 首连延迟 | TCP 3次 + TLS 2次 | TCP 3次 + TLS 2次 | 1-RTT（重连 0-RTT） |

> **本章小结：** HTTP 是你每天在用的协议——不是教科书上的 RFC 条目。502 和 504 的区别决定了你下一步是重启进程还是查慢 SQL。`curl -w` 把「这个接口慢」拆成了 6 个可量化的数字。`Content-Type` 配错导致的 415，日志里写的是 `Unsupported Media Type`，根因是 `@RequestBody` 找不到匹配的 `HttpMessageConverter`。
