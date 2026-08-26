# 高级数据类型

> 除了五种基础类型，Redis 还提供了四类高级数据类型：BitMap、HyperLogLog、Geo、Stream。它们并非全新的底层结构，而是对基础类型的巧妙封装——BitMap 与 HyperLogLog 基于 String，Geo 基于 ZSet，Stream 基于专属的 Radix Tree。

## 1. BitMap：位操作

BitMap 不是独立类型，而是 String 上的一组位操作命令——把 String 当作一个可以按位读写的比特数组。

```bash
SETBIT sign:20240101 100 1    # 将第 100 位设为 1
GETBIT sign:20240101 100      # 读取第 100 位
BITCOUNT sign:20240101        # 统计为 1 的位数
BITOP AND dest key1 key2      # 位运算（AND/OR/XOR/NOT）
```

**典型场景**：

- **签到统计**：每天一个 key，用户 ID 作为偏移量，1 表示已签到
- **在线状态**：一个超大 BitMap 记录所有用户在线与否
- **布隆过滤器基础**：位数组是布隆过滤器的底层载体

**优势**：一个 bit 记录一个状态，内存效率极高。1 亿用户签到只需约 12MB 内存。

## 2. HyperLogLog：基数统计

HyperLogLog 用于统计「不重复元素的数量」（基数），典型场景是 UV（独立访客）统计。它基于 String，用概率算法在固定内存下估算基数。

```bash
PFADD uv:20240101 user1 user2 user3   # 添加元素
PFCOUNT uv:20240101                   # 估算不重复元素数量
PFMERGE dest uv:1 uv:2                # 合并多个 HLL
```

**核心特性**：

| 特性 | 说明 |
| :-- | :-- |
| 内存占用 | 固定 12KB，与元素数量无关 |
| 标准误差 | 约 0.81% |
| 适用场景 | 允许误差的大规模去重计数 |

**对比**：用 Set 统计 1 亿 UV 需要数 GB 内存，HyperLogLog 只需 12KB，代价是 0.81% 的误差。当「精确」不是刚需而「规模」是刚需时，HyperLogLog 是首选。

> HyperLogLog 只能估算基数，不能返回具体元素。如果需要「去重后还能取出元素」，请用 Set。

## 3. Geo：地理位置

Geo 基于 ZSet 实现，将经纬度编码为 Geohash 分值，从而复用 ZSet 的范围查询能力。

```bash
GEOADD cities 116.40 39.90 "北京" 121.47 31.23 "上海"
GEODIST cities "北京" "上海" km         # 两点距离
GEOPOS cities "北京"                     # 获取坐标
GEOSEARCH cities FROMMEMBER "北京" BYRADIUS 1000 km   # 附近查询
```

**典型场景**：

- **附近的人**：`GEOSEARCH` 按半径查找
- **配送范围**：判断地址是否在配送半径内
- **地理位置检索**：结合距离排序

**底层原理**：Redis 用 Geohash 算法把二维坐标降维成一维字符串，再以 ZSet 的 score 存储。所以 Geo 天然继承了 ZSet 的「范围查询 O(log n)」能力。

## 4. Stream：消息流

Stream 是 Redis 5.0 引入的专属数据类型，底层采用 Radix Tree（基数树），用于实现完整的消息队列语义。

```bash
XADD mystream * field1 value1      # 追加消息（* 表示自动生成 ID）
XRANGE mystream - +                # 读取所有消息
XREAD COUNT 2 STREAMS mystream 0   # 从指定位置读
XGROUP CREATE mystream group1 0    # 创建消费者组
XREADGROUP GROUP group1 c1 STREAMS mystream >   # 消费者组读取
```

**核心特性**：

| 特性 | 说明 |
| :-- | :-- |
| 消息 ID | 单调递增，由「时间戳-序号」组成 |
| 消费者组 | 支持多消费者分组、消息确认（ACK）、Pending 列表 |
| 持久化 | 消息可随 RDB/AOF 持久化 |
| 阻塞读取 | `XREAD BLOCK` 支持阻塞等待 |

