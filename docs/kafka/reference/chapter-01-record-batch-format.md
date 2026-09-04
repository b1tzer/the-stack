# RecordBatch v2 格式

> RecordBatch v2 是 Kafka 0.11+ 使用的消息格式（[KIP-98](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98) 引入）。本文是字节级参考，面向需要深入底层的读者。

## 1. 批头结构

`.log` 文件里不是「一条条消息」，而是「一批批 RecordBatch」。一批的头部固定 61 字节，后面跟变长 `Record[]`：

```txt
偏移(字节)  长度  字段                       说明
  0        8    baseOffset                该批第一条消息的绝对 offset
  8        4    batchLength               从 partitionLeaderEpoch 到末尾的字节数
 12        4    partitionLeaderEpoch      KIP-101：Broker 收到时写入
 16        1    magic                     固定 2
 17        4    crc                       CRC-32C（Castagnoli）
 21        2    attributes                低 3 位=压缩算法（0 none/1 gzip/2 snappy/3 lz4/4 zstd）
                                          bit 3=timestampType, bit 4=isTransactional
                                          bit 5=isControlBatch, bit 6=hasDeleteHorizonMs
 23        4    lastOffsetDelta           该批最后一条相对 baseOffset 的偏移
 27        8    baseTimestamp             该批第一条时间戳
 35        8    maxTimestamp              该批最大时间戳
 43        8    producerId                KIP-98
 51        2    producerEpoch             KIP-98
 53        4    baseSequence              KIP-98
 57        4    recordCount               该批消息数
 61        …    records[]                 变长记录数组
```

CRC 覆盖 attributes 之后的所有字节。`partitionLeaderEpoch` 不参与 CRC 计算——它由 Broker 在收到 Produce 请求时才写入，若纳入 CRC 每次都要重算，代价过高。

## 2. 批内 Record 结构

每条 `Record` 使用 varint 编码，只存相对量：

```txt
length          varint
attributes      int8    （目前未用）
timestampDelta  varlong  相对 baseTimestamp
offsetDelta    varint    相对 baseOffset
keyLength       varint
key             bytes
valueLength     varint
value           bytes
headers[]       Header 数组（KIP-82，0.11 引入）
```

同批内共享 producerId / baseTimestamp / baseOffset，每条只写增量，压缩比明显高于逐条独立编码。

## 3. 源码参考

字节偏移量在 `DefaultRecordBatch` 中以常量形式定义：

```txt
BASE_OFFSET_OFFSET = 0
LENGTH_OFFSET = 8
PARTITION_LEADER_EPOCH_OFFSET = 12
MAGIC_OFFSET = 16
CRC_OFFSET = 17
ATTRIBUTES_OFFSET = 21
```

来源：[DefaultRecordBatch.java](https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/common/record/DefaultRecordBatch.java)、[Kafka 官方 Message Format](https://kafka.apache.org/37/implementation/message-format)
