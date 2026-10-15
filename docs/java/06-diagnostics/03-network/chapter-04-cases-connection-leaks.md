# 网络案例：连接泄漏与状态异常

> **案例说明：** 本页日期、业务背景、指标和工具输出均为构造或匿名化教学数据；除引用一手资料外，不应视为可核验的真实事件。排查方法与命令仍需结合目标 JDK、系统和生产变更流程验证。

这组案例关注连接数持续增长、TIME_WAIT 或 CLOSE_WAIT 堆积。一个常见误区是把这些状态本身当成根因去调内核参数。状态只是结果，要先还原连接的生命周期，再看是谁没走完关闭流程。

## 案例一：CLOSE-WAIT 堆积是应用没关闭 {#case-1}

### 1.1 事故背景

某服务运行几天后文件描述符耗尽，新连接无法建立。重启后恢复，几天后重现。

### 1.2 第一步：看连接状态分布

```bash
ss -s
```

```txt
TCP:   5200 (estab 200, closed 50, timewait 10, closewait 4800)
                                                    ↑ 异常
```

`closewait` 接近 5000，说明大量连接卡在被动关闭后、等待应用调用 `close()`。这不是 TIME-WAIT，也不是端口耗尽，而是对端关了但本端没关。

### 1.3 第二步：定位没关闭的代码路径

```java
// 反例：read 返回 -1 后没关连接
public void onRead(SocketChannel ch) throws IOException {
    ByteBuffer buf = ByteBuffer.allocate(1024);
    int n = ch.read(buf);
    if (n == -1) {
        // ❌ 没有 ch.close()，本端进入 CLOSE-WAIT 等应用关闭
        return;
    }
    handle(buf);
}
```

对端关闭发送方向后，本端 `read()` 返回 -1（半关闭），但代码直接 `return`，没有 `close()`，连接停在 CLOSE-WAIT 直到 fd 耗尽。

### 1.4 根因与修复

根因是应用在读到 EOF 后没有关闭连接，CLOSE-WAIT 只是这个缺陷的表征。修复是在 `n == -1` 分支显式关闭，并统一用 try-with-resources 收口。调 `tcp_fin_timeout` 之类的参数对 CLOSE-WAIT 无效，它只影响 FIN-WAIT-2。

## 案例二：TIME-WAIT 多不一定等于故障 {#case-2}

### 2.1 事故背景

巡检发现一台网关 `timewait` 数量上万，告警规则触发。运维准备调 `tcp_tw_reuse`，被拦下先做判断。

### 2.2 第一步：确认是否真的影响建连

```bash
# 精确统计 TIME-WAIT
ss -Htan state time-wait | wc -l

# 看是否真的出现端口分配失败
dmesg | grep "TCP: out of memory"     # 或查应用日志的 EADDRNOTAVAIL
```

数量多只说明存在大量短连接，不能直接断言端口耗尽。关键看两点：本地端口范围是否真的用满、是否出现了 `EADDRNOTAVAIL` 或 `Cannot assign requested address`。

### 2.3 第二步：看连接复用空间

```bash
# 看目标地址是否集中（单一远端时 TIME-WAIT 才容易压端口）
ss -Htan state time-wait | awk '{print $4}' | cut -d: -f1 | sort | uniq -c | sort -rn | head
```

本案例 TIME-WAIT 分散在大量不同远端地址上，本地端口空间远未用满，也没有 `EADDRNOTAVAIL`。这是高频短连接的正常产物，不构成故障。

### 2.4 根因与修复

根因是告警阈值把「状态数量多」误判成故障。处理是修正告警口径（以实际建连失败率为准），并推动长连接/连接池复用减少无谓建连。这个案例说明 TIME-WAIT 数量高是现象，只有在确实压到端口分配时才需要干预。

## 案例三：连接池泄漏撑爆文件描述符 {#case-3}

### 3.1 事故背景

某 HTTP 客户端服务 fd 缓慢增长，几天后 `Cannot assign requested address`，与案例一表象相似但增长更慢。

### 3.2 第一步：区分是 JVM 内连接还是系统连接

```bash
# 系统级连接状态
ss -tan | wc -l
# JVM 内连接对象（以 Apache HttpClient 为例，字段名随版本变化）
# 通过池状态接口或 Arthas 观察 leased/available 连接数
```

系统连接数与 JVM 池内借出数持续增长且不匹配归还数，说明连接被借出后没归还池。

### 3.3 第二步：看归还路径

```java
// 反例：异常路径忘了释放连接
CloseableHttpResponse resp = httpClient.execute(request);
try {
    return parse(resp);
} catch (ParseException e) {
    // ❌ 异常时没 close(resp)，连接不归还池，也不走四次挥手
    throw e;
}
// 正确：在 finally 或 try-with-resources 中 resp.close()
```

异常分支跳过 `close()`，连接既不归还池也不关闭，fd 随异常频率缓慢泄漏。与案例一的 CLOSE-WAIT 不同，这里 often 表现为系统连接数直接涨、池可用连接被占满。

### 3.4 根因与修复

根因是连接池资源在异常路径未释放。修复是统一 try-with-resources。这个案例提醒：fd 增长先看「池内借出 vs 系统连接」是否对得上，再判断是没 close 还是没归还池，两者修复方式不同。

> **上一页：** [请求超时与延迟案例](./chapter-03-cases-timeout-latency.md)
> **返回：** [网络性能分析与故障排查](./chapter-01-network-diagnostics.md)