**对比 List 做队列**：List 的 `BLPOP` 实现的是「消费即销毁」，消息被弹出后无法回溯；Stream 的消息读取后仍保留，配合消费者组可支持 ACK 与重试，语义更接近 Kafka 这类消息系统。

## 5. 高级类型速查

| 类型 | 底层 | 核心命令 | 典型场景 | 关键限制 |
| :-- | :-- | :-- | :-- | :-- |
| BitMap | String | `SETBIT`/`BITCOUNT` | 签到、在线状态 | 偏移量需连续 |
| HyperLogLog | String | `PFADD`/`PFCOUNT` | UV 统计 | 0.81% 误差、不可取元素 |
| Geo | ZSet | `GEOADD`/`GEOSEARCH` | 附近的人、配送 | 精度约 1 米 |
| Stream | Radix Tree | `XADD`/`XREADGROUP` | 消息队列 | 需消费者组管理 |

## 6. 实操演示：四种高级类型场景

### 6.1 场景一：每日签到（BitMap）

把用户 ID 当作位偏移量，1 表示当天已签到。

```bash
SETBIT sign:20240101 100 1     # (integer) 0  用户 100 签到
SETBIT sign:20240101 200 1     # (integer) 0  用户 200 签到
SETBIT sign:20240101 300 1     # (integer) 0
GETBIT sign:20240101 100       # (integer) 1  用户 100 已签到
BITCOUNT sign:20240101         # (integer) 3  当天共 3 人签到
```

### 6.2 场景二：独立访客 UV（HyperLogLog）

```bash
PFADD uv:20240101 user1 user2 user3 user3   # (integer) 1  重复的 user3 只记一次
PFCOUNT uv:20240101                          # (integer) 3  估算去重后 3 个
PFADD uv:20240102 user3 user4 user5          # (integer) 1
PFMERGE uv:week uv:20240101 uv:20240102     # OK  合并两天的 UV
PFCOUNT uv:week                              # (integer) 5
```

> 注意 `PFCOUNT` 返回的是**估算值**（有 0.81% 误差），别拿它做精确对账。它只回答「大约多少人」，不回答「具体是谁」。

### 6.3 场景三：附近的人（Geo）

```bash
GEOADD cities 116.40 39.90 "北京" 121.47 31.23 "上海" 113.26 23.13 "广州"
# (integer) 3
GEODIST cities "北京" "上海" km        # "1067.3788"  北京到上海距离
GEOSEARCH cities FROMMEMBER "北京" BYRADIUS 1500 km ASC
# 1) "北京" 2) "上海" 3) "广州"   按距离升序
```

### 6.4 场景四：可靠消息队列（Stream 消费者组）

Stream 解决 List 的「消费即销毁」问题，支持 ACK 与重试。先创建消费者组，再消费：

```bash
# 1. 生产者发消息（* 表示自动生成递增 ID）
XADD events * type login user "alice"     # "1704...-0"
XADD events * type login user "bob"       # "1704...-1"

# 2. 创建消费者组（从最开始 $ 或 0 消费）
XGROUP CREATE events group1 0             # OK

# 3. 消费者 c1 读取未确认的新消息（> 表示只读新消息）
XREADGROUP GROUP group1 c1 COUNT 2 STREAMS events >
# 返回两条消息及各自 ID

# 4. 处理完确认（ACK）
XACK events group1 1704...-0              # (integer) 1

# 5. 查看已读但未确认的消息（Pending 列表，用于重试）
XPENDING events group1
```

> 消费流程是「`XREADGROUP` 读 → 业务处理 → `XACK` 确认」。若某条消息处理失败不 ACK，它会留在 Pending 列表里，可被重新拉取重试——这是 Stream 相比 List 最关键的可靠性提升。
