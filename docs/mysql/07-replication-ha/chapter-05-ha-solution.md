# 高可用方案

## 1. 主流方案

### 1.1 MHA

Master High Availability，自动故障切换。

```bash
# 检查复制状态
masterha_check_repl --conf=/etc/mha/app1.cnf

# 启动 MHA Manager
masterha_manager --conf=/etc/mha/app1.cnf
```

### 1.2 Orchestrator

```bash
# 安装
orchestrator --config=/etc/orchestrator.conf.json http

# 查看拓扑
orchestrator-client -c topology -i mycluster
```

### 1.3 InnoDB Cluster

MySQL 官方高可用方案，基于 MGR + MySQL Shell + MySQL Router。

```javascript
// MySQL Shell
dba.configureInstance('root@192.168.1.100:3306')
dba.createCluster('myCluster')
cluster.addInstance('root@192.168.1.101:3306')
cluster.addInstance('root@192.168.1.102:3306')
```

### 1.4 Keepalived + VIP

```bash
# /etc/keepalived/keepalived.conf
vrrp_script check_mysql {
    script "/usr/local/bin/check_mysql.sh"
    interval 2
    weight -20
    fall 3
    rise 2
}

vrrp_instance VI_1 {
    state MASTER
    interface eth0
    virtual_router_id 51
    priority 100
    advert_int 1
    
    virtual_ipaddress {
        192.168.1.200/24
    }
    
    track_script {
        check_mysql
    }
}
```

```bash
#!/bin/bash
# /usr/local/bin/check_mysql.sh
mysql -h 127.0.0.1 -u root -psecret -e "SELECT 1" > /dev/null 2>&1
if [ $? -ne 0 ]; then
    exit 1
fi
exit 0
```

## 2. 方案对比与选型

### 2.1 对比

| 方案 | 自动切换 | 数据一致性 | 复杂度 |
|------|---------|-----------|--------|
| MHA | ✅ | 依赖 GTID | 中 |
| Orchestrator | ✅ | 依赖 GTID | 中 |
| InnoDB Cluster | ✅ | 强一致 | 低 |

### 2.2 方案选择指南

| 方案 | 自动切换 | 数据一致性 | 复杂度 | 适用场景 |
|------|---------|-----------|--------|----------|
| 传统主从 + VIP | ❌ 需手动 | 最终一致 | 低 | 小规模、非核心 |
| MHA | ✅ | 依赖 GTID | 中 | 中大规模、传统架构 |
| Orchestrator | ✅ | 依赖 GTID | 中 | 大规模、拓扑管理 |
| InnoDB Cluster | ✅ | 强一致（Paxos） | 低 | 新项目、官方推荐 |
| ProxySQL + 主从 | ✅ | 最终一致 | 中 | 读写分离场景 |
| 云 RDS | ✅ | 强一致 | 最低 | 云环境、预算充足 |

## 3. 故障切换流程

```
1. 故障检测
   ├── 心跳检测（Keepalived/MHA/Orchestrator）
   ├── 应用层检测（连接失败）
   └── 复制延迟检测

2. 故障确认
   ├── 多次检测确认（避免误判）
   └── 人工确认（可选）

3. 主从切换
   ├── 停止旧主库写入
   ├── 确保从库数据最新（GTID）
   ├── 提升从库为主库
   └── 其他从库指向新主库

4. 应用切换
   ├── VIP 漂移 / DNS 切换 / 代理路由
   └── 应用重连

5. 旧主库恢复
   ├── 修复后作为从库加入
   └── 数据追赶
```

## 4. 最佳实践

1. **新项目使用 InnoDB Cluster** — 官方方案，最简单可靠
2. **已有主从架构使用 Orchestrator** — 强大的拓扑管理
3. **必须开启 GTID** — 故障切换的基础
4. **定期演练故障切换** — 确保切换流程可用
5. **监控告警** — 复制延迟、节点状态、连接数
6. **避免脑裂** — 使用仲裁节点或多数派机制
7. **应用层容错** — 连接重试、超时设置、降级方案
