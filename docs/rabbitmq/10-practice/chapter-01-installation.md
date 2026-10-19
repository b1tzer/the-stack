# 安装部署与环境配置

> 安装 RabbitMQ 最容易被忽视的不是步骤，是版本。RabbitMQ 和 Erlang 之间有严格的版本匹配关系，装错 Erlang 版本，broker 起不来，报错还经常不直接说原因。

## 1. 先定版本

RabbitMQ 的每个大版本要求特定范围的 Erlang 版本，这是安装前需要确认的兼容性条件。

本文以 RabbitMQ 4.x 为安装基线。Erlang 26 及更早版本已结束生命周期，不再受支持。RabbitMQ 4.x 的每个小版本有各自的 Erlang/OTP 支持范围，选型时以[官方兼容性矩阵](https://www.rabbitmq.com/docs/which-erlang)核对，不能仅凭主版本号判断。

用 RabbitMQ 官方仓库安装时，Erlang 会被一起拉进来，版本自动匹配。手动安装 Erlang 时需要自行核对版本兼容性，系统自带的 Erlang 往往版本过低或过高。

新项目直接用当前最新稳定版。老版本更早停止维护，漏洞修复和安全补丁已停，不等于更稳定。

## 2. Docker 快速启动

适合开发、测试、单机演示，不适合生产多节点集群。

```bash
docker run -d \
  --name rabbitmq \
  -p 127.0.0.1:5672:5672 \
  -p 127.0.0.1:15672:15672 \
  -e RABBITMQ_DEFAULT_USER=admin \
  -e RABBITMQ_DEFAULT_PASS=change-me \
  -v /data/rabbitmq:/var/lib/rabbitmq \
  rabbitmq:4-management
```

端口绑定 127.0.0.1，避免默认把 AMQP 和管理界面暴露给其他网络主机；`change-me` 替换为本地口令。`rabbitmq:4-management` 指向 4.x 系列最新版，需要固定补丁版本时用完整标签。挂载目录 `/data/rabbitmq` 需先存在，并具备容器内 rabbitmq 用户的读写权限，否则容器可能启动失败。

Docker 装单机没问题，但集群场景下，节点名称、主机间通信、Erlang cookie、数据持久化都要额外处理。生产集群采用容器、裸机还是云主机，取决于团队的运维能力与部署体系，不能把单节点启动命令直接扩展成集群方案。

管理界面在 `http://localhost:15672`。

## 3. 生产环境裸机安装

以 Debian / Ubuntu 为例，走 Team RabbitMQ 官方 apt 仓库，Erlang 与 RabbitMQ 分别从对应仓库安装，由依赖解析匹配兼容版本。

```bash
# 安装依赖
sudo apt-get install curl gnupg apt-transport-https -y

# 添加 Team RabbitMQ 签名密钥
curl -1sLf "https://keys.openpgp.org/vks/v1/by-fingerprint/0A9AF2115F4687BD29803A206B73A36E6026DFCA" | sudo gpg --dearmor | sudo tee /usr/share/keyrings/com.rabbitmq.team.gpg > /dev/null

# 添加 Erlang 与 RabbitMQ Server 仓库（Ubuntu 24.04 noble / amd64 示例，换发行版需同时替换 URL 与代号中的 noble）
sudo tee /etc/apt/sources.list.d/rabbitmq.list <<EOF
deb [arch=amd64 signed-by=/usr/share/keyrings/com.rabbitmq.team.gpg] https://deb1.rabbitmq.com/rabbitmq-erlang/ubuntu/noble noble main
deb [arch=amd64 signed-by=/usr/share/keyrings/com.rabbitmq.team.gpg] https://deb2.rabbitmq.com/rabbitmq-erlang/ubuntu/noble noble main
deb [arch=amd64 signed-by=/usr/share/keyrings/com.rabbitmq.team.gpg] https://deb1.rabbitmq.com/rabbitmq-server/ubuntu/noble noble main
deb [arch=amd64 signed-by=/usr/share/keyrings/com.rabbitmq.team.gpg] https://deb2.rabbitmq.com/rabbitmq-server/ubuntu/noble noble main
EOF

sudo apt-get update -y
# 先装匹配的 Erlang，再装 RabbitMQ Server
sudo apt-get install -y erlang-base erlang-asn1 erlang-crypto erlang-eldap erlang-ftp \
    erlang-inets erlang-mnesia erlang-os-mon erlang-parsetools erlang-public-key \
    erlang-runtime-tools erlang-snmp erlang-ssl erlang-syntax-tools erlang-tftp \
    erlang-tools erlang-xmerl
sudo apt-get install -y rabbitmq-server --fix-missing
```

RedHat / CentOS 系走对应的 rpm 仓库，思路一致。完整步骤以[官方安装文档](https://www.rabbitmq.com/docs/install-debian)为准。以上脚本是 Ubuntu 24.04 / amd64 示例，Team RabbitMQ 的 Erlang 仓库只提供 amd64 包，arm64 需改用 Launchpad 上的 Erlang 仓库；换发行版时，URL 与代号中的 noble 都要同步替换。

Debian / Ubuntu 官方软件包安装后通常会自动启动服务，以 rabbitmq 非特权用户运行，但仍需通过 systemctl 配置开机自启，见下一节。

## 4. systemd 托管

```bash
sudo systemctl enable rabbitmq-server
sudo systemctl start rabbitmq-server
sudo systemctl status rabbitmq-server
```

`enable` 配置开机自启，`start` 启动当前服务，两者不同。生产环境需两者都做：`enable` 保证机器重启后 broker 自启，`start` 保证当前已运行。

## 5. 配置文件

常规配置用 `rabbitmq.conf`，放在 `/etc/rabbitmq/` 下，使用新版 ini 风格格式。部分高级配置无法用 ini 格式表达，仍需 `advanced.config`（Erlang terms 格式），两个文件可以并存。原始的 `rabbitmq.config` 已在 3.7 起废弃，不要与 `advanced.config` 混淆。

```ini
# rabbitmq.conf
listeners.tcp.default = 5672
management.listener.port = 15672

# 内存与磁盘告警阈值，达到后触发资源告警与流控，不是硬上限
vm_memory_high_watermark.relative = 0.6
disk_free_limit.absolute = 1GB

log.file.level = info
```

`vm_memory_high_watermark.relative` 是触发流控的内存阈值，0.6 是默认值，含义是达到可用内存的 60% 时触发告警，不是严格限制进程内存。`disk_free_limit.absolute` 是磁盘剩余空间告警阈值，默认 50MB，固定 1GB 不适用所有磁盘容量，生产环境需按实际负载调整。

## 6. 验证安装

```bash
sudo rabbitmq-diagnostics ping
sudo rabbitmq-diagnostics status
sudo rabbitmqctl cluster_status
```

`rabbitmq-diagnostics ping` 成功说明节点正在运行且 CLI 能完成连接与认证；`rabbitmq-diagnostics status` 可查看 RabbitMQ 与 Erlang 版本及节点状态；`cluster_status` 用于查看集群成员，单节点时意义有限。启动失败时应结合 `systemctl status` 和日志排查，不能只凭一条命令断定是 Erlang 版本不匹配。

## 7. 插件

```bash
rabbitmq-plugins enable rabbitmq_management
```

延迟消息插件（rabbitmq_delayed_message_exchange）已停止维护，依赖的 Mnesia 在 RabbitMQ 4.3 中已移除，4.3 起无法使用。

延迟消息的实现取决于版本。RabbitMQ 4.4 起，Quorum Queue 原生支持延迟消息：发布时设置 `x-opt-delivery-time`（AMQP 0-9-1 用 header，AMQP 1.0 用注解）为未来的 Unix 毫秒时间戳，消息立即入队、到时间才投递。4.3 引入的延迟重试（针对被 reject/nack 退回消息的递增退避）是另一项功能，不能混用。4.3 及更早版本没有原生定时投递，可评估 TTL + DLX，详见[消息 TTL](../05-consumer/chapter-04-message-ttl.md)。
